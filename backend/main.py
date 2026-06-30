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
from routes.market import router as market_router
from routes.symbols import router as symbols_router
from routes.options import router as options_router

load_dotenv()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # R2-P2-1 fail-loud:lifespan 啟動時嚴格驗證 FAKE_FINMIND,避免 typo
    # 'true'/'yes' 等仍走 real path 且靜默打 FinMind 燒 token / quota。
    fake = os.getenv("FAKE_FINMIND", "")
    if fake not in ("", "0", "1"):
        raise RuntimeError(f"invalid FAKE_FINMIND={fake!r} — only ''/'0'/'1' allowed")

    from routes.symbols import load_symbols
    import services.finmind as fm_mod

    await load_symbols()
    yield
    if fm_mod._client is not None:
        await fm_mod._client.close()


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
