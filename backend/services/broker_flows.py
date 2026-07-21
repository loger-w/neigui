"""分點反查:特定分點單日買賣超股票聚合(design .claude/feat/broker-daily-flows/design.md v3)。

資料流:分點目錄(TaiwanSecuritiesTraderInfo,24h cache)前置檢查 → 候選日
weekday-loop(≤3 交易日,自適應含 T+0;報表 21:00 上料,空結果不落 cache)
→ taiwan_stock_trading_daily_report by trader 單發 → price-level rows 聚合
(分類鍵 = 排序鍵 = net_amount)→ symbols 名稱 join(不可用降級空名)。
"""

from __future__ import annotations

import logging
import re
from datetime import date as date_type, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

import httpx
from fastapi import HTTPException

if TYPE_CHECKING:
    from services.finmind import FinMindClient

from services import clock
from utils.cache import atomic_write_json, chip_cache_dir, read_json
from utils.concurrency import run_once
from utils.validation import parse_date_param

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
_CANDIDATE_DAYS = 3  # SC-2/SC-8:首日 + 最多退 2 個交易日
_TOP_N = 30
_TODAY_TTL_MINUTES = 30
_DIRECTORY_TTL_MINUTES = 24 * 60
_SEARCH_LIMIT = 50
# 真實 id 樣態:9600 / 779c / 9A00 / 075T — 白名單擋路徑穿越 / Windows 非法
# 字元進 cache 檔名(review S6:目錄降級窗口內 404 gate 不在,這裡是唯一防線)
_BROKER_ID_RE = re.compile(r"[0-9A-Za-z]{1,10}")

_inflight: dict[str, dict[str, Any]] = {}


def get_finmind() -> "FinMindClient":
    """per-module wrap(finmind-conventions):test 可獨立 monkeypatch。"""
    from services.finmind import get_finmind as _real

    return _real()


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup — 委派 utils.concurrency.run_once(refcount + shield)。"""
    return await run_once(_inflight, key, coro_fn)


# ---------------------------------------------------------------- dates / caches


def _candidate_dates(start: date_type) -> list[str]:
    """start 往前的非週末日取 _CANDIDATE_DAYS 個(warrant_flow._candidate_dates
    同構;國定假日多燒 1 request 空查換簡單性,design R3)。"""
    d = start
    dates: list[str] = []
    while len(dates) < _CANDIDATE_DAYS:
        if d.weekday() < 5:
            dates.append(d.isoformat())
        d -= timedelta(days=1)
    return dates


def _flows_cache_path(broker_id: str, d: str) -> Path:
    return chip_cache_dir() / f"bflow_{broker_id}_{d}.json"


def _directory_cache_path() -> Path:
    return chip_cache_dir() / "broker_directory.json"


def _read_versioned(path: Path) -> dict | None:
    payload = read_json(path)
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return None
    return payload


def _is_stale(payload: dict, max_age_minutes: int) -> bool:
    """fetched_at 齡期判準對齊 FinMindClient._is_stale(module 級自寫,R4)。"""
    fetched = payload.get("fetched_at", "")
    if not fetched:
        return True
    try:
        dt = datetime.fromisoformat(fetched)
    except ValueError:
        return True
    return datetime.now() - dt > timedelta(minutes=max_age_minutes)


def _now_str() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- aggregation


def _aggregate_flows(rows: list) -> tuple[list[dict], list[dict], int]:
    """price-level rows → (buy_top, sell_top, stock_count)。

    lots = 股數加總後 // 1000 截斷(_parse_broker_history 慣例);
    net_amount = Σ((buy − sell) × price) round 成 int(元)。
    分類鍵 = 排序鍵 = net_amount(design R5:與 net_lots 符號可背離,
    低買高賣同量 → net_lots=0 入賣超表);== 0 兩表都不進。
    """
    acc: dict[str, dict[str, float]] = {}
    for r in rows:
        sid = r.get("stock_id", "")
        if not sid:
            continue
        buy = int(r.get("buy", 0) or 0)
        sell = int(r.get("sell", 0) or 0)
        price = float(r.get("price", 0) or 0)
        slot = acc.setdefault(sid, {"buy": 0, "sell": 0, "amount": 0.0})
        slot["buy"] += buy
        slot["sell"] += sell
        slot["amount"] += (buy - sell) * price

    items: list[dict] = []
    for sid, slot in acc.items():
        buy_lots = int(slot["buy"]) // 1000
        sell_lots = int(slot["sell"]) // 1000
        items.append(
            {
                "stock_id": sid,
                "stock_name": "",
                "buy_lots": buy_lots,
                "sell_lots": sell_lots,
                "net_lots": buy_lots - sell_lots,
                "net_amount": round(slot["amount"]),
            }
        )

    buy_top = sorted(
        (i for i in items if i["net_amount"] > 0),
        key=lambda i: i["net_amount"],
        reverse=True,
    )[:_TOP_N]
    sell_top = sorted(
        (i for i in items if i["net_amount"] < 0),
        key=lambda i: i["net_amount"],
    )[:_TOP_N]
    return buy_top, sell_top, len(acc)


# ---------------------------------------------------------------- directory


async def _get_directory_or_none() -> dict[str, str] | None:
    """分點目錄 id → name;上游故障回 None(R10:呼叫端自行降級,
    不得讓目錄故障拖垮 flows 路徑)。空 rows 不落 cache。
    無 refresh 參數(review S5:design 只承諾 24h TTL;新開分點短窗 404
    屬 Known Risk 2)。"""
    cached = _read_versioned(_directory_cache_path())
    if cached is not None and not _is_stale(cached, _DIRECTORY_TTL_MINUTES):
        return cached.get("traders") or None

    async def _do_fetch() -> dict[str, str] | None:
        rows = await get_finmind().fetch_securities_trader_info()
        traders = {
            r["securities_trader_id"]: r.get("securities_trader", "")
            for r in rows
            if r.get("securities_trader_id")
        }
        if not traders:
            return None
        atomic_write_json(
            _directory_cache_path(),
            {"_cache_version": _CACHE_VERSION, "fetched_at": _now_str(), "traders": traders},
        )
        return traders

    try:
        return await _run_once("broker_directory", _do_fetch)
    except (httpx.HTTPError, HTTPException) as exc:
        logger.warning("broker directory fetch failed: %s", exc)
        return None


async def search_traders(q: str) -> list[dict]:
    """SC-3:id 前綴(casefold)或名稱 substring,≤ _SEARCH_LIMIT 筆。"""
    needle = q.strip().casefold()
    if not needle:
        # route min_length=1 擋不住純空白;startswith("") 會全表命中(review C3)
        return []
    directory = await _get_directory_or_none()
    if not directory:
        raise HTTPException(503, {"error": "broker_directory_unavailable"})
    hits = [
        {"broker_id": bid, "broker_name": name}
        for bid, name in directory.items()
        if bid.casefold().startswith(needle) or needle in name.casefold()
    ]
    return hits[:_SEARCH_LIMIT]


# ---------------------------------------------------------------- symbols join


async def _symbol_names() -> dict[str, str]:
    """symbols 名稱 map;載入失敗降級空 map(R1:名稱純裝飾,不拖垮 flows)。"""
    from routes import symbols as symbols_routes

    try:
        return await symbols_routes.get_symbol_name_map()
    except ValueError:
        logger.warning("symbol name map unavailable — stock_name degraded to empty")
        return {}


# ---------------------------------------------------------------- main entry


async def get_daily_flows(broker_id: str, date_param: str | None, refresh: bool) -> dict:
    """SC-1/SC-2/SC-8:單分點單日買賣超股票排行(design §2.2 步驟 1-6)。"""
    # 1. date 驗證 + clamp(R2:regex 擋不住 2026-02-31;future → today)
    if date_param is not None:
        # strict=False + invalid_date:保留收斂前行為與錯誤碼(F-3 零行為差異)
        parsed = parse_date_param(date_param, error_code="invalid_date", strict=False)
        start = min(parsed, clock.today())
    else:
        start = clock.today()

    # 1.5 id 格式白名單(review S6):目錄降級窗口內 404 gate 不在,這裡擋
    # 路徑穿越 / Windows 非法字元進 cache 檔名
    if not _BROKER_ID_RE.fullmatch(broker_id):
        raise HTTPException(404, {"error": "broker_not_found"})

    # 2. 目錄前置檢查(不可得 → 降級跳過,R10)
    directory = await _get_directory_or_none()
    if directory is not None and broker_id not in directory:
        raise HTTPException(404, {"error": "broker_not_found"})
    broker_name = (directory or {}).get(broker_id) or broker_id

    # 3-5. 候選日 loop:cache 命中(今日 TTL 30min / 過去日無條件)→ 用;
    # miss → fetch(空 rows 不落 cache,21:00 上料自動吃到);全空 → 503
    requested = start.isoformat()
    today_str = clock.today().isoformat()
    day_payload: dict | None = None
    for d in _candidate_dates(start):
        stale_today: dict | None = None
        if not refresh:
            cached = _read_versioned(_flows_cache_path(broker_id, d))
            if cached is not None:
                if d != today_str or not _is_stale(cached, _TODAY_TTL_MINUTES):
                    day_payload = cached
                    break
                stale_today = cached

        async def _do_fetch(d: str = d) -> dict | None:
            rows = await get_finmind().fetch_daily_report_by_trader(broker_id, d)
            if not rows:
                return None
            buy_top, sell_top, stock_count = _aggregate_flows(rows)
            payload = {
                "_cache_version": _CACHE_VERSION,
                "fetched_at": _now_str(),
                "as_of_date": d,
                "stock_count": stock_count,
                "buy_top": buy_top,
                "sell_top": sell_top,
            }
            atomic_write_json(_flows_cache_path(broker_id, d), payload)
            return payload

        day_payload = await _run_once(f"bflow_{broker_id}_{d}_r{int(refresh)}", _do_fetch)
        if day_payload is None and stale_today is not None:
            # review C4:今日 TTL 過期後重抓遇上游短暫空回應 — 用 stale cache
            # 頂住,不倒退前一交易日(下次請求上游恢復即自癒)
            logger.warning(
                "broker flows refetch empty for %s/%s — serving stale cache",
                broker_id,
                d,
            )
            day_payload = stale_today
        if day_payload is not None:
            break
    if day_payload is None:
        raise HTTPException(503, {"error": "broker_flows_unavailable"})

    # 6. 名稱 join(request-scope;不入 cache — cache 內 stock_name 恆空)
    names = await _symbol_names()
    as_of = day_payload["as_of_date"]
    return {
        "broker_id": broker_id,
        "broker_name": broker_name,
        "requested_date": requested,
        "as_of_date": as_of,
        "no_trading_day": as_of != requested,
        "stock_count": day_payload["stock_count"],
        "fetched_at": day_payload["fetched_at"],
        "buy_top": [
            {**i, "stock_name": names.get(i["stock_id"], "")} for i in day_payload["buy_top"]
        ],
        "sell_top": [
            {**i, "stock_name": names.get(i["stock_id"], "")} for i in day_payload["sell_top"]
        ],
    }
