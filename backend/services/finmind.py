"""FinMind API client with local JSON cache."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx

from utils.cache import atomic_write_json, chip_cache_dir, read_json
from services.rate_limiter import TokenBucket

logger = logging.getLogger(__name__)

_FINMIND_BASE = "https://api.finmindtrade.com/api/v4"
_CACHE_VERSION = 3

# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_client: FinMindClient | None = None


def get_finmind() -> FinMindClient:
    global _client
    if _client is None:
        _client = FinMindClient()
    return _client


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

_fm_limiter: TokenBucket | None = None


def get_finmind_rate_limiter() -> TokenBucket:
    global _fm_limiter
    if _fm_limiter is None:
        rate = float(os.getenv("FINMIND_RATE_LIMIT_PER_SEC", "5"))
        _fm_limiter = TokenBucket(rate=rate)
        logger.info("FinMind rate limiter: %.1f req/s", rate)
    return _fm_limiter


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class FinMindClient:
    def __init__(self) -> None:
        self._token = os.getenv("FINMIND_TOKEN", "")
        if not self._token:
            raise ValueError("FINMIND_TOKEN env var is required")
        self._limiter = get_finmind_rate_limiter()
        self._inflight: dict[str, asyncio.Task] = {}
        self._http = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._http.aclose()

    # -- internal helpers ---------------------------------------------------

    async def _get(self, url: str, params: dict) -> list:
        await self._limiter.acquire_async()
        headers = {"Authorization": f"Bearer {self._token}"}
        resp = await self._http.get(url, params=params, headers=headers)
        resp.raise_for_status()
        body = resp.json()
        return body.get("data", [])

    @staticmethod
    def _cache_path(key: str) -> Path:
        return chip_cache_dir() / f"{key}.json"

    def _read_cache(self, key: str) -> dict | None:
        p = self._cache_path(key)
        if not p.exists():
            return None
        data = read_json(p, default=None)
        if data is not None and data.get("_cache_version") != _CACHE_VERSION:
            return None
        if data is not None:
            data.pop("_cache_version", None)
        return data

    def _write_cache(self, key: str, payload: dict) -> None:
        cached = {**payload, "_cache_version": _CACHE_VERSION}
        atomic_write_json(self._cache_path(key), cached)

    @staticmethod
    def _is_today(date_str: str) -> bool:
        return date_str == date.today().isoformat()

    @staticmethod
    def _is_stale(cached: dict, max_age_minutes: int = 30) -> bool:
        """Return True if cached entry is older than *max_age_minutes*."""
        fetched = cached.get("fetched_at", "")
        if not fetched:
            return True
        try:
            dt = datetime.fromisoformat(fetched)
            return datetime.now() - dt > timedelta(minutes=max_age_minutes)
        except ValueError:
            return True

    async def _run_once(self, inflight_key: str, coro_fn):
        if inflight_key in self._inflight:
            return await self._inflight[inflight_key]
        self._inflight[inflight_key] = asyncio.ensure_future(coro_fn())
        try:
            return await self._inflight[inflight_key]
        finally:
            self._inflight.pop(inflight_key, None)

    # -- chip summary -------------------------------------------------------

    async def fetch_chip_summary(
        self,
        symbol: str,
        date_str: str,
        refresh: bool = False,
    ) -> dict:
        cache_key = f"{symbol}_{date_str}"
        if not refresh:
            cached = self._read_cache(cache_key)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        return await self._run_once(
            f"summary_{cache_key}",
            lambda: self._do_fetch_summary(symbol, date_str, cache_key),
        )

    async def _do_fetch_summary(
        self,
        symbol: str,
        date_str: str,
        cache_key: str,
    ) -> dict:
        inst_raw, margin_raw, broker_raw = await asyncio.gather(
            self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockInstitutionalInvestorsBuySellWide",
                    "data_id": symbol,
                    "start_date": date_str,
                    "end_date": date_str,
                },
            ),
            self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockMarginPurchaseShortSale",
                    "data_id": symbol,
                    "start_date": date_str,
                    "end_date": date_str,
                },
            ),
            self._get(
                f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report",
                {"data_id": symbol, "date": date_str},
            ),
        )
        result = {
            "symbol": symbol,
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "institutional": _parse_institutional(inst_raw),
            "margin": _parse_margin(margin_raw),
            "top_brokers": _parse_top_brokers(broker_raw),
        }
        self._write_cache(cache_key, result)
        return result

    # -- bubble -------------------------------------------------------------

    async def fetch_chip_bubble(
        self,
        symbol: str,
        date_str: str,
        refresh: bool = False,
    ) -> dict:
        cache_key = f"{symbol}_{date_str}_bubble"
        if not refresh:
            cached = self._read_cache(cache_key)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        return await self._run_once(
            f"bubble_{cache_key}",
            lambda: self._do_fetch_bubble(symbol, date_str, cache_key),
        )

    async def _do_fetch_bubble(
        self,
        symbol: str,
        date_str: str,
        cache_key: str,
    ) -> dict:
        raw = await self._get(
            f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report",
            {"data_id": symbol, "date": date_str},
        )
        result = {
            "symbol": symbol,
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "trades": [
                {
                    "broker": r["securities_trader"],
                    "broker_id": r.get("securities_trader_id", ""),
                    "price": float(r["price"]),
                    "buy": _to_lots(int(r["buy"])),
                    "sell": _to_lots(int(r["sell"])),
                }
                for r in raw
            ],
        }
        self._write_cache(cache_key, result)
        return result

    # -- history (configurable-window candles + institutional + margin) ------

    @staticmethod
    def _history_cache_key(symbol: str, days: int) -> str:
        """days==90 沿用既有路徑(W10:保護所有 seed-cache 測試);
        其他 days 加 `_{days}d` 後綴,自成 cache 檔。"""
        return f"{symbol}_history" if days == 90 else f"{symbol}_history_{days}d"

    async def fetch_chip_history(
        self,
        symbol: str,
        refresh: bool = False,
        days: int = 90,
    ) -> dict:
        cache_key = self._history_cache_key(symbol, days)
        cached = self._read_cache(cache_key) if not refresh else None
        if cached is not None:
            last = cached.get("last_date", "")
            # Bug #2 fix: once last_date == today, the cache was previously
            # served indefinitely until next-day rollover, so browser F5
            # (refresh=false) returned the same JSON written hours ago.
            # Now apply 15-min TTL when cache is from today; pre-today
            # always falls through and re-fetches the new day's bar.
            if last >= date.today().isoformat() and not self._is_stale(
                cached,
                max_age_minutes=15,
            ):
                return cached

        try:
            return await self._run_once(
                f"history_{cache_key}",
                lambda: self._do_fetch_history(symbol, cache_key, days),
            )
        except httpx.HTTPError as exc:
            # K-line resilience: when FinMind is unreachable (token expired,
            # rate-limit, transient outage) and we have any cached history,
            # serve it stale rather than 502 the whole chart. The frontend
            # can render a "資料較舊" indicator off the `stale: True` flag.
            # Without this fallback every FinMind blip nuked the K-line even
            # though a perfectly serviceable prior payload was on disk.
            if cached is not None:
                logger.warning(
                    "fetch_chip_history: live fetch failed (%s), serving "
                    "stale cache (last_date=%s)",
                    exc,
                    cached.get("last_date", ""),
                )
                return {**cached, "stale": True}
            raise

    async def _do_fetch_history(
        self,
        symbol: str,
        cache_key: str,
        days: int = 90,
    ) -> dict:
        end = date.today()
        start = end - timedelta(days=days)
        s, e = start.isoformat(), end.isoformat()

        candles_raw, inst_raw, margin_raw = await asyncio.gather(
            self._get(
                f"{_FINMIND_BASE}/data",
                {"dataset": "TaiwanStockPrice", "data_id": symbol, "start_date": s, "end_date": e},
            ),
            self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockInstitutionalInvestorsBuySellWide",
                    "data_id": symbol,
                    "start_date": s,
                    "end_date": e,
                },
            ),
            self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockMarginPurchaseShortSale",
                    "data_id": symbol,
                    "start_date": s,
                    "end_date": e,
                },
            ),
        )

        candles = [
            {
                "date": r["date"],
                "open": float(r["open"]),
                "high": float(r["max"]),
                "low": float(r["min"]),
                "close": float(r["close"]),
                "volume": _to_lots(int(r["Trading_Volume"])),
            }
            for r in candles_raw
        ]

        trading_dates = [c["date"] for c in candles]
        # No SecIdAgg pre-fetch: that endpoint now REQUIRES a per-broker
        # `securities_trader_id` filter, so a corpus-wide fetch would 400.
        # Fall back to the per-date TradingDailyReport path inside
        # _fetch_major_series — already proven to deliver correct values.
        major_series = await self._fetch_major_series(symbol, trading_dates)

        result = {
            "symbol": symbol,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "last_date": e,
            "candles": candles,
            "institutional": _parse_institutional_series(inst_raw),
            "margin": _parse_margin_series(margin_raw),
            "major": major_series,
        }
        self._write_cache(cache_key, result)
        return result

    async def _safe_get_secid_agg(
        self,
        symbol: str,
        start: str,
        end: str,
        trader_id: str,
    ) -> list:
        """FinMind's SecIdAgg endpoint REQUIRES `securities_trader_id`. Returns
        [] on any HTTP/network/parse failure (the caller treats missing rows
        as "no data for this broker", which is the same outcome as an
        unavailable upstream)."""
        try:
            return await self._get(
                f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report_secid_agg",
                {
                    "data_id": symbol,
                    "start_date": start,
                    "end_date": end,
                    "securities_trader_id": trader_id,
                },
            )
        except Exception as exc:
            logger.warning(
                "SecIdAgg fetch failed for %s/%s: %s",
                symbol,
                trader_id,
                exc,
            )
            return []

    # -- broker history -----------------------------------------------------

    @staticmethod
    def _broker_history_cache_key(symbol: str, days: int) -> str:
        return f"{symbol}_broker_history" if days == 90 else f"{symbol}_broker_history_{days}d"

    async def fetch_broker_history(
        self,
        symbol: str,
        ids: list[str],
        refresh: bool = False,
        days: int = 90,
    ) -> dict:
        """`ids` are broker_ids (FinMind `securities_trader_id`) — same values
        the frontend already receives in `top_brokers[].broker_id`. The cache
        is partial per-symbol: brokers fetched in prior requests stay cached
        across sessions; new ids on this request are fetched + merged.

        `days` controls the historical window; W10 keeps `days==90` on the
        original cache path so seed-cache tests keep working."""
        cache_key = self._broker_history_cache_key(symbol, days)
        if not refresh:
            cached = self._read_cache(cache_key)
            if cached is not None and self._has_fresh_subset(cached, ids):
                return _filter_broker_history(cached, ids)

        payload = await self._run_once(
            f"broker_history_{cache_key}_{','.join(sorted(set(ids)))}",
            lambda: self._do_fetch_broker_history(symbol, cache_key, ids, days),
        )
        return _filter_broker_history(payload, ids)

    @staticmethod
    def _has_fresh_subset(cached: dict, ids: list[str]) -> bool:
        """True iff cache covers every requested id AND is today-dated AND
        within the 15-min TTL — i.e. we can return without any fetch."""
        if cached.get("last_date", "") < date.today().isoformat():
            return False
        if FinMindClient._is_stale(cached, max_age_minutes=15):
            return False
        brokers = cached.get("brokers", {})
        return all(bid in brokers for bid in ids)

    async def _do_fetch_broker_history(
        self,
        symbol: str,
        cache_key: str,
        ids: list[str],
        days: int = 90,
    ) -> dict:
        existing = self._read_cache(cache_key) or {
            "symbol": symbol,
            "fetched_at": "",
            "last_date": "",
            "brokers": {},
        }
        existing_brokers: dict[str, list] = dict(existing.get("brokers", {}))

        # Refetch all requested ids — caller decides freshness; we always
        # overwrite to pick up newly-traded dates. Brokers absent from `ids`
        # but present in cache stay cached (sticky across sessions).
        end = date.today()
        start = end - timedelta(days=days)
        results = await asyncio.gather(
            *[
                self._safe_get_secid_agg(symbol, start.isoformat(), end.isoformat(), bid)
                for bid in ids
            ],
            return_exceptions=True,
        )
        any_success = False
        for bid, res in zip(ids, results):
            if isinstance(res, BaseException) or not res:
                # Keep previously-cached series for this id if any; otherwise
                # an empty list (so the frontend renders 0 bars, not nothing).
                if bid not in existing_brokers:
                    existing_brokers[bid] = []
                continue
            any_success = True
            parsed = _parse_broker_history(res)
            existing_brokers[bid] = parsed.get(bid, [])

        # No new data AND no prior cache → upstream is genuinely unavailable.
        if not any_success and not existing.get("last_date"):
            raise ValueError("secid_agg_unavailable")

        payload = {
            "symbol": symbol,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "last_date": end.isoformat(),
            "brokers": existing_brokers,
        }
        self._write_cache(cache_key, payload)
        return payload

    # -- options: large traders OI ----------------------------------------

    async def fetch_oi_large_traders(
        self,
        contract: dict,
        date_str: str,
        refresh: bool = False,
    ) -> dict:
        """Fetch TaiwanOptionOpenInterestLargeTraders for the given contract,
        return both today's snapshot + 20 trading-day net series.

        `contract` is a dict from
        services.finmind_options.list_active_contracts (uses `option_id`,
        `contract_date`, and `contract_type` keys); see spec §2.3.
        """
        from services.finmind_options import _CACHE_VERSION_OPTIONS

        contract_id = f"{contract['option_id']}{contract['contract_date']}"
        cache_key = f"{contract_id}_{date_str}_oi_lt"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        return await self._run_once(
            f"oi_lt_{cache_key}",
            lambda: self._do_fetch_oi_large_traders(contract, date_str, cache_key),
        )

    async def _do_fetch_oi_large_traders(
        self,
        contract: dict,
        date_str: str,
        cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS,
            parse_oi_large_traders,
        )

        end = date.fromisoformat(date_str)
        # FinMind TaiwanOptionOpenInterestLargeTraders silently ignores
        # `end_date` — it only returns rows for `start_date`. A single
        # multi-day call therefore yields just one date, breaking the 20D
        # series. Fan out 30 single-date fetches in parallel (token bucket
        # serialises them) and aggregate; weekends/holidays naturally drop
        # out as empty payloads, leaving ~20 real trading days.
        dates_to_fetch = [end - timedelta(days=i) for i in range(30)]

        async def fetch_one(d: date) -> list:
            try:
                return await self._get(
                    f"{_FINMIND_BASE}/data",
                    {
                        "dataset": "TaiwanOptionOpenInterestLargeTraders",
                        "start_date": d.isoformat(),
                        "end_date": d.isoformat(),
                    },
                )
            except Exception as exc:
                logger.warning(
                    "OI-LT single-date fetch failed for %s: %s",
                    d,
                    exc,
                )
                return []

        batches = await asyncio.gather(*[fetch_one(d) for d in dates_to_fetch])
        raw = [r for batch in batches for r in batch]

        parsed = parse_oi_large_traders(
            raw,
            contract_type=contract["contract_type"],
            option_id=contract["option_id"],
        )
        # Truncate series to last 20 entries to honour spec §2.1.
        parsed["series"] = parsed["series"][-20:]
        result = {
            "contract": f"{contract['option_id']}{contract['contract_date']}",
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result

    # -- options: strike volume + OI change ------------------------------

    async def fetch_strike_volume(
        self,
        contract: dict,
        date_str: str,
        refresh: bool = False,
    ) -> dict:
        """Fetch TaiwanOptionDaily for the given contract, return ALL volume>0
        strikes sorted asc per side + OI change vs previous trading day.

        `contract` is a dict from
        services.finmind_options.list_active_contracts (uses `option_id`
        and `contract_date` keys); see spec §2.3.
        """
        from services.finmind_options import _CACHE_VERSION_OPTIONS

        contract_id = f"{contract['option_id']}{contract['contract_date']}"
        cache_key = f"{contract_id}_{date_str}_strike_vol"  # dropped _top{n} suffix
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        return await self._run_once(
            f"strike_vol_{cache_key}",
            lambda: self._do_fetch_strike_volume(contract, date_str, cache_key),
        )

    async def _do_fetch_strike_volume(
        self,
        contract: dict,
        date_str: str,
        cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS,
            parse_strike_volume,
        )

        end = date.fromisoformat(date_str)
        start = end - timedelta(days=7)
        raw = await self._get(
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanOptionDaily",
                "data_id": contract["option_id"],
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
        )
        parsed = parse_strike_volume(
            raw,
            contract["contract_date"],
            option_id=contract["option_id"],
        )
        result = {
            "contract": f"{contract['option_id']}{contract['contract_date']}",
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result

    # -- options: 台指期 spot price ----------------------------------------

    async def fetch_spot(self, date_str: str, refresh: bool = False) -> dict:
        from services.finmind_options import _CACHE_VERSION_OPTIONS

        data_id = "TX"  # Phase 0b: only TX returned data; TXFCONT/TXF empty
        cache_key = f"{data_id}_{date_str}_spot"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached
        return await self._run_once(
            f"spot_{cache_key}",
            lambda: self._do_fetch_spot(date_str, data_id, cache_key),
        )

    async def _do_fetch_spot(
        self,
        date_str: str,
        data_id: str,
        cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS,
            parse_spot,
        )

        end = date.fromisoformat(date_str)
        start = end - timedelta(days=7)
        raw = await self._get(
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanFuturesDaily",
                "data_id": data_id,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
        )
        parsed = parse_spot(raw)
        result = {
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result

    # ------------------------------------------------------------------
    # txo-chip-framework MVP1: shared TaiwanOptionDaily window + chip endpoints
    # ------------------------------------------------------------------

    async def fetch_taiwan_option_daily_window(
        self,
        trading_dates: list[date],
        end_date: date,
        refresh: bool = False,
    ) -> dict[str, list[dict]]:
        """Shared 250-trading-day window fetch (design v4 §2.2 / I1, I2, F17).

        Args:
            trading_dates: list of trading dates to fetch, sorted ascending.
                Caller (route layer) computes via services.trading_calendar.
            end_date: end of window (latest trading day).
            refresh: if True, invalidate cache + downstream parse caches.

        Returns: ``{date_iso: rows}`` mapping.
        """
        cache_key = f"txo_daily_window_{end_date.isoformat()}_td{len(trading_dates)}"

        # Include `refresh` in the dedup key so a concurrent refresh=True call
        # does NOT piggy-back on an in-flight refresh=False coroutine (which
        # would silently skip cache invalidation + serve stale data).
        return await self._run_once(
            f"window_{cache_key}_r{int(refresh)}",
            lambda: self._do_fetch_window(trading_dates, end_date, cache_key, refresh),
        )

    async def _do_fetch_window(
        self,
        trading_dates: list[date],
        end_date: date,
        cache_key: str,
        refresh: bool,
    ) -> dict[str, list[dict]]:
        from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

        # Inside _run_once after dedup (I1): only invalidate when we actually refetch
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None and "by_date" in cached:
                # Today's window must respect the 30-min stale window — otherwise
                # one morning fetch sticks for the whole trading session.
                if end_date != date.today() or not self._is_stale(cached):
                    return cached["by_date"]
        # refresh or cache miss → invalidate downstream parse caches then fetch
        if refresh:
            self._invalidate_chip_parse_caches(end_date)
        # Fan out per-day fetches (token bucket serialises through shared limiter)
        results = await asyncio.gather(
            *[
                self._get(
                    f"{_FINMIND_BASE}/data",
                    {
                        "dataset": "TaiwanOptionDaily",
                        "data_id": "TXO",
                        "start_date": d.isoformat(),
                        "end_date": d.isoformat(),
                    },
                )
                for d in trading_dates
            ],
            return_exceptions=True,
        )
        by_date: dict[str, list[dict]] = {}
        for d, res in zip(trading_dates, results):
            if isinstance(res, BaseException):
                by_date[d.isoformat()] = []
            else:
                by_date[d.isoformat()] = res or []
        payload = {
            "by_date": by_date,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        }
        self._write_cache_v(cache_key, payload, _CACHE_VERSION_OPTIONS_CHIP)
        return by_date

    async def fetch_settlement_history(
        self,
        end_date: date,
        lookback_days: int = 540,
        refresh: bool = False,
    ) -> dict[date, dict]:
        """Fetch ``TaiwanOptionFinalSettlementPrice`` for the last
        ``lookback_days`` calendar days and return
        ``{settlement_date: {contract_date, price}}``.

        ``lookback_days`` defaults to 540 (~18 months) so 20 settled
        contracts comfortably fit (monthly settlements span ~14 months).
        Uses a 30-min cache when end_date is today (settlement publishes
        intraday during the closing window); served unconditionally otherwise.
        """
        from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

        cache_key = f"settlement_history_{end_date.isoformat()}_lb{lookback_days}"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None and "by_date" in cached:
                if end_date != date.today() or not self._is_stale(cached):
                    return {date.fromisoformat(d): info for d, info in cached["by_date"].items()}
        start = end_date - timedelta(days=lookback_days)
        rows = await self._get(
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanOptionFinalSettlementPrice",
                "data_id": "TXO",
                "start_date": start.isoformat(),
                "end_date": end_date.isoformat(),
            },
        )
        by_date: dict[str, dict] = {}
        for row in rows:
            d_str = row.get("date") or row.get("settlement_date")
            cd = row.get("contract_date") or row.get("contract_type")
            try:
                price = (
                    float(row.get("final_settlement_price") or row.get("settlement_price") or 0)
                    or None
                )
            except (TypeError, ValueError):
                price = None
            if d_str and cd:
                by_date[d_str] = {"contract_date": str(cd), "price": price}
        payload = {
            "by_date": by_date,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        }
        self._write_cache_v(cache_key, payload, _CACHE_VERSION_OPTIONS_CHIP)
        return {date.fromisoformat(d): info for d, info in by_date.items()}

    async def fetch_tx_close_history(
        self,
        end_date: date,
        lookback_days: int = 400,
        refresh: bool = False,
    ) -> dict[date, float]:
        """Fetch ``TaiwanFuturesDaily`` TX close prices for the last
        ``lookback_days`` calendar days. Returns ``{trading_date: close}``.

        Cached 30 min when end_date is today (close publishes at end-of-day);
        served unconditionally for past dates. Used to compute next-day returns
        for PCR stats, foreign-correlation regressions, and the OI-wall
        hit-rate T-1 spot anchor.
        """
        from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

        cache_key = f"tx_close_history_{end_date.isoformat()}_lb{lookback_days}"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None and "by_date" in cached:
                if end_date != date.today() or not self._is_stale(cached):
                    return {date.fromisoformat(d): float(v) for d, v in cached["by_date"].items()}
        start = end_date - timedelta(days=lookback_days)
        rows = await self._get(
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanFuturesDaily",
                "data_id": "TX",
                "start_date": start.isoformat(),
                "end_date": end_date.isoformat(),
            },
        )
        # Day-session, single-month contract only (matches existing parse_spot)
        import re as _re

        _PURE_YYYYMM = _re.compile(r"^\d{6}$")
        by_date: dict[str, float] = {}
        front_cd: dict[str, str] = {}
        for row in rows:
            if row.get("trading_session") != "position":
                continue
            cd = str(row.get("contract_date", ""))
            if not _PURE_YYYYMM.fullmatch(cd):
                continue
            d_str = row.get("date")
            try:
                close = float(row.get("close", 0))
            except (TypeError, ValueError):
                continue
            if not d_str:
                continue
            existing_cd = front_cd.get(d_str)
            if existing_cd is None or cd < existing_cd:
                by_date[d_str] = close
                front_cd[d_str] = cd
        payload = {
            "by_date": by_date,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        }
        self._write_cache_v(cache_key, payload, _CACHE_VERSION_OPTIONS_CHIP)
        return {date.fromisoformat(d): v for d, v in by_date.items()}

    @staticmethod
    def _tx_returns_from_closes(closes: dict[date, float]) -> dict[date, float]:
        """Build ``{t: (close[t+1]-close[t])/close[t]}`` from sorted closes."""
        sorted_dates = sorted(closes.keys())
        out: dict[date, float] = {}
        for i, d in enumerate(sorted_dates[:-1]):
            d_next = sorted_dates[i + 1]
            c_t = closes[d]
            c_next = closes[d_next]
            if c_t > 0:
                out[d] = (c_next - c_t) / c_t
        return out

    def _invalidate_chip_parse_caches(self, end_date: date) -> None:
        """N12 + F6 修: single sweep pattern-based invalidation across all
        lookback/threshold variants. Drops files matching
        ``{endpoint_prefix}_*_{end_iso}_*.json`` where endpoint_prefix ∈
        {max_pain_, oi_walls_, pcr_classified_} (pcr_series_ never used).
        """
        from utils.cache import chip_cache_dir

        end_iso = end_date.isoformat()
        endpoint_prefixes = ("max_pain_", "oi_walls_", "pcr_classified_")
        for p in chip_cache_dir().iterdir():
            if p.suffix != ".json":
                continue
            if (
                any(p.stem.startswith(prefix) for prefix in endpoint_prefixes)
                and f"_{end_iso}_" in p.stem
            ):
                p.unlink()

    async def fetch_max_pain(
        self,
        contract: dict,
        date_str: str,
        lookback: int = 20,
        refresh: bool = False,
    ) -> dict:
        """SC-1/SC-5 chip endpoint. design v4 §2.1.

        Caller (route) must have already done route-layer validations:
        - lookback × period ≤ CHIP_WINDOW_TD (N11)
        - contract resolved via _resolve_contract
        - trading_dates fetched via services.trading_calendar.get_trading_days
        """
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS_CHIP,
            parse_max_pain,
            parse_max_pain_hit_rate,
        )
        from services.trading_calendar import get_trading_days

        contract_id = f"{contract['option_id']}{contract['contract_date']}"
        cache_key = f"max_pain_{contract_id}_{date_str}_lb{lookback}"

        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None:
                # Today's payload must respect the 30-min stale window.
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        # 250-td shared window for chip endpoints
        end = date.fromisoformat(date_str)
        trading_dates = await get_trading_days(end, n=250)
        by_date_iso = await self.fetch_taiwan_option_daily_window(
            sorted(trading_dates),
            end_date=end,
            refresh=refresh,
        )

        # F7 修: today_rows + as_of_date 都用 non-empty 日 (empty day = publication lag)
        non_empty_dates = sorted(
            d for d, rows in by_date_iso.items() if any(r.get("open_interest", 0) > 0 for r in rows)
        )
        # Today's rows are the day's value ONLY if any of them has OI > 0;
        # otherwise (e.g. morning of trading day where only night-session
        # rows are published and all carry OI=0) fall back to the latest
        # date that actually has OI.
        candidate_today = by_date_iso.get(date_str) or []
        today_has_oi = any(r.get("open_interest", 0) > 0 for r in candidate_today)
        today_rows = (
            candidate_today
            if today_has_oi
            else (by_date_iso[non_empty_dates[-1]] if non_empty_dates else [])
        )
        current_mp = parse_max_pain(today_rows, contract["contract_date"])

        oi_by_trading_day: dict[date, list[dict]] = {
            date.fromisoformat(d_iso): rows for d_iso, rows in by_date_iso.items() if rows
        }
        # Wire settlement prices for hit_rate (CHECKPOINT follow-up done)
        settlements_all = await self.fetch_settlement_history(end, refresh=refresh)
        # Limit to most recent `lookback` settlements
        recent_settlements = (
            dict(sorted(settlements_all.items())[-lookback:]) if settlements_all else {}
        )
        hit_rate = parse_max_pain_hit_rate(
            oi_by_trading_day=oi_by_trading_day,
            settlements=recent_settlements,
        )

        result = {
            "contract": contract_id,
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "as_of_date": non_empty_dates[-1] if non_empty_dates else date_str,
            "current": current_mp,
            "hit_rate": None if hit_rate["samples"] == 0 else hit_rate,
            "latest_settlement_pending": hit_rate.get("latest_settlement_pending", False),
            "data_quality_warnings": [],
            "insufficient_data": (
                {"reason": "no_settlements_fetched_in_mvp", "required_days": 0}
                if hit_rate["samples"] == 0
                else None
            ),
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
        return result

    async def fetch_oi_walls(
        self,
        contract: dict,
        date_str: str,
        lookback: int = 20,
        delta_window: int = 5,
        refresh: bool = False,
    ) -> dict:
        """SC-2/SC-6 (design v4 §2.1)."""
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS_CHIP,
            parse_oi_walls,
            parse_oi_walls_hit_rate,
        )
        from services.trading_calendar import get_trading_days

        contract_id = f"{contract['option_id']}{contract['contract_date']}"
        cache_key = f"oi_walls_{contract_id}_{date_str}_lb{lookback}_dw{delta_window}"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        end = date.fromisoformat(date_str)
        trading_dates = await get_trading_days(end, n=250)
        by_date_iso = await self.fetch_taiwan_option_daily_window(
            sorted(trading_dates),
            end_date=end,
            refresh=refresh,
        )

        # F7 修: as_of_date / fallback today_rows 都用 non-empty 日 (避免空日蒙混)
        non_empty_dates = sorted(
            d for d, rows in by_date_iso.items() if any(r.get("open_interest", 0) > 0 for r in rows)
        )
        # Today's rows are the day's value ONLY if any of them has OI > 0;
        # otherwise (e.g. morning of trading day where only night-session
        # rows are published and all carry OI=0) fall back to the latest
        # date that actually has OI.
        candidate_today = by_date_iso.get(date_str) or []
        today_has_oi = any(r.get("open_interest", 0) > 0 for r in candidate_today)
        today_rows = (
            candidate_today
            if today_has_oi
            else (by_date_iso[non_empty_dates[-1]] if non_empty_dates else [])
        )

        # past delta_window trading days for the dynamic wall
        delta_days = (
            non_empty_dates[-(delta_window + 1) : -1]
            if len(non_empty_dates) > delta_window
            else non_empty_dates[:-1]
        )
        rows_history = [by_date_iso[d] for d in delta_days if by_date_iso[d]]

        # F1 修: fetch spot so static-wall tie-break + band_width_pct work.
        # We can't await fetch_spot here without an inner runtime; just call it.
        # fetch_spot has its own _run_once + cache, so the cost is low.
        spot_payload = await self.fetch_spot(date_str, refresh=refresh)
        spot_val = float(spot_payload.get("spot") or 0.0)

        current_walls = parse_oi_walls(
            rows_today=today_rows,
            rows_history=rows_history,
            contract_date=contract["contract_date"],
            delta_window=delta_window,
            spot=spot_val,
        )

        oi_by_trading_day: dict[date, list[dict]] = {
            date.fromisoformat(d_iso): rows for d_iso, rows in by_date_iso.items() if rows
        }
        # Wire settlement prices for hit_rate (CHECKPOINT follow-up done)
        settlements_all = await self.fetch_settlement_history(end, refresh=refresh)
        recent_settlements = (
            dict(sorted(settlements_all.items())[-lookback:]) if settlements_all else {}
        )
        # T-1 spot anchor for the wall tie-break — strictly no look-ahead.
        # fetch_tx_close_history is cheap (cached per end-date, shared with PCR).
        tx_closes = await self.fetch_tx_close_history(end, refresh=refresh)
        hit_rate = parse_oi_walls_hit_rate(
            oi_by_trading_day=oi_by_trading_day,
            settlements=recent_settlements,
            closes_by_date=tx_closes,
        )

        result = {
            "contract": contract_id,
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "as_of_date": non_empty_dates[-1] if non_empty_dates else date_str,
            "current": current_walls,
            "hit_rate": None if hit_rate["samples"] == 0 else hit_rate,
            "latest_settlement_pending": hit_rate.get("latest_settlement_pending", False),
            "data_quality_warnings": current_walls.get("data_quality_warnings", []),
            "insufficient_data": (
                {"reason": "no_settlements_fetched_in_mvp", "required_days": 0}
                if hit_rate["samples"] == 0
                else None
            ),
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
        return result

    async def fetch_pcr(
        self,
        scope: str,
        contract: dict | None,
        date_str: str,
        lookback: int = 250,
        high_pct: float = 70.0,
        low_pct: float = 30.0,
        refresh: bool = False,
    ) -> dict:
        """SC-3/SC-7 (design v4 §2.1)."""
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS_CHIP,
            parse_pcr_history,
            parse_pcr_walk_forward_percentile,
            parse_pcr_next_day_stats,
        )
        from services.trading_calendar import get_trading_days

        contract_id = f"{contract['option_id']}{contract['contract_date']}" if contract else "all"
        cache_key = (
            f"pcr_classified_{scope}_{contract_id}_{date_str}"
            f"_lb{lookback}_h{int(high_pct)}_l{int(low_pct)}"
        )
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        end = date.fromisoformat(date_str)
        trading_dates = await get_trading_days(end, n=lookback)
        by_date_iso = await self.fetch_taiwan_option_daily_window(
            sorted(trading_dates),
            end_date=end,
            refresh=refresh,
        )

        rows_by_day = {
            date.fromisoformat(d_iso): rows for d_iso, rows in by_date_iso.items() if rows
        }
        contract_date = contract["contract_date"] if contract else None
        pcr_history = parse_pcr_history(rows_by_day, scope=scope, contract_date=contract_date)
        classified, walk_warnings = parse_pcr_walk_forward_percentile(
            pcr_history,
            high_pct=high_pct,
            low_pct=low_pct,
        )

        # Current = last entry
        if classified:
            _, current_pcr, current_pct, current_region = classified[-1]
        else:
            current_pcr, current_pct, current_region = 0.0, 0.0, None

        # Wire tx_returns from TX_close history (CHECKPOINT follow-up done)
        tx_closes = await self.fetch_tx_close_history(end, refresh=refresh)
        tx_returns = self._tx_returns_from_closes(tx_closes)
        stats, stats_warnings = parse_pcr_next_day_stats(classified, tx_returns=tx_returns)

        # Use non-empty (with-OI) dates for as_of_date: by_date_iso.keys()
        # includes every requested trading_date even when FinMind returns []
        # for not-yet-published days, which would otherwise paint as_of_date
        # = today while PCR is actually yesterday's value.
        non_empty_dates = sorted(
            d for d, rows in by_date_iso.items() if any(r.get("open_interest", 0) > 0 for r in rows)
        )
        result = {
            "date": date_str,
            "scope": scope,
            "contract": contract_id if scope == "per_contract" else None,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "as_of_date": non_empty_dates[-1] if non_empty_dates else date_str,
            "current": {
                "pcr": current_pcr,
                "percentile": current_pct,
                "region": current_region,
                "thresholds": {"high_pct": high_pct, "low_pct": low_pct},
            },
            "next_day_stats": stats if any(stats[k]["samples"] > 0 for k in stats) else None,
            "data_quality_warnings": walk_warnings + stats_warnings,
            "insufficient_data": (
                {"reason": "tx_returns_not_fetched_in_mvp", "required_days": 0}
                if not stats or all(stats[k]["samples"] == 0 for k in stats)
                else None
            ),
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
        return result

    async def fetch_institutional(
        self,
        date_str: str,
        lookback: int = 60,
        corr_window: int = 60,
        refresh: bool = False,
    ) -> dict:
        """SC-4/SC-8 (design v4 §2.1)."""
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS_CHIP,
            parse_institutional,
            parse_institutional_correlation,
        )

        cache_key = f"institutional_{date_str}_lb{lookback}_cw{corr_window}"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        target = date.fromisoformat(date_str)
        # Range query (C1: pending probe verification, assumed supported for sponsor tier)
        start = (target - timedelta(days=lookback + 30)).isoformat()
        rows_day = await self._get(
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanOptionInstitutionalInvestors",
                "data_id": "TXO",
                "start_date": start,
                "end_date": date_str,
            },
        )
        rows_night: list[dict] | None
        if target >= date(2021, 10, 13):
            rows_night = await self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanOptionInstitutionalInvestorsAfterHours",
                    "data_id": "TXO",
                    "start_date": start,
                    "end_date": date_str,
                },
            )
        else:
            rows_night = None

        # Filter to target_date for "current" snapshot. If target_date isn't
        # published yet (e.g. morning of trading day), fall back to the latest
        # date actually present in rows_day so the card never blanks out.
        all_day_dates = sorted({r.get("date", "") for r in rows_day if r.get("date")})
        snapshot_date = (
            date_str
            if date_str in all_day_dates
            else (all_day_dates[-1] if all_day_dates else date_str)
        )
        today_day_rows = [r for r in rows_day if r.get("date") == snapshot_date]
        today_night_rows = (
            [r for r in (rows_night or []) if r.get("date") == snapshot_date]
            if rows_night is not None
            else None
        )
        current = parse_institutional(today_day_rows, today_night_rows, target)

        # Build foreign_history: aggregate rows_day to per-date foreign_call_net
        # using the same _INSTITUTION_NAME_MAP convention from parse_institutional.
        from services.finmind_options import _INSTITUTION_NAME_MAP

        per_date_call_net: dict[str, int] = {}
        for r in rows_day:
            d_str = r.get("date")
            inst_raw = r.get("institutional_investors") or r.get("institution", "")
            if not d_str or _INSTITUTION_NAME_MAP.get(inst_raw) != "foreign":
                continue
            side = r.get("call_put") or r.get("put_call")
            if side not in ("call", "買權"):
                continue
            try:
                long_oi = int(
                    r.get("long_open_interest_balance_volume") or r.get("buy_open_interest") or 0
                )
                short_oi = int(
                    r.get("short_open_interest_balance_volume") or r.get("sell_open_interest") or 0
                )
            except (TypeError, ValueError):
                continue
            per_date_call_net[d_str] = per_date_call_net.get(d_str, 0) + long_oi - short_oi
        foreign_history = [
            {"date": date.fromisoformat(d), "foreign_call_net": v}
            for d, v in sorted(per_date_call_net.items())
        ]
        # Reuse the TX close history fetch (also used by PCR) for next-day returns
        tx_closes = await self.fetch_tx_close_history(target, refresh=refresh)
        tx_returns = self._tx_returns_from_closes(tx_closes)

        correlation, corr_warnings = parse_institutional_correlation(
            foreign_history=foreign_history,
            tx_returns=tx_returns,
            corr_window=corr_window,
        )

        # Determine as_of_date from latest available row
        all_dates = sorted({r.get("date", "") for r in rows_day if r.get("date")})
        as_of = all_dates[-1] if all_dates else date_str

        result = {
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "as_of_date": as_of,
            "current": current["current"],
            "correlation": None if correlation["samples"] == 0 else correlation,
            "data_quality_warnings": corr_warnings,
            "insufficient_data": (
                {"reason": "insufficient_correlation_samples", "required_days": corr_window}
                if correlation["samples"] == 0
                else None
            ),
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
        return result

    # -- options cache version helpers (separate _CACHE_VERSION_OPTIONS) ---

    def _read_cache_v(self, key: str, version: int) -> dict | None:
        p = self._cache_path(key)
        if not p.exists():
            return None
        data = read_json(p, default=None)
        if data is None or data.get("_cache_version") != version:
            return None
        out = dict(data)
        out.pop("_cache_version", None)
        return out

    def _write_cache_v(self, key: str, payload: dict, version: int) -> None:
        cached = {**payload, "_cache_version": version}
        atomic_write_json(self._cache_path(key), cached)

    # -- major net series (top-15 broker net per day) ----------------------

    async def _fetch_major_series(
        self,
        symbol: str,
        trading_dates: list[str],
        pre_fetched_by_date: dict[str, list] | None = None,
    ) -> list[dict]:
        """Fetch major net series using pre-fetched SecIdAgg data + parallel fallback."""
        if not trading_dates:
            return []

        today = date.today().isoformat()
        by_date = pre_fetched_by_date if pre_fetched_by_date is not None else {}

        cached_results: dict[str, dict] = {}
        uncached_dates: list[str] = []
        for d in trading_dates:
            if d != today:
                cache_key = f"{symbol}_{d}_major"
                cached = self._read_cache(cache_key)
                if cached is not None:
                    cached_results[d] = cached
                    continue
            uncached_dates.append(d)

        if uncached_dates:
            fallback_dates: list[str] = []
            for d in uncached_dates:
                rows = by_date.get(d, [])
                if rows:
                    major_net = _compute_major_net_agg(rows)
                    entry = {"date": d, "major_net": major_net}
                    if d != today:
                        self._write_cache(f"{symbol}_{d}_major", entry)
                    cached_results[d] = entry
                else:
                    fallback_dates.append(d)

            if fallback_dates:

                async def _fetch_one(d: str) -> tuple[str, dict, bool]:
                    try:
                        day_raw = await self._get(
                            f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report",
                            {"data_id": symbol, "date": d},
                        )
                        return d, {"date": d, "major_net": _compute_major_net(day_raw)}, True
                    except Exception as exc:
                        logger.warning(
                            "TradingDailyReport fallback failed for %s %s: %s",
                            symbol,
                            d,
                            exc,
                        )
                        return d, {"date": d, "major_net": 0}, False

                results = await asyncio.gather(
                    *[_fetch_one(d) for d in fallback_dates],
                )
                for d, entry, got_data in results:
                    if d != today and got_data:
                        self._write_cache(f"{symbol}_{d}_major", entry)
                    cached_results[d] = entry

        return [cached_results.get(d, {"date": d, "major_net": 0}) for d in trading_dates]


# ---------------------------------------------------------------------------
# Pure data-transform functions
# ---------------------------------------------------------------------------


def _to_lots(shares: int) -> int:
    """股 → 張 (truncate toward zero — discard odd-lot remainder)."""
    sign = 1 if shares >= 0 else -1
    return sign * (abs(shares) // 1000)


def _compute_major_net(rows: list) -> int:
    """Compute top-15 major net from broker trading rows.

    Aggregates raw shares by broker, truncates to lots, takes top 15 buy + sell.
    """
    agg: dict[str, dict] = {}
    for r in rows:
        tid = r.get("securities_trader_id", "")
        if tid not in agg:
            agg[tid] = {"buy": 0, "sell": 0}
        agg[tid]["buy"] += int(r.get("buy", 0))
        agg[tid]["sell"] += int(r.get("sell", 0))

    nets = []
    for a in agg.values():
        nets.append(_to_lots(a["buy"]) - _to_lots(a["sell"]))

    buyers = sorted([n for n in nets if n > 0], reverse=True)[:15]
    sellers = sorted([n for n in nets if n < 0])[:15]
    return sum(buyers) + sum(sellers)


def _compute_major_net_agg(rows: list) -> int:
    """Compute top-15 major net from SecIdAgg rows (pre-aggregated by broker)."""
    nets = []
    for r in rows:
        buy_lots = _to_lots(int(r.get("buy", 0)))
        sell_lots = _to_lots(int(r.get("sell", 0)))
        nets.append(buy_lots - sell_lots)

    buyers = sorted([n for n in nets if n > 0], reverse=True)[:15]
    sellers = sorted([n for n in nets if n < 0])[:15]
    return sum(buyers) + sum(sellers)


def _parse_broker_history(rows: list) -> dict[str, list[dict]]:
    """Group SecIdAgg rows by `securities_trader_id`, aggregating (id, date)
    duplicates and converting shares → lots.

    Returns:
        {broker_id: [{date, buy, sell, net}, ...]}  values in 張 (lots).

    SecIdAgg row schema differs from TradingDailyReport:
        - quantities live in `buy_volume`/`sell_volume`, NOT `buy`/`sell`.
        - filtered server-side by `securities_trader_id`, so a response only
          contains rows for one broker; we still key by id (not name) so the
          API matches what the frontend already has in `top_brokers[].broker_id`.

    Rows with blank/whitespace-only `securities_trader_id` are skipped.
    """
    agg: dict[tuple[str, str], dict] = {}
    for r in rows:
        bid = str(r.get("securities_trader_id", "")).strip()
        if not bid:
            continue
        d = r.get("date", "")
        key = (bid, d)
        if key not in agg:
            agg[key] = {"buy_shares": 0, "sell_shares": 0}
        agg[key]["buy_shares"] += int(r.get("buy_volume", 0))
        agg[key]["sell_shares"] += int(r.get("sell_volume", 0))

    result: dict[str, list[dict]] = {}
    for (bid, d), v in agg.items():
        buy_lots = _to_lots(v["buy_shares"])
        sell_lots = _to_lots(v["sell_shares"])
        if bid not in result:
            result[bid] = []
        result[bid].append(
            {
                "date": d,
                "buy": buy_lots,
                "sell": sell_lots,
                "net": buy_lots - sell_lots,
            }
        )

    for bid in result:
        result[bid].sort(key=lambda x: x["date"])
    return result


def _filter_broker_history(payload: dict, ids: list[str]) -> dict:
    """Return a copy of payload with brokers narrowed to requested broker_ids.

    Missing keys are returned as empty lists (the frontend renders a 0-bar
    row rather than crashing), but a WARNING is logged so that an unexpected
    upstream gap surfaces in the log instead of silently producing zeros.
    """
    all_brokers = payload.get("brokers", {})
    missing = [k for k in ids if k not in all_brokers]
    if missing:
        logger.warning(
            "broker_history: %d requested key(s) not in payload: %s",
            len(missing),
            missing,
        )
    return {
        "symbol": payload.get("symbol", ""),
        "fetched_at": payload.get("fetched_at", ""),
        "last_date": payload.get("last_date", ""),
        "brokers": {bid: all_brokers.get(bid, []) for bid in ids},
    }


def _parse_institutional(rows: list) -> dict:
    """Parse single-day institutional buy/sell.

    FinMind returns values in shares (股); convert to lots (張, 1 lot = 1000 shares).
    """
    if not rows:
        z = {"buy": 0, "sell": 0, "net": 0}
        return {"foreign": z.copy(), "trust": z.copy(), "dealer": z.copy()}
    r = rows[0]
    fb = _to_lots(int(r.get("Foreign_Investor_buy", 0)))
    fs = _to_lots(int(r.get("Foreign_Investor_sell", 0)))
    tb = _to_lots(int(r.get("Investment_Trust_buy", 0)))
    ts = _to_lots(int(r.get("Investment_Trust_sell", 0)))
    db = _to_lots(int(r.get("Dealer_self_buy", 0)) + int(r.get("Dealer_Hedging_buy", 0)))
    ds = _to_lots(int(r.get("Dealer_self_sell", 0)) + int(r.get("Dealer_Hedging_sell", 0)))
    return {
        "foreign": {"buy": fb, "sell": fs, "net": fb - fs},
        "trust": {"buy": tb, "sell": ts, "net": tb - ts},
        "dealer": {"buy": db, "sell": ds, "net": db - ds},
    }


def _parse_margin(rows: list) -> dict:
    if not rows:
        return {
            "margin_purchase": {"balance": 0, "change": 0, "limit": 0},
            "short_sale": {"balance": 0, "change": 0, "limit": 0},
            "short_balance_ratio": 0,
        }
    r = rows[0]
    mp_bal = int(r.get("MarginPurchaseTodayBalance", 0))
    mp_yest = int(r.get("MarginPurchaseYesterdayBalance", 0))
    mp_lim = int(r.get("MarginPurchaseLimit", 0))
    ss_bal = int(r.get("ShortSaleTodayBalance", 0))
    ss_yest = int(r.get("ShortSaleYesterdayBalance", 0))
    ss_lim = int(r.get("ShortSaleLimit", 0))
    ratio = round(ss_bal / mp_bal * 100, 2) if mp_bal > 0 else 0
    return {
        "margin_purchase": {"balance": mp_bal, "change": mp_bal - mp_yest, "limit": mp_lim},
        "short_sale": {"balance": ss_bal, "change": ss_bal - ss_yest, "limit": ss_lim},
        "short_balance_ratio": ratio,
    }


def _parse_top_brokers(rows: list) -> list[dict]:
    """Parse broker-level buy/sell.

    FinMind TradingDailyReport returns buy/sell in shares (股);
    convert to lots (張, 1 lot = 1000 shares).
    Weighted-average price is computed in share-space first, then output.
    """
    agg: dict[str, dict] = {}
    for r in rows:
        tid = r.get("securities_trader_id", "")
        if tid not in agg:
            agg[tid] = {
                "name": r.get("securities_trader", ""),
                "broker_id": tid,
                "buy": 0,
                "sell": 0,
                "_bp_sum": 0.0,
                "_sp_sum": 0.0,
                "_b_cnt": 0,
                "_s_cnt": 0,
            }
        a = agg[tid]
        bv = int(r.get("buy", 0))
        sv = int(r.get("sell", 0))
        price = float(r.get("price", 0))
        a["buy"] += bv
        a["sell"] += sv
        if bv > 0:
            a["_bp_sum"] += price * bv
            a["_b_cnt"] += bv
        if sv > 0:
            a["_sp_sum"] += price * sv
            a["_s_cnt"] += sv

    brokers = []
    for a in agg.values():
        buy_lots = _to_lots(a["buy"])
        sell_lots = _to_lots(a["sell"])
        net = buy_lots - sell_lots
        brokers.append(
            {
                "name": a["name"],
                "broker_id": a["broker_id"],
                "buy": buy_lots,
                "sell": sell_lots,
                "net": net,
                "avg_buy_price": round(a["_bp_sum"] / a["_b_cnt"], 2) if a["_b_cnt"] > 0 else 0,
                "avg_sell_price": round(a["_sp_sum"] / a["_s_cnt"], 2) if a["_s_cnt"] > 0 else 0,
            }
        )
    brokers.sort(key=lambda b: abs(b["net"]), reverse=True)
    return brokers


def _parse_institutional_series(rows: list) -> list[dict]:
    """Parse multi-day institutional net series.

    FinMind returns values in shares (股); convert to lots (張).
    """
    result = []
    for r in rows:
        fb = int(r.get("Foreign_Investor_buy", 0))
        fs = int(r.get("Foreign_Investor_sell", 0))
        tb = int(r.get("Investment_Trust_buy", 0))
        ts = int(r.get("Investment_Trust_sell", 0))
        db = int(r.get("Dealer_self_buy", 0)) + int(r.get("Dealer_Hedging_buy", 0))
        ds = int(r.get("Dealer_self_sell", 0)) + int(r.get("Dealer_Hedging_sell", 0))
        f_net = _to_lots(fb) - _to_lots(fs)
        t_net = _to_lots(tb) - _to_lots(ts)
        d_net = _to_lots(db) - _to_lots(ds)
        result.append(
            {
                "date": r["date"],
                "foreign_net": f_net,
                "trust_net": t_net,
                "dealer_net": d_net,
                "major_net": f_net + t_net + d_net,
            }
        )
    return result


def _parse_margin_series(rows: list) -> list[dict]:
    result = []
    for r in rows:
        mp = int(r.get("MarginPurchaseTodayBalance", 0))
        mp_yest = int(r.get("MarginPurchaseYesterdayBalance", 0))
        ss = int(r.get("ShortSaleTodayBalance", 0))
        ss_yest = int(r.get("ShortSaleYesterdayBalance", 0))
        result.append(
            {
                "date": r["date"],
                "margin_balance": mp,
                "short_balance": ss,
                "margin_change": mp - mp_yest,
                "short_change": ss - ss_yest,
            }
        )
    return result
