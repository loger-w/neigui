"""IndustryChain — FinMind `TaiwanStockIndustryChain` (industry, sub_industry) 對映.

Spec: .claude/mod/market-today-only/change-spec.md §3(新資料源)/ §4(Backend 表)。

全表 1 request(無 `data_id`、無日期範圍),static 對映(業務分類日常不變),
disk cache TTL 7 天。`refresh=true` **不**強制重抓 — 盤中刷新語意只對即時
tick / EOD 有意義,chain 本身無盤中變動(spec §3)。

FAKE_FINMIND=1 時只用 module-level in-memory cache,不落檔(R10,沿
`warrant_iv_history.py` R17 precedent):
- 防 e2e 跨 run 殘留(disk cache 會跨測試 process 存活,污染下個 run)
- 防 FAKE_TODAY 凍結時鐘下 7 天 TTL 永遠不過期(fixture 更新後測試吃不到新值)

upstream 失敗:讓 `httpx.HTTPError` propagate,caller(finmind_realtime)負責降級
(chain = None + logger.warning,不阻塞其餘 snapshot 欄位)。
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_FINMIND_BASE = "https://api.finmindtrade.com/api/v4"
_CACHE_VERSION_INDUSTRY_CHAIN = 1
_CHAIN_TTL_HOURS = 168  # 7 天(靜態對映)
_CACHE_KEY = "industry_chain"

_inflight: dict[str, asyncio.Task] = {}
# FAKE_FINMIND=1 專用 in-memory cache(R10 — 不落檔)
_mem_cache: dict | None = None


# ---------------------------------------------------------------------------
# get_finmind indirection — tests patch this module-level symbol
# (finmind-conventions:新 service module 走 FinMind 要 wrap per-module)
# ---------------------------------------------------------------------------


def get_finmind():
    from services.finmind import get_finmind as _real

    return _real()


def _fake_mode() -> bool:
    return os.getenv("FAKE_FINMIND") == "1"


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------


def _cache_path() -> Path:
    return chip_cache_dir() / f"{_CACHE_KEY}.json"


def _read_cache() -> dict | None:
    """FAKE 模式讀 module-level mem;否則讀 disk(R10)。"""
    if _fake_mode():
        return _mem_cache
    p = _cache_path()
    if not p.exists():
        return None
    data = read_json(p, default=None)
    if data is None:
        return None
    if data.get("_cache_version") != _CACHE_VERSION_INDUSTRY_CHAIN:
        return None
    data.pop("_cache_version", None)
    return data


def _write_cache(payload: dict) -> None:
    """FAKE 模式只寫 mem 不落檔(R10);否則 disk cache 帶版本號。"""
    global _mem_cache
    if _fake_mode():
        _mem_cache = payload
        return
    cached = {**payload, "_cache_version": _CACHE_VERSION_INDUSTRY_CHAIN}
    atomic_write_json(_cache_path(), cached)


def _is_fresh(cached: dict, ttl_hours: float) -> bool:
    fetched_at = cached.get("fetched_at", "")
    if not fetched_at:
        return False
    try:
        dt = datetime.fromisoformat(fetched_at)
    except ValueError:
        return False
    return datetime.now() - dt < timedelta(hours=ttl_hours)


async def _run_once(key: str, coro_fn):
    """Inflight dedup(同 market_universe.py pattern — 單一 key,無 refcount)。"""
    if key in _inflight:
        return await _inflight[key]
    _inflight[key] = asyncio.ensure_future(coro_fn())
    try:
        return await _inflight[key]
    finally:
        _inflight.pop(key, None)


# ---------------------------------------------------------------------------
# Rows → map
# ---------------------------------------------------------------------------


def _rows_to_map(rows: list[dict]) -> dict[str, dict[str, list[str]]]:
    """{industry: {sub_industry: [stock_id...]}};同 (industry, sub_industry) 內
    同 stock_id 只留一次(N-to-M 對映本身不該重複,防上游髒資料重複列)。"""
    out: dict[str, dict[str, list[str]]] = {}
    for row in rows:
        sid = row.get("stock_id")
        industry = row.get("industry")
        sub = row.get("sub_industry")
        if not sid or not industry or not sub:
            continue
        sub_map = out.setdefault(industry, {})
        members = sub_map.setdefault(sub, [])
        if sid not in members:
            members.append(sid)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_chain() -> dict[str, dict[str, list[str]]]:
    """Return `{industry: {sub_industry: [stock_id...]}}`.

    Disk(或 FAKE 模式下 mem)cache TTL 7 天;過期則重抓。upstream 失敗
    (`httpx.HTTPError`)propagate 給 caller。
    """
    cached = _read_cache()
    if cached is not None and _is_fresh(cached, _CHAIN_TTL_HOURS):
        return cached.get("map", {})

    return await _run_once(_CACHE_KEY, _do_fetch_chain)


async def _do_fetch_chain() -> dict[str, dict[str, list[str]]]:
    client = get_finmind()
    rows = await client._get(  # type: ignore[attr-defined]
        f"{_FINMIND_BASE}/data",
        {"dataset": "TaiwanStockIndustryChain"},
    )
    chain_map = _rows_to_map(rows)
    _write_cache(
        {
            "map": chain_map,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    return chain_map
