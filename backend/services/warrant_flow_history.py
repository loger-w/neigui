"""權證外部淨額時序 — summary 級 per-day series(design warrant-flow-net-history v3)。

資料流:cache-only 槽位掃描(近 20 交易日槽讀 warrant_flow result cache 的
summary,零重算)+ 顯式 backfill(≤3 缺日、新→舊、序列,呼 warrant_flow.
try_build_day 冷建)。非交易日以 flow_nontrading_<d>.json marker 記憶(14 天
retention,warrant_flow._cleanup_flow_caches 管)。

跨模組私有借用豁免(design v3 R13):與 warrant_flow 同 domain 緊耦合(共用
result cache 命名空間與 inflight registry),_run_once / _result_cache_path /
_read_versioned / _cleanup_flow_caches 直接借用;共用主入口 try_build_day 公開。
"""

from __future__ import annotations

import logging
import os
from datetime import timedelta
from pathlib import Path

import httpx
from fastapi import HTTPException

import services.warrant_flow as wf
from services import clock, warrants
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

HISTORY_SLOTS = 20
SCAN_WEEKDAY_CAP = 30
BACKFILL_MAX = 3


def _marker_path(d: str) -> Path:
    return chip_cache_dir() / f"flow_nontrading_{d}.json"


def _slot_from_cache(stock_id: str, d: str) -> dict | None:
    payload = wf._read_versioned(wf._result_cache_path(stock_id, d))
    if payload is None:
        return None
    summary = payload.get("summary") or {}
    return {
        "date": d,
        "status": "built",
        "call": summary.get("call"),
        "put": summary.get("put"),
    }


def _scan_slots(stock_id: str) -> list[dict]:
    """槽位掃描(新→舊):marker 日跳過不佔槽;cache 合格 → built;否則 missing。
    收滿 HISTORY_SLOTS 或掃滿 SCAN_WEEKDAY_CAP 個 weekday 為止(R11:days 可 < window)。
    """
    slots: list[dict] = []
    d = clock.today()
    scanned = 0
    while scanned < SCAN_WEEKDAY_CAP and len(slots) < HISTORY_SLOTS:
        if d.weekday() < 5:
            scanned += 1
            iso = d.isoformat()
            if wf._read_versioned(_marker_path(iso)) is None:
                slots.append(
                    _slot_from_cache(stock_id, iso)
                    or {"date": iso, "status": "missing", "call": None, "put": None}
                )
        d -= timedelta(days=1)
    return slots


async def _backfill(stock_id: str, slots: list[dict], snap: dict, winfo: dict[str, dict]) -> int:
    """缺日冷建(≤BACKFILL_MAX、新→舊、序列)。候選排除 d >= today−1(R8:
    近日多為 dump/報表未上料的不可解態,白燒名額;近日由主 panel 預設檢視建置)。
    回傳本輪 missing → built 槽數(含雙建防護重讀命中)。"""
    recent_floor = (clock.today() - timedelta(days=1)).isoformat()
    candidates = [s for s in slots if s["status"] == "missing" and s["date"] < recent_floor]
    candidates = candidates[:BACKFILL_MAX]
    built = 0
    mapped_all: set[str] | None = None
    for slot in candidates:
        d = slot["date"]
        cached = _slot_from_cache(stock_id, d)  # R-D:建置前重讀(並發已建 → 零成本)
        if cached is not None:
            slot.update(cached)
            built += 1
            continue

        async def _build(d: str = d, m: set[str] | None = mapped_all):
            return await wf.try_build_day(stock_id, d, snap, winfo, m, False)

        # payload 不直接用 — 槽值一律經 _slot_from_cache 重讀(單一組裝路徑)
        status, _, mapped_all = await wf._run_once(f"flow_build_{stock_id}_{d}", _build)
        if status == "built":
            slot.update(_slot_from_cache(stock_id, d) or {})
            built += 1
        elif status == "no_dump" and d < recent_floor:
            # 假日 → marker(近日 guard 由候選排除保證,此處 d 恆 < recent_floor)
            atomic_write_json(
                _marker_path(d), {"_cache_version": wf._CACHE_VERSION, "non_trading": True}
            )
        # report_pending → 槽保持 missing,明日自然可建
    if built:
        wf._cleanup_flow_caches(clock.today())
    return built


def _payload(slots: list[dict], backfilled: int) -> dict:
    days = list(reversed(slots))  # 舊→新
    return {
        "window": HISTORY_SLOTS,
        "built": sum(1 for s in days if s["status"] == "built"),
        "missing_count": sum(1 for s in days if s["status"] == "missing"),
        "backfilled": backfilled,
        "empty_reason": None,
        "days": days,
    }


def _fake_history() -> dict:
    """FAKE 分支:distilled 層 fixture 直讀(backfill 型 feature 注入點;
    warrant_iv_history 樣板)。複製查詢語意:date <= today 過濾 + 取最近 HISTORY_SLOTS。"""
    payload = read_json(warrants._fixtures_dir() / "warrant_flow" / "history.json")
    rows = (payload or {}).get("days", []) if isinstance(payload, dict) else []
    today = clock.today().isoformat()
    rows = [r for r in rows if str(r.get("date", "")) <= today]
    rows.sort(key=lambda r: str(r.get("date", "")))
    rows = rows[-HISTORY_SLOTS:]
    days = [
        {"date": r["date"], "status": "built", "call": r.get("call"), "put": r.get("put")}
        for r in rows
    ]
    return {
        "window": HISTORY_SLOTS,
        "built": len(days),
        "missing_count": 0,
        "backfilled": 0,
        "empty_reason": None,
        "days": days,
    }


async def get_flow_history(stock_id: str, backfill: bool = False) -> dict:
    """標的外部淨額時序(route 入口)。backfill=true 才觸發缺日冷建 —
    刻意不用 refresh 語意(refresh = 跳 cache 全重抓,對 20 日 series ≈ 4000 req)。"""

    async def _impl() -> dict:
        if os.getenv("FAKE_FINMIND") == "1":
            return _fake_history()
        try:
            snap = await warrants.get_snapshot()
        except (httpx.HTTPError, HTTPException) as exc:
            logger.warning("warrant flow history snapshot unavailable: %s", exc)
            raise HTTPException(status_code=502, detail={"error": "warrant_upstream"}) from exc
        wlist = snap.get("by_underlying", {}).get(stock_id, [])
        if not wlist:
            return {
                "window": HISTORY_SLOTS,
                "built": 0,
                "missing_count": 0,
                "backfilled": 0,
                "empty_reason": "no_warrants",
                "days": [],
            }
        winfo = {w["warrant_id"]: w for w in wlist}
        slots = _scan_slots(stock_id)
        backfilled = 0
        if backfill:
            backfilled = await _backfill(stock_id, slots, snap, winfo)
            slots = _scan_slots(stock_id)  # marker / 遞補生效重掃(R3:同一判定)
        return _payload(slots, backfilled)

    return await wf._run_once(f"flow_history_{stock_id}_{int(backfill)}", _impl)
