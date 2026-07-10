"""券差(應付現股當日沖銷券差借券費率)service — TWSE BFIF8U + TPEx OpenAPI。

資料源皆非 FinMind(不占配額);月批次抓取 + 檔案 cache。
設計:.claude/feat/daytrade-borrow-fee/design.md v3;spec docs/specs/daytrade-borrow-fee/spec.md。
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl
from datetime import date as date_type, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from fastapi import HTTPException

from services import clock
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
# 高費率標色門檻(%)— 前端同名常數 frontend/src/lib/borrow-fee.ts,測試兩端鎖同值
FEE_HIGHLIGHT_THRESHOLD = 3.5
_UA = "Mozilla/5.0 (neigui-backend)"
TWSE_URL = "https://www.twse.com.tw/rwd/zh/dayTrading/BFIF8U"
TPEX_URL = "https://www.tpex.org.tw/openapi/v1/tpex_intraday_fee"

_client: httpx.AsyncClient | None = None
# {key: {"task": Task, "refs": int}} — finmind.py::FinMindClient._run_once 同構
_inflight: dict[str, dict[str, Any]] = {}


def _ssl_context() -> ssl.SSLContext:
    """TPEx 憑證缺 Subject Key Identifier,py3.13 預設 VERIFY_X509_STRICT 拒驗
    (2026-07-11 實測)。關 strict flag 即恢復 py3.12 行為 — 憑證鏈與 hostname
    驗證完整保留,非 verify=False。"""
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": _UA},
            verify=_ssl_context(),
        )
    return _client


async def aclose() -> None:
    """lifespan shutdown 清理(對齊 finmind _client.close() 慣例)。"""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ---------------------------------------------------------------- normalize


def _roc_slash_to_iso(s: str) -> str:
    y, m, d = s.strip().split("/")
    return f"{int(y) + 1911}-{m}-{d}"


def _roc_compact_to_iso(s: str) -> str:
    s = s.strip()
    return f"{int(s[:-4]) + 1911}-{s[-4:-2]}-{s[-2:]}"


def normalize_twse_row(row: list) -> dict | None:
    """["115/07/09", "8150      ", "南茂    ", "10,000", "3.500%"] → normalized。"""
    try:
        return {
            "date": _roc_slash_to_iso(row[0]),
            "market": "twse",
            "stock_id": str(row[1]).strip(),
            "name": str(row[2]).strip(),
            "lending_shares": int(str(row[3]).replace(",", "")),
            "fee_rate": float(str(row[4]).replace("%", "").replace(",", "")),
        }
    except (ValueError, IndexError, TypeError):
        logger.warning("skip bad twse borrow-fee row: %r", row)
        return None


def normalize_tpex_row(row: dict) -> dict | None:
    """TPEx 欄名 `" LendingVolume"` 帶 leading space(官方原樣);LendingFee 已是 %。"""
    try:
        return {
            "date": _roc_compact_to_iso(row["Date"]),
            "market": "tpex",
            "stock_id": str(row["SecuritiesCompanyCode"]).strip(),
            "name": str(row["CompanyName"]).strip(),
            "lending_shares": int(str(row[" LendingVolume"]).replace(",", "")),
            "fee_rate": float(row["LendingFee"]),
        }
    except (ValueError, KeyError, TypeError):
        logger.warning("skip bad tpex borrow-fee row: %r", row)
        return None


# ---------------------------------------------------------------- fetch


def _fixtures_dir() -> Path:
    raw = os.getenv("FAKE_FINMIND_FIXTURES_DIR", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[1] / "tests_e2e" / "fixtures"


def _is_current_month(yyyymm: str) -> bool:
    return yyyymm == clock.today().isoformat()[:7]


async def _fetch_month_raw(market: str, yyyymm: str) -> list:
    """回原始 upstream rows(twse: data list;tpex: dict list)。

    TPEx OpenAPI 只提供當月 — 非當月直接回空,不打網路(fetch_month 的
    P0-1 保護是第一道,這裡是第二道)。
    """
    if market == "tpex" and not _is_current_month(yyyymm):
        return []
    if os.getenv("FAKE_FINMIND") == "1":
        name = f"twse_{yyyymm.replace('-', '')}.json" if market == "twse" else "tpex.json"
        payload = read_json(_fixtures_dir() / "borrow_fee" / name)
        if payload is None:
            return []
        if market == "twse":
            return payload.get("data") or [] if payload.get("stat") == "OK" else []
        return payload
    if market == "twse":
        resp = await _get_client().get(
            TWSE_URL,
            params={"date": f"{yyyymm.replace('-', '')}01", "response": "json"},
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("stat") != "OK":
            return []
        return body.get("data") or []
    resp = await _get_client().get(TPEX_URL)
    resp.raise_for_status()
    return resp.json()


def _cache_path(market: str, yyyymm: str) -> Path:
    return chip_cache_dir() / f"borrow_fee_{market}_{yyyymm.replace('-', '')}.json"


def _read_cache(market: str, yyyymm: str) -> dict | None:
    payload = read_json(_cache_path(market, yyyymm))
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return None
    return payload


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup(subscriber refcount + shield)。

    finmind.py::FinMindClient._run_once 同構:caller cancel(client disconnect
    經 run_with_disconnect 傳導)不直接殺共享 task;refs 歸零才 cancel。
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


async def _fetch_and_store(market: str, yyyymm: str) -> list[dict]:
    raw = await _fetch_month_raw(market, yyyymm)
    normalize = normalize_twse_row if market == "twse" else normalize_tpex_row
    rows = [n for r in raw if (n := normalize(r)) is not None]
    cached = _read_cache(market, yyyymm)
    # P0-1 保護 (b):上游回空不覆寫既有非空 cache(TPEx 歷史拿不回;TWSE 暫時故障)
    if not rows and cached is not None and cached.get("rows"):
        return cached["rows"]
    atomic_write_json(
        _cache_path(market, yyyymm),
        {
            "_cache_version": _CACHE_VERSION,
            "fetched_on": clock.today().isoformat(),
            "rows": rows,
        },
    )
    return rows


async def fetch_month(market: str, yyyymm: str, refresh: bool = False) -> list[dict]:
    """抓一個月的 normalized rows(cache 語意見 design §1.1)。

    - 過去月 cache 不朽;當月 cache 跨日 stale(日粒度,refresh 為救濟)。
    - P0-1 保護 (a):tpex 過去月無 upstream 可重抓 → 無視 refresh 一律回 cache。
    """
    cached = _read_cache(market, yyyymm)
    if market == "tpex" and not _is_current_month(yyyymm) and cached is not None:
        return cached["rows"]
    if not refresh and cached is not None:
        if not _is_current_month(yyyymm) or cached.get("fetched_on") == clock.today().isoformat():
            return cached["rows"]
    return await _run_once(f"{market}_{yyyymm}", lambda: _fetch_and_store(market, yyyymm))


# ---------------------------------------------------------------- 日彙整


def _prev_month(yyyymm: str) -> str:
    first = date_type.fromisoformat(f"{yyyymm}-01")
    return (first - timedelta(days=1)).isoformat()[:7]


async def _month_rows(yyyymm: str, refresh: bool) -> tuple[list[dict], list[dict]]:
    # 裸 gather(R2-3):任一市場例外直接上拋 route 邊界 502;sibling 背景跑完
    # 只寫 cache 無副作用,不需手動 cancel。
    twse_rows, tpex_rows = await asyncio.gather(
        fetch_month("twse", yyyymm, refresh),
        fetch_month("tpex", yyyymm, refresh),
    )
    return twse_rows, tpex_rows


async def get_day(date_str: str | None, refresh: bool = False) -> dict:
    """最近可得日的合併券差表 + 當月發生次數。

    回退鏈:target 月內最近日 → 前月遞迴一次 → 404 no_data。
    """
    target = date_str or clock.today().isoformat()
    month = target[:7]
    twse_rows, tpex_rows = await _month_rows(month, refresh)
    candidates = [r["date"] for r in twse_rows + tpex_rows if r["date"] <= target]
    if not candidates:
        month = _prev_month(month)
        twse_rows, tpex_rows = await _month_rows(month, refresh)
        candidates = [r["date"] for r in twse_rows + tpex_rows if r["date"] <= target]
        if not candidates:
            raise HTTPException(status_code=404, detail={"error": "no_data"})
    as_of = max(candidates)
    all_rows = twse_rows + tpex_rows
    day_rows = sorted(
        (r for r in all_rows if r["date"] == as_of),
        key=lambda r: (-r["fee_rate"], -r["lending_shares"], r["stock_id"]),
    )
    month_dates: dict[str, set[str]] = {}
    for r in all_rows:
        month_dates.setdefault(r["stock_id"], set()).add(r["date"])

    payload: dict[str, Any] = {
        "as_of_date": as_of,
        "rows": day_rows,
        "month_counts": {sid: len(ds) for sid, ds in month_dates.items()},
    }
    if as_of != target:
        payload["no_trading_day"] = True
    # R2-1 partial per-day:過去月的 tpex cache 可能凍結在月中 — 只查「rows 空」
    # 會漏 stale 態,改查「as_of 當日有無 tpex 覆蓋」。
    if not _is_current_month(month) and not any(r["date"] == as_of for r in tpex_rows):
        payload["partial"] = ["tpex"]
    return payload
