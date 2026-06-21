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
_CACHE_VERSION = 1

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
                if last >= date.today().isoformat():
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

    # -- major net series (top-15 broker net per day) ----------------------

    async def _fetch_major_series(
        self, symbol: str, trading_dates: list[str],
    ) -> list[dict]:
        """Fetch major net series via SecIdAgg (single batch API call)."""
        if not trading_dates:
            return []

        today = date.today().isoformat()

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
            start = min(uncached_dates)
            end = max(uncached_dates)
            try:
                raw = await self._get(
                    f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report_secid_agg",
                    {"data_id": symbol, "start_date": start, "end_date": end},
                )
            except Exception as exc:
                logger.warning("SecIdAgg batch fetch failed: %s", exc)
                raw = []

            by_date: dict[str, list] = {}
            for r in raw:
                d = r.get("date", "")
                if d not in by_date:
                    by_date[d] = []
                by_date[d].append(r)

            for d in uncached_dates:
                rows = by_date.get(d, [])
                major_net = _compute_major_net_agg(rows)
                entry = {"date": d, "major_net": major_net}
                if d != today:
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
