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
from routes.symbols import router as symbols_router
from routes.options import router as options_router

load_dotenv()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from routes.symbols import load_symbols
    import services.finmind as fm_mod
    await load_symbols()
    yield
    if fm_mod._client is not None:
        await fm_mod._client.close()


app = FastAPI(title="Chip Overview", version="0.1.0", lifespan=lifespan)

_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if os.getenv("FRONTEND_ORIGIN"):
    _origins.append(os.getenv("FRONTEND_ORIGIN"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(chip_router)
app.include_router(symbols_router)
app.include_router(options_router)


# Centralised error contract — every endpoint that talks to FinMind used to
# wrap its body in the same try/except trio. The trio now lives here.
# `{"detail": {"error": "<code>"}}` is the shape the frontend's __apiGet
# reads via `body.detail.error`.

@app.exception_handler(httpx.HTTPError)
async def httpx_error_handler(request: Request, exc: httpx.HTTPError) -> JSONResponse:
    logger.warning("Upstream HTTP error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=502, content={"detail": {"error": "finmind_error"}}
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    # ValueError surfaced from service layer = "service not ready" (missing
    # token, bad config). Message is forwarded so the frontend can render it.
    return JSONResponse(
        status_code=503, content={"detail": {"error": str(exc)}}
    )
