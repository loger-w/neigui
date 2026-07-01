"""Market snapshot fetch + aggregate + leaderboard.

Sibling to services/finmind.py — shares FinMindClient (HTTP / token /
rate limiter) via get_finmind() but isolates its own cache version + TTL
for the realtime universe / sector_map / market_value stream.

Cache versions:
- _CACHE_VERSION_REALTIME = 1

TTLs:
- universe snapshot: 5 s (intraday live)
- sector_map: 24 h (TaiwanStockInfo 慢動)
- market_value: 24 h (EOD 上一交易日值)

design.md §5
"""

from __future__ import annotations

import asyncio

from services import clock
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from services.finmind import get_finmind
from services.market_universe import fetch_disposition_stocks, filter_universe
from services.trading_calendar import get_trading_days
from services.trading_session import TPE_TZ, is_in_session
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_FINMIND_BASE = "https://api.finmindtrade.com/api/v4"
_CACHE_VERSION_REALTIME = 1
_UNIVERSE_TTL_SECONDS = 5
_SECTOR_MAP_TTL_HOURS = 24
_MARKET_VALUE_TTL_HOURS = 24
_HEATMAP_STOCKS_CAP_PER_SECTOR = 30  # v3 F8
_LEADERBOARD_SIZE = 30

_PRIMARY_INDUSTRY_OVERRIDE: dict[str, str] = {
    "2330": "半導體業",
    "2454": "半導體業",
    "2317": "其他電子業",
    "2308": "電子零組件業",
    "2382": "電子工業",
    "2412": "通信網路業",
    "2882": "金融保險業",
    "2891": "金融保險業",
    "1216": "食品工業",
    "1101": "水泥工業",
}


# Module-level inflight dedup (對齊 finmind.py:69 慣例)
_inflight: dict[str, asyncio.Task] = {}


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------


def _cache_path(key: str) -> Path:
    return chip_cache_dir() / f"{key}.json"


def _read_cache(key: str) -> dict | None:
    p = _cache_path(key)
    if not p.exists():
        return None
    data = read_json(p, default=None)
    if data is None:
        return None
    if data.get("_cache_version") != _CACHE_VERSION_REALTIME:
        return None
    data.pop("_cache_version", None)
    return data


def _write_cache(key: str, payload: dict) -> None:
    cached = {**payload, "_cache_version": _CACHE_VERSION_REALTIME}
    atomic_write_json(_cache_path(key), cached)


def _is_fresh(cached: dict, ttl_seconds: float) -> bool:
    fetched_at = cached.get("fetched_at", "")
    if not fetched_at:
        return False
    try:
        dt = datetime.fromisoformat(fetched_at)
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TPE_TZ)
    age = (datetime.now(tz=TPE_TZ) - dt).total_seconds()
    return age < ttl_seconds


async def _run_once(key: str, coro_fn):
    if key in _inflight:
        return await _inflight[key]
    _inflight[key] = asyncio.ensure_future(coro_fn())
    try:
        return await _inflight[key]
    finally:
        _inflight.pop(key, None)


# ---------------------------------------------------------------------------
# Sector dedup (v3 §5.3 deterministic)
# ---------------------------------------------------------------------------


def _build_name_map(rows: list[dict]) -> dict[str, str]:
    """Build stock_id -> stock_name lookup from TaiwanStockInfo rows.

    Phase 6 real-env fix:snapshot endpoint 不回 name,frontend 顯示
    'stock_id stock_id'。TaiwanStockInfo 已有 stock_name 欄,順手 build。
    """
    out: dict[str, str] = {}
    # Sort by date desc so latest name wins for re-listed stocks
    sorted_rows = sorted(rows, key=lambda r: r.get("date") or "", reverse=True)
    for row in sorted_rows:
        sid = row.get("stock_id")
        name = row.get("stock_name")
        if sid and name and sid not in out:
            out[sid] = name
    return out


def _dedup_sector_map(rows: list[dict]) -> dict[str, str]:
    """Build stock_id -> primary industry_category (deterministic).

    Tie-breaker order:
    1. _PRIMARY_INDUSTRY_OVERRIDE 命中直接取
    2. filter type in ("twse", "tpex")
    3. stable two-pass sort: (industry_category ASC), (date DESC)
    4. 取 first row per stock_id

    R10(Phase 4 review):當 same-date 多 row 走 tie-breaker 用 Unicode
    codepoint ASC 排,可能挑出非直覺 sector(e.g. 「光電業」codepoint <
    「電子工業」,即使 user 更熟悉後者)。短期 10 個 override 覆蓋台股
    top 權值股;Phase 0b-2 probe 後擴 override table 或改 strategy。
    """
    out: dict[str, str] = {}
    filtered = [r for r in rows if r.get("type") in ("twse", "tpex")]
    # v3 F9 — Python stable sort two-pass:secondary key ASC 先,primary key DESC 後
    sorted_rows = sorted(
        sorted(filtered, key=lambda r: r.get("industry_category") or ""),
        key=lambda r: r.get("date") or "",
        reverse=True,
    )
    for row in sorted_rows:
        sid = row.get("stock_id")
        if not sid or sid in out:
            continue
        if sid in _PRIMARY_INDUSTRY_OVERRIDE:
            out[sid] = _PRIMARY_INDUSTRY_OVERRIDE[sid]
        else:
            cat = row.get("industry_category")
            out[sid] = cat if cat else "其他"
    return out


# ---------------------------------------------------------------------------
# Tick timestamp extraction
# ---------------------------------------------------------------------------


def _max_tick_date(universe: list[dict]) -> datetime | None:
    """Parse universe[].date (ISO string) → max datetime; None if empty.

    R2(Phase 4 review):若 raw 帶 'Z' 尾(UTC ISO),先 parse 為 aware UTC
    再 astimezone(TPE_TZ),避免 strip Z 後當 naive→ is_in_session 視為 TPE
    而產生 8h skew(CLAUDE.md §9 timezone trap)。
    """
    if not universe:
        return None
    parsed: list[datetime] = []
    for row in universe:
        raw = row.get("date")
        if not raw:
            continue
        try:
            s = str(raw).replace("T", " ")
            has_z = s.endswith("Z")
            if has_z:
                s = s[:-1]
            dt = datetime.fromisoformat(s)
            if has_z:
                # 標記 UTC → 拉到 TPE 時間
                dt = dt.replace(tzinfo=timezone.utc).astimezone(TPE_TZ)
            parsed.append(dt)
        except ValueError:
            continue
    if not parsed:
        return None
    return max(parsed)


# ---------------------------------------------------------------------------
# Trim row + leaderboards
# ---------------------------------------------------------------------------


def _trim(rows: list[dict]) -> list[dict]:
    """v3 F5 — includes volume_ratio (None if missing)."""
    return [
        {
            "stock_id": r["stock_id"],
            "name": r.get("name") or r["stock_id"],
            "change_rate": r.get("change_rate") or 0.0,
            "total_amount": r.get("total_amount") or 0,
            "volume_ratio": r.get("volume_ratio"),
            "sector": r.get("sector") or "其他",
        }
        for r in rows
    ]


def _compute_leaderboards(
    universe: list[dict],
    primary_sector: dict[str, str],
    name_map: dict[str, str] | None = None,
    size: int = _LEADERBOARD_SIZE,
) -> dict[str, list[dict]]:
    name_map = name_map or {}
    enriched = [
        {
            **row,
            "sector": primary_sector.get(row.get("stock_id", ""), "其他"),
            "name": name_map.get(row.get("stock_id", "")) or row.get("name") or row.get("stock_id", ""),
        }
        for row in universe
    ]
    gainers = sorted(enriched, key=lambda r: r.get("change_rate") or 0.0, reverse=True)[:size]
    losers = sorted(enriched, key=lambda r: r.get("change_rate") or 0.0)[:size]
    amount = sorted(enriched, key=lambda r: r.get("total_amount") or 0, reverse=True)[:size]
    vr = sorted(enriched, key=lambda r: r.get("volume_ratio") or 0.0, reverse=True)[:size]
    return {
        "gainers": _trim(gainers),
        "losers": _trim(losers),
        "amount": _trim(amount),
        "volume_ratio": _trim(vr),
    }


# ---------------------------------------------------------------------------
# Group by sector (heatmap)
# ---------------------------------------------------------------------------


def _group_by_sector(
    universe: list[dict],
    primary_sector: dict[str, str],
    mv_map: dict[str, int],
    name_map: dict[str, str] | None = None,
    cap_per_sector: int = _HEATMAP_STOCKS_CAP_PER_SECTOR,
) -> list[dict]:
    """Build sectors[] for heatmap (design.md §6.6)."""
    name_map = name_map or {}
    groups: dict[str, list[dict]] = {}
    for row in universe:
        sid = row.get("stock_id")
        if not sid:
            continue
        sector = primary_sector.get(sid) or "其他"
        groups.setdefault(sector, []).append(row)

    sectors: list[dict] = []
    for sector_id, rows in groups.items():
        # Audit X12:從 per-iteration def _mv 改 inline lambda — _mv 只 close
        # over mv_map(loop 外不變),原寫法每個 sector 重新 allocate function
        # object;inline 後讀者也不用驗證閉包沒抓到 sector_id / rows 迴圈變數。
        rows_sorted = sorted(
            rows,
            key=lambda r: mv_map.get(r.get("stock_id", ""), 0),
            reverse=True,
        )
        capped = rows_sorted[:cap_per_sector]
        # Compute sector-level stats
        change_rates = [r.get("change_rate") or 0.0 for r in capped]
        avg_chg = sum(change_rates) / len(change_rates) if change_rates else 0.0
        total_amount = sum(r.get("total_amount") or 0 for r in capped)
        # Build stock tiles
        stocks = []
        for r in capped:
            sid = r["stock_id"]
            mv = mv_map.get(sid)
            stocks.append({
                "stock_id": sid,
                "name": name_map.get(sid) or r.get("name") or sid,
                "change_rate": r.get("change_rate") or 0.0,
                "total_amount": r.get("total_amount") or 0,
                "market_value": mv,
            })
        sectors.append({
            "id": sector_id,
            "name": sector_id,
            "member_count": len(rows),
            "avg_change_rate": avg_chg,
            "total_amount": total_amount,
            "stocks": stocks,
        })
    return sectors


# ---------------------------------------------------------------------------
# Internal fetchers — universe / sector_map / market_value
# ---------------------------------------------------------------------------


async def _fetch_universe(refresh: bool = False) -> list[dict]:
    """Call FinMind taiwan_stock_tick_snapshot;cache 5 s on disk."""
    cache_key = "realtime_universe"
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None and _is_fresh(cached, _UNIVERSE_TTL_SECONDS):
            return cached.get("rows", [])
    client = get_finmind()
    rows = await client._get(  # type: ignore[attr-defined]
        f"{_FINMIND_BASE}/taiwan_stock_tick_snapshot",
        {},
    )
    _write_cache(cache_key, {
        "rows": rows,
        "fetched_at": datetime.now(tz=TPE_TZ).isoformat(timespec="seconds"),
    })
    return rows


async def _fetch_sector_map(refresh: bool = False) -> list[dict]:
    """Call FinMind /data?dataset=TaiwanStockInfo;cache 24 h on disk.

    R4(Phase 4 review):refresh=True 跳 cache 重抓,對齊 CLAUDE.md §4
    `?refresh=true` 慣例(half-honored before)。
    """
    cache_key = "realtime_sector_map"
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None and _is_fresh(cached, _SECTOR_MAP_TTL_HOURS * 3600):
            return cached.get("rows", [])
    client = get_finmind()
    rows = await client._get(  # type: ignore[attr-defined]
        f"{_FINMIND_BASE}/data",
        {"dataset": "TaiwanStockInfo"},
    )
    _write_cache(cache_key, {
        "rows": rows,
        "fetched_at": datetime.now(tz=TPE_TZ).isoformat(timespec="seconds"),
    })
    return rows


async def _fetch_watch_list(refresh: bool = False) -> set[str]:
    """Thin wrapper over market_universe.fetch_disposition_stocks for patchability.

    market-monitor-v2 P1:套 universe filter 前先抓今日處置股清單。失敗時上層
    `_do_fetch_market_snapshot` 視為空 set,不阻塞 snapshot(snapshot 仍可回,
    只是 watch_list 不會排除任何 stock)。
    """
    return await fetch_disposition_stocks(refresh=refresh)


async def _fetch_breadth(
    end_date: date,
    universe: set[str],
    refresh: bool = False,
) -> dict | None:
    """market-monitor-v2 P2 (SC-6) — delegate to market_breadth.compute_breadth.

    Empty universe → None(silent skip,不 raise)。
    Exception path 由 caller 用 try/except (httpx.HTTPError, ValueError) 處理(F6:
    breadth fail 不動 stale,是 EOD data ≠ intraday degradation)。
    """
    if not universe:
        return None
    from services import market_breadth as mb  # 延 import 避 potential circular

    return await mb.compute_breadth(end_date, universe, refresh=refresh)


async def _fetch_market_value_map(
    today: date | None = None,
    refresh: bool = False,
) -> dict[str, int]:
    """Call FinMind /data?dataset=TaiwanStockMarketValue with start=end=T-1 trading day.
    Return dict[stock_id, market_value]。

    R4(Phase 4 review):refresh=True 跳 cache 重抓。
    Audit X3:從 calendar T-1 (today - 1 day) 改用 trading_calendar 的 T-1
    交易日,解決週一/連假後抓到非交易日空資料 → tile fallback 退到 weight=1
    導致整張 heatmap 等格的 SC-2 契約問題。
    """
    cache_key = "realtime_market_value"
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None and _is_fresh(cached, _MARKET_VALUE_TTL_HOURS * 3600):
            return cached.get("by_id", {})
    if today is None:
        today = clock.today()
    # Audit X3:取「今天之前(含)」的最近交易日 → 確保即使週一也對到上週五
    # trading_calendar 有 12h cache + 自有 TaiwanFuturesDaily probe,失敗時退到
    # calendar T-1 保命(不阻塞 mv 抓取,只是日期會精度退化)。
    try:
        trading_days = await get_trading_days(today - timedelta(days=1), 1)
    except Exception:
        logger.exception("trading_calendar lookup failed; fallback to calendar T-1")
        trading_days = []
    t_minus_1 = trading_days[0] if trading_days else today - timedelta(days=1)
    client = get_finmind()
    rows = await client._get(  # type: ignore[attr-defined]
        f"{_FINMIND_BASE}/data",
        {
            "dataset": "TaiwanStockMarketValue",
            "start_date": t_minus_1.isoformat(),
            "end_date": t_minus_1.isoformat(),
        },
    )
    by_id: dict[str, int] = {}
    for r in rows:
        sid = r.get("stock_id")
        mv = r.get("market_value")
        if sid and mv:
            try:
                by_id[sid] = int(mv)
            except (TypeError, ValueError):
                continue
    _write_cache(cache_key, {
        "by_id": by_id,
        "fetched_at": datetime.now(tz=TPE_TZ).isoformat(timespec="seconds"),
    })
    return by_id


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def fetch_market_snapshot(refresh: bool = False) -> dict:
    """Return MarketSnapshot dict matching design.md §4 contract.

    On any FinMind upstream failure:
        - if disk cache 兜底:return {**cached_universe_payload, "stale": True}
        - else raise ValueError("finmind_unreachable") — caught by routes layer → 502
    """
    dedup_key = f"market_snapshot_r{int(refresh)}"
    return await _run_once(dedup_key, lambda: _do_fetch_market_snapshot(refresh))


async def _do_fetch_market_snapshot(refresh: bool) -> dict:
    # Parallel fetch — return_exceptions=True so partial failure → stale fallback
    results = await asyncio.gather(
        _fetch_universe(refresh),
        _fetch_sector_map(refresh=refresh),
        _fetch_market_value_map(refresh=refresh),
        _fetch_watch_list(refresh=refresh),
        return_exceptions=True,
    )
    universe_res, sector_res, mv_res, watch_res = results

    if isinstance(universe_res, BaseException):
        cached = _read_cache("realtime_universe")
        if cached is None:
            logger.warning(
                "market snapshot: universe fetch failed and no disk cache: %s",
                universe_res,
            )
            raise ValueError("finmind_unreachable") from universe_res
        universe = cached.get("rows", [])
    else:
        universe = universe_res  # type: ignore[assignment]

    if isinstance(sector_res, BaseException):
        cached = _read_cache("realtime_sector_map")
        sector_rows = cached.get("rows", []) if cached else []
    else:
        sector_rows = sector_res  # type: ignore[assignment]

    if isinstance(mv_res, BaseException):
        cached = _read_cache("realtime_market_value")
        mv_map = cached.get("by_id", {}) if cached else {}
    else:
        mv_map = mv_res  # type: ignore[assignment]

    watch_degraded = isinstance(watch_res, BaseException)
    if watch_degraded:
        logger.warning(
            "market snapshot: watch_list fetch failed, treating as empty: %s",
            watch_res,
        )
        watch_list: set[str] = set()
    else:
        watch_list = watch_res  # type: ignore[assignment]

    primary_sector = _dedup_sector_map(sector_rows)
    name_map = _build_name_map(sector_rows)
    last_tick = _max_tick_date(universe)
    now = datetime.now(tz=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    # Phase 6 fix + Audit X1 revision:走 whitelist `r.stock_id in primary_sector`
    # 把 taiwan_stock_tick_snapshot 的 index rows(001 加權指數 / 036 半導體業類股
    # 指數 / 等 ~49 個 3-digit ID,FinMind TaiwanStockInfo 並未收錄)天然排除。
    # CLAUDE.md §9 lesson 明文背書這個策略,§9 也警告不要走 pattern filter。
    #
    # Audit X1 trade-off accepted:當 sector_map 冷啟動 fail + no cache 時 primary
    # _sector 為空 → 整 universe 被剃掉 → stocks=[] / sectors=[]。為避免 silent
    # blank dashboard,下面 sector_degraded 旗標把 stale=True 拉起來,前端 banner
    # 會顯示「資料停滯」提示。
    # 新上市未及收錄個股的 24h 隱形期同樣記為 known limitation(brainstorm E1
    # 文字略寬於現況,以 doc 為註腳)。
    stock_universe = [r for r in universe if r.get("stock_id") in primary_sector]
    # market-monitor-v2 P1: 套 universe filter — 排除 ETF prefix `00` / 6 位
    # 數權證 / 處置股。Whitelist 已天然排除 index(non-4-digit 通常 sector_map
    # 也沒收),P1 再加一層 structural filter 保險 + 把處置股動態剔除。
    universe_filter = filter_universe(
        [r.get("stock_id", "") for r in stock_universe],
        watch_list=watch_list,
    )
    allowed = universe_filter["universe"]
    excluded = universe_filter["excluded"]
    stock_universe = [r for r in stock_universe if r.get("stock_id") in allowed]
    sectors = _group_by_sector(stock_universe, primary_sector, mv_map, name_map=name_map)
    leaderboards = _compute_leaderboards(stock_universe, primary_sector, name_map=name_map)

    # Stale 規則(Phase 4 R3 + Audit X1):
    # - universe failure(intraday tick 不推進)→ user 體感「資料停滯」 → stale=True
    # - sector_map 失敗且無 cache 兜底(primary_sector 為空)→ dashboard 退化成空頁
    #   → 同樣 stale=True,讓 banner 拉起來;否則 silent empty
    # - sector_map / mv 失敗但有 cache 兜底 → stale=False(24h daily cache,user
    #   感受不到)
    sector_degraded = not primary_sector
    # Phase 4 review P2 fix:watch_list 過濾失效是真實 user-facing 降級
    # (處置股可能漏進 leaderboards / sectors)→ 必須拉 stale=True 讓
    # frontend banner 警示。否則 silent fallback 讓使用者看到本該排除的
    # 處置股無任何提示。
    stale = isinstance(universe_res, BaseException) or sector_degraded or watch_degraded

    # market-monitor-v2 P2 (SC-6) — breadth (McClellan Oscillator + AD Line)
    # F6: breadth compute fail (EOD data) 不動 stale;stale 保留給 intraday
    # (universe / sector_map / watch_list) 三個訊號。
    try:
        breadth = await _fetch_breadth(clock.today(), allowed, refresh=refresh)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("market snapshot: breadth compute failed: %s", exc)
        breadth = None

    return {
        "as_of": now.isoformat(),
        "last_tick": last_tick.isoformat() if last_tick else None,
        "is_trading_session": in_session,
        "stale": stale,
        "lag_seconds": lag,
        "sectors": sectors,
        "leaderboards": leaderboards,
        # market-monitor-v2 P1 — spec §8 contract
        "universe_size": len(allowed),
        "excluded_count": {
            "etf": len(excluded["etf"]),
            "warrant": len(excluded["warrant"]),
            "watch_list": len(excluded["watch_list"]),
        },
        # market-monitor-v2 P2 (SC-6) — breadth field (None if compute failed)
        "breadth": breadth,
    }
