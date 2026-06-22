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
        self, symbol: str, date_str: str, refresh: bool = False,
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
        self, symbol: str, date_str: str, cache_key: str,
    ) -> dict:
        inst_raw, margin_raw, broker_raw = await asyncio.gather(
            self._get(
                f"{_FINMIND_BASE}/data",
                {"dataset": "TaiwanStockInstitutionalInvestorsBuySellWide",
                 "data_id": symbol, "start_date": date_str, "end_date": date_str},
            ),
            self._get(
                f"{_FINMIND_BASE}/data",
                {"dataset": "TaiwanStockMarginPurchaseShortSale",
                 "data_id": symbol, "start_date": date_str, "end_date": date_str},
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
        self, symbol: str, date_str: str, refresh: bool = False,
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
        self, symbol: str, date_str: str, cache_key: str,
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

    # -- history (60-day candles + institutional + margin) -------------------

    async def fetch_chip_history(
        self, symbol: str, refresh: bool = False,
    ) -> dict:
        cache_key = f"{symbol}_history"
        if not refresh:
            cached = self._read_cache(cache_key)
            if cached is not None:
                last = cached.get("last_date", "")
                # Bug #2 fix: once last_date == today, the cache was previously
                # served indefinitely until next-day rollover, so browser F5
                # (refresh=false) returned the same JSON written hours ago.
                # Now apply 15-min TTL when cache is from today; pre-today
                # always falls through and re-fetches the new day's bar.
                if last >= date.today().isoformat() and not self._is_stale(
                    cached, max_age_minutes=15,
                ):
                    return cached

        return await self._run_once(
            f"history_{cache_key}",
            lambda: self._do_fetch_history(symbol, cache_key),
        )

    async def _do_fetch_history(self, symbol: str, cache_key: str) -> dict:
        end = date.today()
        start = end - timedelta(days=90)
        s, e = start.isoformat(), end.isoformat()

        candles_raw, inst_raw, margin_raw = await asyncio.gather(
            self._get(
                f"{_FINMIND_BASE}/data",
                {"dataset": "TaiwanStockPrice",
                 "data_id": symbol, "start_date": s, "end_date": e},
            ),
            self._get(
                f"{_FINMIND_BASE}/data",
                {"dataset": "TaiwanStockInstitutionalInvestorsBuySellWide",
                 "data_id": symbol, "start_date": s, "end_date": e},
            ),
            self._get(
                f"{_FINMIND_BASE}/data",
                {"dataset": "TaiwanStockMarginPurchaseShortSale",
                 "data_id": symbol, "start_date": s, "end_date": e},
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
        self, symbol: str, start: str, end: str, trader_id: str,
    ) -> list:
        """FinMind's SecIdAgg endpoint REQUIRES `securities_trader_id`. Returns
        [] on any HTTP/network/parse failure (the caller treats missing rows
        as "no data for this broker", which is the same outcome as an
        unavailable upstream)."""
        try:
            return await self._get(
                f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report_secid_agg",
                {"data_id": symbol, "start_date": start, "end_date": end,
                 "securities_trader_id": trader_id},
            )
        except Exception as exc:
            logger.warning(
                "SecIdAgg fetch failed for %s/%s: %s", symbol, trader_id, exc,
            )
            return []

    # -- broker history -----------------------------------------------------

    async def fetch_broker_history(
        self, symbol: str, ids: list[str], refresh: bool = False,
    ) -> dict:
        """`ids` are broker_ids (FinMind `securities_trader_id`) — same values
        the frontend already receives in `top_brokers[].broker_id`. The cache
        is partial per-symbol: brokers fetched in prior requests stay cached
        across sessions; new ids on this request are fetched + merged."""
        cache_key = f"{symbol}_broker_history"
        if not refresh:
            cached = self._read_cache(cache_key)
            if cached is not None and self._has_fresh_subset(cached, ids):
                return _filter_broker_history(cached, ids)

        payload = await self._run_once(
            f"broker_history_{symbol}_{','.join(sorted(set(ids)))}",
            lambda: self._do_fetch_broker_history(symbol, cache_key, ids),
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
        self, symbol: str, cache_key: str, ids: list[str],
    ) -> dict:
        existing = self._read_cache(cache_key) or {
            "symbol": symbol, "fetched_at": "", "last_date": "",
            "brokers": {},
        }
        existing_brokers: dict[str, list] = dict(existing.get("brokers", {}))

        # Refetch all requested ids — caller decides freshness; we always
        # overwrite to pick up newly-traded dates. Brokers absent from `ids`
        # but present in cache stay cached (sticky across sessions).
        end = date.today()
        start = end - timedelta(days=90)
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
                            symbol, d, exc,
                        )
                        return d, {"date": d, "major_net": 0}, False

                results = await asyncio.gather(
                    *[_fetch_one(d) for d in fallback_dates],
                )
                for d, entry, got_data in results:
                    if d != today and got_data:
                        self._write_cache(f"{symbol}_{d}_major", entry)
                    cached_results[d] = entry

        return [cached_results.get(d, {"date": d, "major_net": 0})
                for d in trading_dates]


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
        result[bid].append({
            "date": d,
            "buy": buy_lots,
            "sell": sell_lots,
            "net": buy_lots - sell_lots,
        })

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
            len(missing), missing,
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
                "buy": 0, "sell": 0,
                "_bp_sum": 0.0, "_sp_sum": 0.0, "_b_cnt": 0, "_s_cnt": 0,
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
        brokers.append({
            "name": a["name"],
            "broker_id": a["broker_id"],
            "buy": buy_lots,
            "sell": sell_lots,
            "net": net,
            "avg_buy_price": round(a["_bp_sum"] / a["_b_cnt"], 2) if a["_b_cnt"] > 0 else 0,
            "avg_sell_price": round(a["_sp_sum"] / a["_s_cnt"], 2) if a["_s_cnt"] > 0 else 0,
        })
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
        result.append({
            "date": r["date"],
            "foreign_net": f_net,
            "trust_net": t_net,
            "dealer_net": d_net,
            "major_net": f_net + t_net + d_net,
        })
    return result


def _parse_margin_series(rows: list) -> list[dict]:
    result = []
    for r in rows:
        mp = int(r.get("MarginPurchaseTodayBalance", 0))
        mp_yest = int(r.get("MarginPurchaseYesterdayBalance", 0))
        ss = int(r.get("ShortSaleTodayBalance", 0))
        ss_yest = int(r.get("ShortSaleYesterdayBalance", 0))
        result.append({
            "date": r["date"],
            "margin_balance": mp,
            "short_balance": ss,
            "margin_change": mp - mp_yest,
            "short_change": ss - ss_yest,
        })
    return result
