"""Symbol search endpoint using FinMind TaiwanStockInfo."""

from __future__ import annotations

import asyncio
import logging
import os

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)
router = APIRouter()

_symbols: list[dict] = []
# perf/cold-start:共用載入 task(inflight dedup)。module 持有引用,client 斷線
# 或 request 結束都不取消它(樣板:finmind_realtime._run_once 的 module-level
# 引用慣例)。
_load_task: asyncio.Task | None = None


async def load_symbols() -> None:
    global _symbols
    if os.getenv("FAKE_FINMIND") == "1":
        # E2E fake-mode 旁路:讀 tests_e2e/fixtures/TaiwanStockInfo.json(R2-P0-1 / F1)。
        import json
        from pathlib import Path

        fixture_dir = Path(
            os.getenv(
                "FAKE_FINMIND_FIXTURES_DIR",
                str(Path(__file__).resolve().parent.parent / "tests_e2e" / "fixtures"),
            )
        )
        fixture = fixture_dir / "TaiwanStockInfo.json"
        if fixture.exists():
            payload = json.loads(fixture.read_text(encoding="utf-8"))
            data = payload.get("data", payload) if isinstance(payload, dict) else payload
        else:
            logger.warning("FAKE_FINMIND fixture %s missing, symbol list empty", fixture)
            _symbols = []
            return
        seen: set[str] = set()
        deduped: list[dict] = []
        for r in data:
            sid = r.get("stock_id", "")
            if sid and sid not in seen and r.get("type") in ("twse", "tpex", "otc"):
                seen.add(sid)
                deduped.append({"symbol": sid, "name": r.get("stock_name", "")})
        _symbols = deduped
        logger.info("FAKE_FINMIND loaded %d symbols from fixture", len(_symbols))
        return
    token = os.getenv("FINMIND_TOKEN", "")
    if not token:
        logger.warning("FINMIND_TOKEN not set, symbol search disabled")
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://api.finmindtrade.com/api/v4/data",
                params={"dataset": "TaiwanStockInfo"},
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
            seen: set[str] = set()
            deduped: list[dict] = []
            for r in data:
                sid = r.get("stock_id", "")
                if sid and sid not in seen and r.get("type") in ("twse", "tpex", "otc"):
                    seen.add(sid)
                    deduped.append({"symbol": sid, "name": r.get("stock_name", "")})
            _symbols = deduped
            logger.info("Loaded %d symbols from FinMind", len(_symbols))
    except Exception as exc:
        logger.warning("Failed to load symbols: %s", exc)


def _log_load_task_failure(task: asyncio.Task) -> None:
    # shutdown cancel 後 task.exception() 會 raise CancelledError,先 guard
    # (同 finmind_realtime._cleanup 樣板)。
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("background symbols load failed: %s", exc)


def ensure_load_task() -> asyncio.Task:
    """取得(或建立)共用的 symbols 載入 task。lifespan 啟動 kickoff 用它,
    request 端 _ensure_loaded 也 await 同一顆 — 並發空狀態只打一次 FinMind。

    重建判準三合一:
    - 尚未建立
    - 已結束(成功 / 失敗都重建 — 保住「空清單時每 request 重試一次」的
      lazy-retry 契約,載入失敗不會 pin 死到 process restart)
    - 綁在別的 event loop(bare TestClient 每請求各開一個 loop;跨 loop 的
      pending 殘留直接 await 會 hang / RuntimeError,視同 stale 丟棄重建)
    """
    global _load_task
    task = _load_task
    if task is None or task.done() or task.get_loop() is not asyncio.get_running_loop():
        task = asyncio.create_task(load_symbols())
        task.add_done_callback(_log_load_task_failure)
        _load_task = task
    return task


async def shutdown_load_task() -> None:
    """lifespan shutdown 清理:取消還在載入中的背景 task。
    --reload / Railway SIGTERM 落在載入窗口時,沒這段會噴 CancelledError
    traceback 且跳過後續清理。"""
    global _load_task
    task = _load_task
    _load_task = None
    if task is None or task.done():
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        # 只吞「task 被我們取消」;外層 shutdown 自身被取消要原樣傳。
        if not task.cancelled():
            raise


async def _ensure_loaded() -> None:
    # _symbols starts empty; lifespan kickoff 背景載入但不等它(冷啟動 ready
    # 與 FinMind fetch 脫鉤)。第一個需要 symbols 的 request 在這裡 await 共用
    # task;主要失敗路徑是 task 正常結束但清單仍空(load_symbols 內部吞例外
    # 只留 warning)→ 503,下一個 request 依 done-即重建再試 — 沿用原有
    # lazy reload 契約(FinMind blip 不會 pin 死到 process restart)。
    if _symbols:
        return
    task = ensure_load_task()
    try:
        # shield:awaiter 被 cancel(client 斷線)不得傳導進共用 task。
        await asyncio.shield(task)
    except asyncio.CancelledError:
        # task 本身被 cancel(shutdown 窗口)→ 轉 503;awaiter 自身被 cancel
        # → 原樣傳。CancelledError 是 BaseException,不會落進下面的 Exception
        # — 刻意依賴,別改成 except BaseException。
        if task.cancelled():
            raise ValueError("symbols_unavailable") from None
        raise
    except Exception:
        # 罕見路徑:load_symbols 本體 raise(如 FAKE fixture I/O 錯)。細節已由
        # done_callback 留 log,此處統一走下方空檢查轉既有 503 契約。
        pass
    if not _symbols:
        raise ValueError("symbols_unavailable")


@router.get("/api/symbols")
async def search_symbols(search: str = Query(default="", min_length=1)) -> list[dict]:
    if not search:
        return []
    await _ensure_loaded()
    q = search.lower()
    results = []
    for s in _symbols:
        if s["symbol"].startswith(q) or q in s["name"].lower():
            results.append(s)
            if len(results) >= 20:
                break
    return results


@router.get("/api/symbols/all")
async def all_symbols() -> list[dict]:
    await _ensure_loaded()
    return _symbols
