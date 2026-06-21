"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from routes.chip import router as chip_router
from routes.symbols import router as symbols_router

app.include_router(chip_router)
app.include_router(symbols_router)
