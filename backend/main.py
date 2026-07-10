"""FastAPI application entry point."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.gzip import GZipMiddleware

from routes.chip import router as chip_router
from routes.daytrade_fee import router as daytrade_fee_router
from routes.market import router as market_router
from routes.symbols import router as symbols_router
from routes.options import router as options_router
from services import daytrade_fee as df_mod

load_dotenv()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # R2-P2-1 fail-loud:lifespan 啟動時嚴格驗證 FAKE_FINMIND,避免 typo
    # 'true'/'yes' 等仍走 real path 且靜默打 FinMind 燒 token / quota。
    fake = os.getenv("FAKE_FINMIND", "")
    if fake not in ("", "0", "1"):
        raise RuntimeError(f"invalid FAKE_FINMIND={fake!r} — only ''/'0'/'1' allowed")

    from routes import symbols as symbols_mod
    import services.finmind as fm_mod

    # perf/cold-start:kickoff 背景載入即 serve,不 await — 冷啟動 ready 時間
    # 與 FinMind fetch 脫鉤;第一發 /api/symbols/* 由 _ensure_loaded await 共用 task。
    symbols_mod.ensure_load_task()
    yield
    try:
        await symbols_mod.shutdown_load_task()
    finally:
        # close 放 finally:shutdown 段的取消 / 例外不得跳過連線清理。
        # 巢狀 finally:兩個 client 各自清,任一炸不跳過另一個。
        try:
            if fm_mod._client is not None:
                await fm_mod._client.close()
        finally:
            await df_mod.aclose()


app = FastAPI(title="Chip Overview", version="0.1.0", lifespan=lifespan)

_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_extra = os.getenv("FRONTEND_ORIGIN")
if _extra:
    _origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(chip_router)
app.include_router(daytrade_fee_router)
app.include_router(market_router, prefix="/api/market")
app.include_router(symbols_router)
app.include_router(options_router)


# /api/_meta/mode — Playwright globalSetup probe target(R2-P0-3 / F6)。
# 防 reuseExistingServer 撞到 dev server 真 backend → 整套 E2E 撞真 FinMind。
@app.get("/api/_meta/mode")
async def get_meta_mode() -> dict:
    return {
        "fake": os.getenv("FAKE_FINMIND") == "1",
        "fake_today": os.getenv("FAKE_TODAY", ""),
        "fixtures_dir": os.getenv("FAKE_FINMIND_FIXTURES_DIR", "<default>"),
    }


# Centralised error contract — every endpoint that talks to FinMind used to
# wrap its body in the same try/except trio. The trio now lives here.
# `{"detail": {"error": "<code>"}}` is the shape the frontend's __apiGet
# reads via `body.detail.error`.


@app.exception_handler(httpx.HTTPError)
async def httpx_error_handler(request: Request, exc: httpx.HTTPError) -> JSONResponse:
    logger.warning("Upstream HTTP error on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=502, content={"detail": {"error": "finmind_error"}})


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    # ValueError surfaced from service layer = "service not ready" (missing
    # token, bad config). Message is forwarded so the frontend can render it.
    return JSONResponse(status_code=503, content={"detail": {"error": str(exc)}})


# txo-chip-framework design v4 F6-integration: generic Exception handler so
# unhandled errors return the canonical {detail: {error: ...}} shape rather
# than FastAPI's default 500 with stack-trace-style detail (which would break
# frontend __apiGet's body.detail.error access). Comes LAST so the specific
# handlers above take precedence.
@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled %s on %s: %s", type(exc).__name__, request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": {"error": "internal_error"}})
