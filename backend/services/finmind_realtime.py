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
import hashlib
import time

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
    # bug sector-override-phantom:value 必須是 TaiwanStockInfo 真實
    # industry_category 字串(「金融保險」無「業」尾),否則自成幽靈 sector
    "2882": "金融保險",
    "2891": "金融保險",
    "1216": "食品工業",
    "1101": "水泥工業",
}


# Module-level inflight dedup (對齊 finmind.py:69 慣例)
# {key: {"task": Task, "refs": int}} — subscriber refcount(見 _run_once docstring)
_inflight: dict[str, dict] = {}


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
    """Inflight dedup with subscriber refcount(對齊 finmind.py::_run_once)。

    2026-07-03 prd 500 修正:舊版直接 `await _inflight[key]` — asyncio 的
    task cancel 會把取消傳進正在 await 的 future,第一個斷線請求(Vercel
    30s 超時 → run_with_disconnect cancel)就把共用 task 殺掉,其他共乘
    請求全部收 CancelledError。改 shield + refcount:subscriber 歸 0 才
    cancel 底層 task。
    """
    entry = _inflight.get(key)
    if entry is None:
        entry = {"task": asyncio.ensure_future(coro_fn()), "refs": 0}
        _inflight[key] = entry
    entry["refs"] += 1
    try:
        return await asyncio.shield(entry["task"])
    finally:
        entry["refs"] -= 1
        if entry["refs"] == 0:
            if not entry["task"].done():
                entry["task"].cancel()
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
    prices: list[dict] | None = None,
) -> dict | None:
    """market-monitor-v2 P2 (SC-6) — delegate to market_breadth.compute_breadth.

    Empty universe → None(silent skip,不 raise)。
    Exception path 由 caller 用 try/except (httpx.HTTPError, ValueError) 處理(F6:
    breadth fail 不動 stale,是 EOD data ≠ intraday degradation)。
    """
    if not universe:
        return None
    from services import market_breadth as mb  # 延 import 避 potential circular

    return await mb.compute_breadth(end_date, universe, refresh=refresh, prices=prices)


async def _fetch_sector_breadth(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
    prices: list[dict] | None = None,
) -> list[dict] | None:
    """market-monitor-v2 P3 (SC-6) — delegate to sector_aggregation.compute_sector_breadth.

    Empty universe → None (silent skip). F6 sequel: exceptions propagate to
    caller's try/except httpx.HTTPError only (design v2 F3: aggregation returns
    [] on empty prices instead of raising).
    """
    if not universe:
        return None
    from services import sector_aggregation as sa

    return await sa.compute_sector_breadth(
        end_date, universe, sector_map, refresh=refresh, prices=prices
    )


async def _fetch_sector_volume_ratio(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
    prices: list[dict] | None = None,
) -> list[dict] | None:
    """market-monitor-v2 P3 (SC-6) — delegate to sector_aggregation.compute_sector_volume_ratio。

    Empty universe → None (silent skip)。同 _fetch_sector_breadth F6 sequel。
    """
    if not universe:
        return None
    from services import sector_aggregation as sa

    return await sa.compute_sector_volume_ratio(
        end_date, universe, sector_map, refresh=refresh, prices=prices
    )


async def _fetch_sector_amount_share(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
    prices: list[dict] | None = None,
) -> list[dict] | None:
    """market-monitor-v2 P4 (SC-6) — delegate to sector_aggregation.compute_sector_amount_share.

    Empty universe → None (silent skip)。F6 sequel:exceptions propagate to
    caller's try/except httpx.HTTPError only(aggregation empty prices → [] 不 raise)。
    """
    if not universe:
        return None
    from services import sector_aggregation as sa

    return await sa.compute_sector_amount_share(
        end_date, universe, sector_map, refresh=refresh, prices=prices
    )


def _universe_digest(universe: set[str]) -> str:
    """Stable short digest of universe membership — EOD result cache key 成分。"""
    joined = ",".join(sorted(universe))
    return hashlib.md5(joined.encode("utf-8")).hexdigest()[:12]


async def _fetch_eod_results(
    end_date: date,
    allowed: set[str],
    primary_sector: dict[str, str],
    refresh: bool = False,
) -> dict:
    """perf snapshot-hot-path C1 — 4 個 EOD compute 的 result-level cache。

    Profile(2026-07-02):warm request 98.4% 成本 = 4 個 compute 各自
    re-parse 同一 1.5GB prices cache(9.1s × 4 / 37.1s)。EOD 結果在同一
    (end_date, universe) 下已凍結(底層 prices cache 本就 24h TTL),
    以 disk cache 消滅重算。

    Invalidation 契約(test_snapshot_eod_result_cache_* 鎖):
    - component 為 None(compute 失敗 / empty-universe skip)不寫入 →
      下一 request 重算,不 pin 失敗
    - universe 變動 → digest 變 → 自然重算
    - refresh=True → bypass cache 讀 + 傳進 compute 鏈(C2 後 snapshot 端
      一律傳 False;此參數保留當手動強制重抓 EOD 的後門)
    - 各 component 的 try/except 範圍與 F6 stale 語意完全比照原 inline 版
    """
    cache_key = f"eod_results_{end_date.isoformat()}_{_universe_digest(allowed)}"
    results: dict = {}
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None:
            results = cached.get("results", {})
            if all(
                k in results
                for k in ("breadth", "sector_breadth", "sector_volume_ratio", "sector_amount_share")
            ):
                return results

    # perf C3b:4 個 compute 共用同一 prices window(T35/T36 鎖常數同值 +
    # 公式同構)→ 預抓一次注入,recompute 只付 1 次 parse(原 4 次)。
    # 預抓失敗 → prices=None,各 compute 退回自抓,per-component try/except
    # 降級語意與原版一致(同一 fetcher 會再失敗 → 該 component None)。
    prices: list[dict] | None = None
    if allowed:
        from services import market_breadth as mb
        from services import sector_aggregation as sa

        win_start, win_end = sa._derive_window(end_date, mb._DEFAULT_LOOKBACK_DAYS)
        try:
            prices = await mb._fetch_daily_prices_window(win_start, win_end, refresh=refresh)
        except httpx.HTTPError as exc:
            logger.warning("market snapshot: shared prices prefetch failed: %s", exc)
            prices = None

    # perf C6 (🟢):eod_as_of = 四個 EOD compute 實際用的 max price date
    # (盤中全是 T-1;P5 前端標「資料至 YYYY-MM-DD」直接用,不從 series 反推)。
    # prices 不可得(prefetch 失敗 / 全 cache 命中前的舊 cache)→ 維持 absent
    # → payload null。
    if "eod_as_of" not in results and prices:
        price_dates = [str(r["date"]) for r in prices if r.get("date")]
        if price_dates:
            results["eod_as_of"] = max(price_dates)

    # market-monitor-v2 P2 (SC-6) — breadth (F6: fail 不動 stale)
    if "breadth" not in results:
        try:
            results["breadth"] = await _fetch_breadth(
                end_date, allowed, refresh=refresh, prices=prices
            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("market snapshot: breadth compute failed: %s", exc)
            results["breadth"] = None

    # C3b:prices 注入後 compute 內部無 await,連續 component 的純 Python
    # aggregation 會連成一塊 ~3s 不讓出 loop(real-env 探針 max 2947ms)。
    # 注意必須 sleep(>0) 不能 sleep(0):sleep(0) 只把本 task 重排進 ready
    # queue「最前面」,剛到期的 timer / IO callback 排在後面,等於沒讓 —
    # 實驗:sleep(0) max gap 1898ms(3 component 連塊)/ sleep(0.005) 888ms
    # (單 component 上界)。
    await asyncio.sleep(0.005)

    # market-monitor-v2 P3 (SC-6) — sector_breadth(only httpx;ValueError 穿透)
    if "sector_breadth" not in results:
        try:
            results["sector_breadth"] = await _fetch_sector_breadth(
                end_date, allowed, primary_sector, refresh=refresh, prices=prices
            )
        except httpx.HTTPError as exc:
            logger.warning("market snapshot: sector_breadth compute failed: %s", exc)
            results["sector_breadth"] = None

    await asyncio.sleep(0.005)  # C3b yield(同上,必須 >0)

    # market-monitor-v2 P3 (SC-6) — sector_volume_ratio (independent try/except)
    if "sector_volume_ratio" not in results:
        try:
            results["sector_volume_ratio"] = await _fetch_sector_volume_ratio(
                end_date, allowed, primary_sector, refresh=refresh, prices=prices
            )
        except httpx.HTTPError as exc:
            logger.warning("market snapshot: sector_volume_ratio compute failed: %s", exc)
            results["sector_volume_ratio"] = None

    await asyncio.sleep(0.005)  # C3b yield(同上,必須 >0)

    # market-monitor-v2 P4 (SC-6) — sector_amount_share (independent try/except)
    if "sector_amount_share" not in results:
        try:
            results["sector_amount_share"] = await _fetch_sector_amount_share(
                end_date, allowed, primary_sector, refresh=refresh, prices=prices
            )
        except httpx.HTTPError as exc:
            logger.warning("market snapshot: sector_amount_share compute failed: %s", exc)
            results["sector_amount_share"] = None

    to_store = {k: v for k, v in results.items() if v is not None}
    if to_store:
        _write_cache(cache_key, {
            "results": to_store,
            "fetched_at": datetime.now(tz=TPE_TZ).isoformat(timespec="seconds"),
        })
    return results


# ---------------------------------------------------------------------------
# prd 502 修正(2026-07-03)— EOD 冷啟動與 request 生命週期脫鉤
# 冷啟動 ~4min > Vercel 外部 rewrite 超時(~30s):router 斷線 → cancel 鏈
# 取消計算 → 進度全丟 → 下一請求從零再來,prd 永遠暖不起來還狂燒配額。
# 解法:EOD 以 module 持有引用的背景 task 執行(不掛在任何 request 上,
# 斷線取消不波及);request 只 inline 等一個小預算,超時即回 partial +
# eod_pending=True,背景跑完寫 cache 後下一請求自然拿到完整結果。
# ---------------------------------------------------------------------------

_EOD_INLINE_BUDGET_SEC = 5.0
# bug eod-retry-backoff:失敗後的重試冷卻窗口。402 配額耗盡時失敗 component
# 不落 cache(不 pin 失敗),若 task 又即結即刪,前端 15s poll 每輪重觸發
# 全套 EOD fan-out → 以配額再生速率持續燒。窗口內重用失敗 task 的結果。
_EOD_RETRY_BACKOFF_SEC = 60.0
_EOD_COMPONENT_KEYS = ("breadth", "sector_breadth", "sector_volume_ratio", "sector_amount_share")
# {cache_key: Task} — module-level 引用讓背景 task 不被 GC / 不受 request 取消
_eod_background: dict[str, asyncio.Task] = {}
# {cache_key: monotonic deadline} — 失敗 task 的 backoff 截止時間
_eod_backoff_until: dict[str, float] = {}


def _ensure_eod_task(
    end_date: date,
    allowed: set[str],
    primary_sector: dict[str, str],
) -> asyncio.Task:
    """取得(或建立)該 (end_date, universe) 的 EOD 背景計算 task。

    - 同 key 進行中 → 直接共用(不重複 fan-out)
    - 成功結束 → done_callback 自我移除(下一請求走 result cache,不重算)
    - 失敗結束(例外、或任一 component None)→ task 保留佔位 +
      _EOD_RETRY_BACKOFF_SEC 冷卻:窗口內請求直接重用其結果(含已合併
      cache 的成功 component),不重觸發計算;窗口過後下一請求重試。
      (bug eod-retry-backoff:舊版即結即刪 → 15s poll 每輪全套重跑)
    - task 不吞例外:inline 路徑 await 到的請求原樣 re-raise(保留
      「非 httpx 例外 fail-loud propagate」既有契約,P4 T-INT-4 鎖);
      背景路徑(無人 await)由 done_callback logger.exception 留 traceback,
      避免 asyncio "exception was never retrieved" 噪音。
    """
    key = f"eod_results_{end_date.isoformat()}_{_universe_digest(allowed)}"
    task = _eod_background.get(key)
    if task is not None:
        if not task.done():
            return task
        # done 還留在 registry = 失敗佔位;窗口內重用,不重觸發
        if time.monotonic() < _eod_backoff_until.get(key, 0.0):
            return task

    task = asyncio.create_task(
        _fetch_eod_results(end_date, allowed, primary_sector, refresh=False)
    )
    _eod_background[key] = task

    def _cleanup(t: asyncio.Task, k: str = key) -> None:
        if t.cancelled():
            if _eod_background.get(k) is t:
                _eod_background.pop(k, None)
            return
        if t.exception() is not None:
            logger.error(
                "market snapshot: background EOD compute failed",
                exc_info=t.exception(),
            )
            failed = True
        else:
            # component None = compute 失敗降級(F6);empty-universe 的
            # 合法 None 也會進 backoff — 重算結果相同,冷卻無害
            result = t.result() or {}
            failed = any(result.get(c) is None for c in _EOD_COMPONENT_KEYS)
        if failed:
            _eod_backoff_until[k] = time.monotonic() + _EOD_RETRY_BACKOFF_SEC
            return  # 保留 task 佔位:窗口內請求重用其結果 / 原樣 re-raise
        _eod_backoff_until.pop(k, None)
        if _eod_background.get(k) is t:
            _eod_background.pop(k, None)

    task.add_done_callback(_cleanup)
    return task


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

    # market-monitor-v2 P2/P3/P4 (SC-6) — 4 個 EOD compute,perf C1 起走
    # result-level cache(_fetch_eod_results)。F6 stale 語意 / 各 component
    # try/except 範圍 / None 降級全部維持原 inline 版契約。
    # perf C2 (🔴):refresh 不進 EOD — 「重新整理 = 看最新盤中」,EOD 是
    # T-1 資料,end_date 前進自然失效;修正前 refresh=true 穿進 EOD fetcher
    # = ~278s + 128 次 FinMind 呼叫。強制重抓後門 = 手動呼叫
    # _fetch_eod_results(refresh=True) 或 bump _CACHE_VERSION_*。
    # prd 502 修正:EOD 走背景 task + inline 小預算。cache 暖(或計算快,
    # 含測試 instant mock)→ 預算內回傳,行為與舊 inline 版完全一致;
    # 真冷啟動(~4min)→ 超時回 partial + eod_pending=True,背景繼續跑
    # (module 引用持有,不受本 request 或任何 client 斷線取消)。
    eod_task = _ensure_eod_task(clock.today(), allowed, primary_sector)
    eod_pending = False
    try:
        eod = await asyncio.wait_for(
            asyncio.shield(eod_task), timeout=_EOD_INLINE_BUDGET_SEC
        ) or {}
    except asyncio.TimeoutError:
        eod = {}
        eod_pending = True
    breadth = eod.get("breadth")
    sector_breadth = eod.get("sector_breadth")
    sector_volume_ratio = eod.get("sector_volume_ratio")
    sector_amount_share = eod.get("sector_amount_share")

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
        # perf C6 (🟢) — 四個 EOD compute 實際用的 max price date(null =
        # prices 不可得)
        "eod_as_of": eod.get("eod_as_of"),
        # prd 502 修正 — EOD 背景計算尚未完成(冷啟動期間);frontend 據此
        # 顯示載入中並短輪詢,而非誤判為「無資料」
        "eod_pending": eod_pending,
        # market-monitor-v2 P2 (SC-6) — breadth field (None if compute failed)
        "breadth": breadth,
        # market-monitor-v2 P3 (SC-6) — sector aggregations (None if compute failed)
        "sector_breadth": sector_breadth,
        "sector_volume_ratio": sector_volume_ratio,
        # market-monitor-v2 P4 (SC-6) — sector amount share (None if compute failed)
        "sector_amount_share": sector_amount_share,
    }
