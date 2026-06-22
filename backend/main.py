"""FastAPI application entry point."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from routes.chip import router as chip_router
from routes.symbols import router as symbols_router

load_dotenv()


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
