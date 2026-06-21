# 籌碼總攬獨立專案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the chip analysis feature from trading-king into a standalone project at `C:\side-project\trash-cmoney` with independent backend (FastAPI + FinMind API) and frontend (React 19 + Vite 6).

**Architecture:** Backend is a minimal FastAPI app with 4 endpoints (3 chip + 1 symbols search). FinMind API client handles caching, rate limiting, and inflight dedup. Frontend is a single-page React 19 app with hand-written SVG charts, Shadcn/ui base components, and Tailwind 4.

**Tech Stack:** Python 3.12 / FastAPI / httpx / Pydantic / React 19 / Vite 6 / TypeScript 5.7 / Tailwind CSS 4 / Shadcn/ui / Vitest

## Global Constraints

- Python >=3.12
- `.env` only contains `FINMIND_TOKEN` (required) and `FINMIND_RATE_LIMIT_PER_SEC` (optional, default 5)
- No Fubon SDK, no Supabase, no Discord, no SKCOM, no BFF API Key
- Backend cache version starts at 1 (new project)
- Frontend dark-mode only, color palette from chip-theme.ts
- All SVG charts are hand-written (no chart library)
- TypeScript strict mode enabled
- Source extracted from `C:\side-project\treading-king` — adapt imports, remove unused deps

---

## File Structure

### Backend (`backend/`)

| File | Responsibility |
|------|---------------|
| `main.py` | FastAPI app, CORS, lifespan (startup/shutdown), route registration |
| `services/rate_limiter.py` | TokenBucket class (thread-safe, async-compatible) |
| `services/finmind.py` | FinMindClient singleton: fetch, cache, rate-limit, dedup, data transforms |
| `routes/chip.py` | 3 GET endpoints for chip data |
| `routes/symbols.py` | GET /api/symbols search endpoint |
| `utils/cache.py` | `atomic_write_json`, `read_json`, `chip_cache_dir` helpers |
| `tests/test_finmind.py` | FinMind service unit tests |
| `tests/test_chip_routes.py` | Route integration tests |
| `pyproject.toml` | Project metadata + dependencies |
| `.env.example` | Environment variable template |

### Frontend (`frontend/`)

| File | Responsibility |
|------|---------------|
| `src/main.tsx` | React entry point |
| `src/App.tsx` | Single-page layout (header + tabs + content) |
| `src/components/SymbolSearch.tsx` | Debounced symbol search with dropdown |
| `src/components/ChipKlineChart.tsx` | K-line + 5 sub-charts orchestrator |
| `src/components/ChipBrokersPanel.tsx` | Institutional + margin + broker lists |
| `src/components/ChipBubbleView.tsx` | Bubble chart + price bars + trade lists |
| `src/hooks/useChipData.ts` | Fetch summary + history with race-safety |
| `src/hooks/useChipBubble.ts` | Fetch bubble data with race-safety |
| `src/hooks/useContainerSize.ts` | ResizeObserver-based responsive sizing |
| `src/lib/api.ts` | HTTP fetch wrapper for all endpoints |
| `src/lib/chip-data.ts` | TypeScript types + helper functions |
| `src/lib/chip-theme.ts` | Color palette constants |
| `src/lib/chip-kline-svg.tsx` | K-line + MA + volume SVG |
| `src/lib/chip-inst-bar-svg.tsx` | InstBarSvg + MarginLineSvg |
| `src/lib/chip-bubble-svg.tsx` | BubbleChartSvg |
| `src/lib/chip-price-bar-svg.tsx` | PriceBarSvg |
| `src/lib/chip-data.test.ts` | Data helper unit tests |

---

### Task 1: Backend Project Scaffold + Infrastructure

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/utils/__init__.py`
- Create: `backend/utils/cache.py`
- Create: `backend/services/__init__.py`
- Create: `backend/services/rate_limiter.py`
- Create: `backend/routes/__init__.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/main.py`
- Create: `.gitignore`

**Interfaces:**
- Produces: `TokenBucket` class with `acquire_async(tokens=1, timeout=None) -> bool`
- Produces: `atomic_write_json(path: Path, payload: Any) -> None`
- Produces: `read_json(path: Path, default: Any) -> Any`
- Produces: `chip_cache_dir() -> Path`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "trash-cmoney-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "httpx>=0.27",
    "pydantic>=2.6",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 2: Create .env.example**

```env
FINMIND_TOKEN=
FINMIND_RATE_LIMIT_PER_SEC=5
```

- [ ] **Step 3: Create .gitignore**

```gitignore
# Python
__pycache__/
*.pyc
*.egg-info/
.venv/
venv/

# Environment
backend/.env

# Cache
backend/data/

# Node
frontend/node_modules/
frontend/dist/

# IDE
.idea/
.vscode/
*.swp
```

- [ ] **Step 4: Create backend/utils/cache.py**

```python
"""Atomic JSON cache utilities."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parents[1]


def data_dir() -> Path:
    raw = os.getenv("CHIP_DATA_DIR", "").strip()
    return Path(raw) if raw else _BACKEND_DIR / "data"


def chip_cache_dir() -> Path:
    d = data_dir() / "cache" / "chip"
    d.mkdir(parents=True, exist_ok=True)
    return d


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
```

- [ ] **Step 5: Create backend/services/rate_limiter.py**

```python
"""Thread-safe token bucket rate limiter."""
from __future__ import annotations

import asyncio
import threading
import time


class TokenBucket:
    def __init__(self, rate: float = 5.0, capacity: float | None = None) -> None:
        if rate <= 0:
            raise ValueError(f"rate must be > 0, got {rate}")
        cap = float(capacity) if capacity is not None else max(float(rate), 1.0)
        if cap <= 0:
            raise ValueError(f"capacity must be > 0, got {cap}")
        self._rate = float(rate)
        self._capacity = cap
        self._tokens = cap
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()

    @property
    def rate(self) -> float:
        return self._rate

    def _refill_locked(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        if elapsed > 0:
            self._tokens = min(self._capacity, self._tokens + elapsed * self._rate)
            self._last_refill = now

    async def acquire_async(self, tokens: int = 1, timeout: float | None = None) -> bool:
        if tokens > self._capacity:
            raise ValueError(f"requested {tokens} tokens > capacity {self._capacity}")
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            with self._lock:
                self._refill_locked()
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return True
                wait = (tokens - self._tokens) / self._rate
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                wait = min(wait, remaining)
            await asyncio.sleep(wait)
```

- [ ] **Step 6: Create backend/main.py**

```python
"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.finmind import get_finmind
    yield
    client = get_finmind()
    await client.close()


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
```

- [ ] **Step 7: Create empty __init__.py files**

Create `backend/utils/__init__.py`, `backend/services/__init__.py`, `backend/routes/__init__.py`, `backend/tests/__init__.py` as empty files.

- [ ] **Step 8: Verify scaffold**

Run: `cd backend && pip install -e ".[dev]"`
Expected: Successful install with no errors.

Run: `cd backend && python -c "from utils.cache import chip_cache_dir; print(chip_cache_dir())"`
Expected: Prints a path ending in `data/cache/chip`

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: backend project scaffold with rate limiter and cache utils"
```

---

### Task 2: FinMind Service (Core Business Logic)

**Files:**
- Create: `backend/services/finmind.py`
- Create: `backend/tests/test_finmind.py`

**Interfaces:**
- Consumes: `TokenBucket.acquire_async()` from `services/rate_limiter.py`
- Consumes: `atomic_write_json`, `read_json`, `chip_cache_dir` from `utils/cache.py`
- Produces: `get_finmind() -> FinMindClient`
- Produces: `FinMindClient.fetch_chip_summary(symbol, date_str, refresh) -> dict`
- Produces: `FinMindClient.fetch_chip_bubble(symbol, date_str, refresh) -> dict`
- Produces: `FinMindClient.fetch_chip_history(symbol, refresh) -> dict`
- Produces: `FinMindClient.close() -> None`

- [ ] **Step 1: Write test_finmind.py**

```python
"""Tests for services/finmind.py — FinMind API client."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest


def _fm_response(data: list, status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {"msg": "success", "status": 200, "data": data}
    resp.raise_for_status = MagicMock()
    return resp


def _mock_http(*responses):
    client = AsyncMock()
    client.get = AsyncMock(side_effect=list(responses))
    return client


INST_ROW = {
    "date": "2026-06-19", "stock_id": "2330",
    "Foreign_Investor_buy": 12845000, "Foreign_Investor_sell": 8231000,
    "Foreign_Dealer_Self_buy": 0, "Foreign_Dealer_Self_sell": 0,
    "Investment_Trust_buy": 2156000, "Investment_Trust_sell": 1872000,
    "Dealer_buy": 0, "Dealer_sell": 0,
    "Dealer_self_buy": 1800000, "Dealer_self_sell": 2100000,
    "Dealer_Hedging_buy": 1621000, "Dealer_Hedging_sell": 2002000,
}

MARGIN_ROW = {
    "date": "2026-06-19", "stock_id": "2330",
    "MarginPurchaseBuy": 500, "MarginPurchaseSell": 300,
    "MarginPurchaseCashRepayment": 50,
    "MarginPurchaseTodayBalance": 18432,
    "MarginPurchaseYesterdayBalance": 18106,
    "MarginPurchaseLimit": 259362,
    "ShortSaleBuy": 100, "ShortSaleSell": 200,
    "ShortSaleCashRepayment": 13,
    "ShortSaleTodayBalance": 1245,
    "ShortSaleYesterdayBalance": 1332,
    "ShortSaleLimit": 259362,
    "OffsetLoanAndShort": 0, "Note": "",
}

BROKER_ROWS = [
    {"securities_trader": "美林", "securities_trader_id": "9A00",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1090.0, "buy": 800000, "sell": 20000},
    {"securities_trader": "美林", "securities_trader_id": "9A00",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1089.0, "buy": 445000, "sell": 18000},
    {"securities_trader": "元大-台北", "securities_trader_id": "6110",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1094.0, "buy": 25000, "sell": 500000},
    {"securities_trader": "元大-台北", "securities_trader_id": "6110",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1093.0, "buy": 20000, "sell": 392000},
]


@pytest.fixture(autouse=True)
def _reset_singleton(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    import services.finmind as mod
    mod._client = None
    mod._fm_limiter = None


@pytest.mark.asyncio
async def test_fetch_chip_summary_transforms():
    from services.finmind import FinMindClient
    mc = _mock_http(
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(BROKER_ROWS),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_summary("2330", "2026-06-19")
    assert r["symbol"] == "2330"
    assert r["institutional"]["foreign"]["buy"] == 12845
    assert r["institutional"]["foreign"]["net"] == 12845 - 8231
    assert r["institutional"]["trust"]["net"] == 2156 - 1872
    assert r["institutional"]["dealer"]["buy"] == (1800000 + 1621000) // 1000
    assert r["margin"]["margin_purchase"]["balance"] == 18432
    assert r["margin"]["margin_purchase"]["change"] == 18432 - 18106
    assert r["margin"]["short_balance_ratio"] == pytest.approx(1245 / 18432 * 100, rel=1e-2)
    assert len(r["top_brokers"]) == 2
    assert r["top_brokers"][0]["name"] == "美林"
    assert r["top_brokers"][0]["buy"] == (800000 + 445000) // 1000
    assert r["top_brokers"][0]["sell"] == (20000 + 18000) // 1000
    assert r["top_brokers"][0]["net"] == 1245 - 38


@pytest.mark.asyncio
async def test_fetch_chip_summary_cache_hit(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    from services.finmind import FinMindClient, _CACHE_VERSION
    cached = {
        "symbol": "2330", "date": "2026-01-01",
        "fetched_at": "2026-01-01T20:00:00",
        "institutional": {}, "margin": {}, "top_brokers": [],
        "_cache_version": _CACHE_VERSION,
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_2026-01-01.json").write_text(json.dumps(cached))
    client = FinMindClient()
    result = await client.fetch_chip_summary("2330", "2026-01-01")
    assert result == {k: v for k, v in cached.items() if k != "_cache_version"}


@pytest.mark.asyncio
async def test_fetch_chip_summary_refresh_ignores_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    from services.finmind import FinMindClient
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_2026-01-01.json").write_text(json.dumps({"old": True}))
    mc = _mock_http(
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(BROKER_ROWS),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_summary("2330", "2026-01-01", refresh=True)
    assert r["symbol"] == "2330"
    assert "old" not in r


@pytest.mark.asyncio
async def test_fetch_chip_summary_empty_data():
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_response([]), _fm_response([]), _fm_response([]))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_summary("9999", "2026-06-21")
    assert r["institutional"]["foreign"]["buy"] == 0
    assert r["margin"]["short_balance_ratio"] == 0
    assert r["top_brokers"] == []


@pytest.mark.asyncio
async def test_fetch_chip_bubble_transforms():
    from services.finmind import FinMindClient
    rows = [
        {"securities_trader": "美林", "securities_trader_id": "9A00",
         "price": 1090.0, "buy": 320000, "sell": 5000,
         "stock_id": "2330", "date": "2026-06-19"},
    ]
    mc = _mock_http(_fm_response(rows))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_bubble("2330", "2026-06-19")
    assert r["trades"][0]["buy"] == 320
    assert r["trades"][0]["sell"] == 5


@pytest.mark.asyncio
async def test_fetch_chip_history():
    from services.finmind import FinMindClient
    candle_row = {
        "date": "2026-06-19", "stock_id": "2330",
        "open": 1080, "max": 1098, "min": 1078, "close": 1095,
        "Trading_Volume": 36200,
    }
    agg_row = {
        "date": "2026-06-19", "securities_trader": "A",
        "securities_trader_id": "A1", "buy": 5000000, "sell": 1000000,
    }
    mc = _mock_http(
        _fm_response([candle_row]),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response([agg_row]),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history("2330")
    assert r["candles"][0]["high"] == 1098.0
    assert r["candles"][0]["volume"] == 36
    assert r["institutional"][0]["foreign_net"] == 12845 - 8231
    assert r["margin"][0]["margin_change"] == 18432 - 18106
    assert r["major"][0]["major_net"] == 4000


def test_to_lots_truncation():
    from services.finmind import _to_lots
    assert _to_lots(0) == 0
    assert _to_lots(999) == 0
    assert _to_lots(1000) == 1
    assert _to_lots(1500) == 1
    assert _to_lots(-1000) == -1
    assert _to_lots(-1500) == -1
    assert _to_lots(-499) == 0


def test_compute_major_net():
    from services.finmind import _compute_major_net
    rows = [
        {"securities_trader": "A", "securities_trader_id": "A1",
         "price": 100.0, "buy": 5000000, "sell": 1000000},
        {"securities_trader": "B", "securities_trader_id": "B1",
         "price": 100.0, "buy": 500000, "sell": 3000000},
    ]
    assert _compute_major_net(rows) == 1500
    assert _compute_major_net([]) == 0


def test_compute_major_net_agg():
    from services.finmind import _compute_major_net_agg
    rows = [
        {"buy": 5000000, "sell": 1000000},
        {"buy": 500000, "sell": 3000000},
    ]
    assert _compute_major_net_agg(rows) == 1500


def test_broker_net_from_truncated_lots():
    from services.finmind import _parse_top_brokers
    rows = [
        {"securities_trader": "TestA", "securities_trader_id": "T001",
         "price": 100.0, "buy": 5730600, "sell": 4496400},
    ]
    result = _parse_top_brokers(rows)
    assert result[0]["buy"] == 5730
    assert result[0]["sell"] == 4496
    assert result[0]["net"] == 1234


def test_no_token_raises(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "")
    from services.finmind import FinMindClient
    with pytest.raises(ValueError, match="FINMIND_TOKEN"):
        FinMindClient()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_finmind.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.finmind'`

- [ ] **Step 3: Create backend/services/finmind.py**

Copy the full `finmind.py` from `C:\side-project\treading-king\backend\services\finmind.py` with these modifications:
- Change import: `from services.local_store.paths import ...` → `from utils.cache import atomic_write_json, chip_cache_dir, read_json`
- Change `_CACHE_VERSION = 7` → `_CACHE_VERSION = 1`
- Keep all other code identical (FinMindClient class, all `_parse_*` functions, `_to_lots`, `_compute_major_net*`)

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_finmind.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/finmind.py backend/tests/test_finmind.py
git commit -m "feat: FinMind service with cache, rate limiting, and data transforms"
```

---

### Task 3: API Routes (Chip + Symbols)

**Files:**
- Create: `backend/routes/chip.py`
- Create: `backend/routes/symbols.py`
- Create: `backend/tests/test_chip_routes.py`

**Interfaces:**
- Consumes: `get_finmind()` from `services/finmind.py`
- Produces: `GET /api/chip/{symbol}` → dict
- Produces: `GET /api/chip/{symbol}/bubble` → dict
- Produces: `GET /api/chip/{symbol}/history` → dict
- Produces: `GET /api/symbols?search=` → list[dict]

- [ ] **Step 1: Create backend/routes/chip.py**

```python
"""Chip data (籌碼) API routes."""
from __future__ import annotations

import logging
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query

from services.finmind import get_finmind

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/chip/{symbol}")
async def get_chip_summary(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    try:
        return await get_finmind().fetch_chip_summary(symbol, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Unexpected chip error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})


@router.get("/api/chip/{symbol}/bubble")
async def get_chip_bubble(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    try:
        return await get_finmind().fetch_chip_bubble(symbol, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind bubble error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Unexpected chip bubble error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})


@router.get("/api/chip/{symbol}/history")
async def get_chip_history(
    symbol: str,
    refresh: bool = Query(default=False),
) -> dict:
    try:
        return await get_finmind().fetch_chip_history(symbol, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind history error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Unexpected chip history error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})


def _today() -> str:
    return date.today().isoformat()
```

- [ ] **Step 2: Create backend/routes/symbols.py**

```python
"""Symbol search endpoint using FinMind TaiwanStockInfo."""
from __future__ import annotations

import logging
import os
from datetime import date

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)
router = APIRouter()

_symbols: list[dict] = []


async def load_symbols() -> None:
    global _symbols
    token = os.getenv("FINMIND_TOKEN", "")
    if not token:
        logger.warning("FINMIND_TOKEN not set, symbol search disabled")
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://api.finmindtrade.com/api/v4/data",
                params={"dataset": "TaiwanStockInfo", "token": token},
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
            _symbols = [
                {"symbol": r["stock_id"], "name": r.get("stock_name", "")}
                for r in data
                if r.get("stock_id") and r.get("type") in ("twse", "otc", "")
            ]
            logger.info("Loaded %d symbols from FinMind", len(_symbols))
    except Exception as exc:
        logger.warning("Failed to load symbols: %s", exc)


@router.get("/api/symbols")
async def search_symbols(search: str = Query(default="", min_length=1)) -> list[dict]:
    if not search:
        return []
    q = search.lower()
    results = []
    for s in _symbols:
        if s["symbol"].startswith(q) or q in s["name"].lower():
            results.append(s)
            if len(results) >= 20:
                break
    return results
```

- [ ] **Step 3: Update backend/main.py lifespan to load symbols**

Update the lifespan function to call `load_symbols()` on startup:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    from routes.symbols import load_symbols
    from services.finmind import get_finmind
    await load_symbols()
    yield
    client = get_finmind()
    await client.close()
```

- [ ] **Step 4: Create backend/tests/test_chip_routes.py**

```python
"""Tests for routes/chip.py — chip data API endpoints."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app

MOCK_SUMMARY = {
    "symbol": "2330", "date": "2026-06-19",
    "fetched_at": "2026-06-19T20:15:00",
    "institutional": {
        "foreign": {"buy": 100, "sell": 50, "net": 50},
        "trust": {"buy": 10, "sell": 5, "net": 5},
        "dealer": {"buy": 20, "sell": 30, "net": -10},
    },
    "margin": {
        "margin_purchase": {"balance": 1000, "change": 10, "limit": 5000},
        "short_sale": {"balance": 50, "change": -5, "limit": 5000},
        "short_balance_ratio": 5.0,
    },
    "top_brokers": [
        {"name": "美林", "broker_id": "9A00",
         "buy": 100, "sell": 5, "net": 95,
         "avg_buy_price": 100.0, "avg_sell_price": 101.0},
    ],
}

MOCK_BUBBLE = {
    "symbol": "2330", "date": "2026-06-19",
    "fetched_at": "2026-06-19T20:15:00",
    "trades": [{"broker": "美林", "broker_id": "9A00", "price": 100.0, "buy": 50, "sell": 3}],
}

MOCK_HISTORY = {
    "symbol": "2330", "fetched_at": "2026-06-19T20:15:00",
    "last_date": "2026-06-19",
    "candles": [{"date": "2026-06-19", "open": 100, "high": 105, "low": 99, "close": 103, "volume": 30000}],
    "institutional": [{"date": "2026-06-19", "foreign_net": 50, "trust_net": 5, "dealer_net": -10, "major_net": 45}],
    "margin": [{"date": "2026-06-19", "margin_balance": 1000, "short_balance": 50, "margin_change": 10, "short_change": -3}],
    "major": [{"date": "2026-06-19", "major_net": 45}],
}


@pytest.fixture
def mock_fm():
    svc = AsyncMock()
    svc.fetch_chip_summary = AsyncMock(return_value=MOCK_SUMMARY)
    svc.fetch_chip_bubble = AsyncMock(return_value=MOCK_BUBBLE)
    svc.fetch_chip_history = AsyncMock(return_value=MOCK_HISTORY)
    with patch("routes.chip.get_finmind", return_value=svc):
        yield svc


def test_chip_summary(mock_fm):
    resp = TestClient(app).get("/api/chip/2330?date=2026-06-19")
    assert resp.status_code == 200
    assert resp.json()["symbol"] == "2330"
    mock_fm.fetch_chip_summary.assert_awaited_once_with("2330", "2026-06-19", False)


def test_chip_summary_default_date(mock_fm):
    resp = TestClient(app).get("/api/chip/2330")
    assert resp.status_code == 200


def test_chip_summary_refresh(mock_fm):
    resp = TestClient(app).get("/api/chip/2330?date=2026-06-19&refresh=true")
    assert resp.status_code == 200
    mock_fm.fetch_chip_summary.assert_awaited_once_with("2330", "2026-06-19", True)


def test_chip_bubble(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/bubble?date=2026-06-19")
    assert resp.status_code == 200
    assert resp.json()["trades"][0]["broker"] == "美林"


def test_chip_history(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history")
    assert resp.status_code == 200
    assert len(resp.json()["candles"]) == 1


def test_chip_summary_finmind_error(mock_fm):
    mock_req = MagicMock()
    mock_resp = MagicMock()
    mock_fm.fetch_chip_summary = AsyncMock(
        side_effect=httpx.HTTPStatusError("402", request=mock_req, response=mock_resp)
    )
    resp = TestClient(app).get("/api/chip/2330?date=2026-06-19")
    assert resp.status_code == 502


def test_chip_summary_no_token(mock_fm):
    mock_fm.fetch_chip_summary = AsyncMock(
        side_effect=ValueError("FINMIND_TOKEN env var is required")
    )
    resp = TestClient(app).get("/api/chip/2330")
    assert resp.status_code == 503
```

- [ ] **Step 5: Run all backend tests**

Run: `cd backend && pytest -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routes/ backend/tests/test_chip_routes.py backend/main.py
git commit -m "feat: chip API routes and symbol search endpoint"
```

---

### Task 4: Frontend Project Scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.app.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/components.json`
- Create: `frontend/src/lib/utils.ts`

**Interfaces:**
- Produces: Working Vite dev server on port 5173 with proxy to backend

- [ ] **Step 1: Create frontend/package.json**

```json
{
  "name": "trash-cmoney-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create frontend/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
```

- [ ] **Step 3: Create frontend/tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" }
  ]
}
```

- [ ] **Step 4: Create frontend/tsconfig.app.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create frontend/index.html**

```html
<!DOCTYPE html>
<html lang="zh-TW" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>籌碼總攬</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body class="bg-[#14110c] text-[#ede4d3] antialiased">
  <div id="root" class="h-screen"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Create frontend/src/index.css**

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter Tight", system-ui, sans-serif;
  --color-bg: #14110c;
  --color-bg-deep: #0e0c08;
  --color-ink: #ede4d3;
  --color-ink-muted: #d4c8b0;
  --color-ink-dim: #8a8273;
  --color-line: #2e2a22;
  --color-line-strong: #4a4234;
  --color-accent: #e85a4f;
  --color-bull: #e85a4f;
  --color-bear: #7fc99a;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-line-strong) transparent;
}
```

- [ ] **Step 7: Create frontend/src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Create frontend/src/App.tsx placeholder**

```tsx
export default function App() {
  return (
    <div className="h-full flex items-center justify-center text-ink-dim">
      籌碼總攬 — scaffold OK
    </div>
  );
}
```

- [ ] **Step 9: Create frontend/src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 10: Create frontend/components.json**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 11: Install dependencies and verify**

Run: `cd frontend && npm install`
Expected: Successful install

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 12: Install Shadcn/ui components**

Run: `cd frontend && npx shadcn@latest add input button tabs skeleton`
Expected: Components added to `src/components/ui/`

- [ ] **Step 13: Commit**

```bash
git add frontend/
git commit -m "feat: frontend project scaffold with React 19, Vite 6, Tailwind 4, Shadcn/ui"
```

---

### Task 5: Frontend Data Layer (Types + API + Hooks + Tests)

**Files:**
- Create: `frontend/src/lib/chip-data.ts`
- Create: `frontend/src/lib/chip-theme.ts`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/hooks/useChipData.ts`
- Create: `frontend/src/hooks/useChipBubble.ts`
- Create: `frontend/src/hooks/useContainerSize.ts`
- Create: `frontend/src/lib/chip-data.test.ts`

**Interfaces:**
- Produces: All TypeScript types (`ChipSummary`, `ChipHistory`, `ChipBubbleData`, etc.)
- Produces: `api.chip()`, `api.chipBubble()`, `api.chipHistory()`, `api.symbols()`
- Produces: `useChipData(symbol, date)` → `{summary, history, loading, error, refresh}`
- Produces: `useChipBubble(symbol, date)` → `{data, loading, error, refresh}`
- Produces: `useContainerSize(ref)` → `{width, height}`
- Produces: `splitBrokers()`, `aggregateByBroker()`, `aggregateByPrice()`, `fmtVol()`

- [ ] **Step 1: Create frontend/src/lib/chip-theme.ts**

```typescript
export const CHIP = {
  bull: "#e85a4f",
  bear: "#7fc99a",
  ink: "#ede4d3",
  inkMuted: "#d4c8b0",
  inkDim: "#8a8273",
  line: "#2e2a22",
  lineStrong: "#4a4234",
  ma5: "#f0b429",
  ma20: "#b794f4",
  font: '"Inter Tight", system-ui, sans-serif',
} as const;
```

- [ ] **Step 2: Create frontend/src/lib/chip-data.ts**

Copy the full content from `C:\side-project\treading-king\frontend\src\lib\chip-data.ts` — it is already self-contained with no external dependencies. All types and helper functions copy verbatim.

- [ ] **Step 3: Create frontend/src/lib/api.ts**

```typescript
import type { ChipSummary, ChipBubbleData, ChipHistory } from "./chip-data";

const BASE = "/api";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

export const api = {
  chip(symbol: string, date?: string, refresh?: boolean): Promise<ChipSummary> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}`, params);
  },
  chipBubble(symbol: string, date?: string, refresh?: boolean): Promise<ChipBubbleData> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/bubble`, params);
  },
  chipHistory(symbol: string, refresh?: boolean): Promise<ChipHistory> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/history`, params);
  },
  symbols(search: string): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols`, { search });
  },
};
```

- [ ] **Step 4: Create frontend/src/hooks/useChipData.ts**

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import type { ChipSummary, ChipHistory } from "../lib/chip-data";

export function useChipData(symbol: string, date: string) {
  const [summary, setSummary] = useState<ChipSummary | null>(null);
  const [history, setHistory] = useState<ChipHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (!symbol) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const [s, h] = await Promise.all([
          api.chip(symbol, date, refresh),
          api.chipHistory(symbol, refresh),
        ]);
        if (seq !== seqRef.current) return;
        setSummary(s);
        setHistory(h);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入籌碼資料失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [symbol, date],
  );

  useEffect(() => {
    setSummary(null);
    setHistory(null);
    setError(null);
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  return { summary, history, loading, error, refresh };
}
```

- [ ] **Step 5: Create frontend/src/hooks/useChipBubble.ts**

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import type { ChipBubbleData } from "../lib/chip-data";

export function useChipBubble(symbol: string, date: string) {
  const [data, setData] = useState<ChipBubbleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (!symbol) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await api.chipBubble(symbol, date, refresh);
        if (seq !== seqRef.current) return;
        setData(result);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入泡泡圖資料失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [symbol, date],
  );

  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, loading, error, refresh };
}
```

- [ ] **Step 6: Create frontend/src/hooks/useContainerSize.ts**

```typescript
import { useCallback, useEffect, useState } from "react";

export interface ContainerSize {
  width: number;
  height: number;
}

export function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  const measure = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    setSize((prev) => {
      if (prev.width === w && prev.height === h) return prev;
      return { width: w, height: h };
    });
  }, [ref]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, measure]);

  return size;
}
```

- [ ] **Step 7: Create frontend/src/lib/chip-data.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { splitBrokers, aggregateByPrice, aggregateByBroker, fmtVol } from "./chip-data";
import type { TopBroker, BrokerTrade } from "./chip-data";

describe("splitBrokers", () => {
  const brokers: TopBroker[] = [
    { name: "A", broker_id: "A1", buy: 100, sell: 20, net: 80, avg_buy_price: 100, avg_sell_price: 101 },
    { name: "B", broker_id: "B1", buy: 10, sell: 50, net: -40, avg_buy_price: 99, avg_sell_price: 100 },
    { name: "C", broker_id: "C1", buy: 30, sell: 10, net: 20, avg_buy_price: 100, avg_sell_price: 100 },
    { name: "D", broker_id: "D1", buy: 5, sell: 60, net: -55, avg_buy_price: 98, avg_sell_price: 99 },
  ];

  it("separates buyers (net>0) from sellers (net<0)", () => {
    const { buyers, sellers } = splitBrokers(brokers);
    expect(buyers.map((b) => b.name)).toEqual(["A", "C"]);
    expect(sellers.map((b) => b.name)).toEqual(["D", "B"]);
  });

  it("sorts buyers desc by net, sellers asc by net", () => {
    const { buyers, sellers } = splitBrokers(brokers);
    expect(buyers[0].net).toBeGreaterThan(buyers[1].net);
    expect(sellers[0].net).toBeLessThan(sellers[1].net);
  });
});

describe("aggregateByPrice", () => {
  const trades: BrokerTrade[] = [
    { broker: "X", broker_id: "X1", price: 100, buy: 50, sell: 10 },
    { broker: "Y", broker_id: "Y1", price: 100, buy: 30, sell: 20 },
    { broker: "X", broker_id: "X1", price: 101, buy: 10, sell: 40 },
  ];

  it("aggregates buy/sell by price, sorted desc", () => {
    const result = aggregateByPrice(trades);
    expect(result).toEqual([
      { price: 101, buy: 10, sell: 40 },
      { price: 100, buy: 80, sell: 30 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateByPrice([])).toEqual([]);
  });
});

describe("aggregateByBroker", () => {
  const trades: BrokerTrade[] = [
    { broker: "X", broker_id: "X1", price: 100, buy: 50, sell: 10 },
    { broker: "X", broker_id: "X1", price: 101, buy: 30, sell: 20 },
    { broker: "Y", broker_id: "Y1", price: 100, buy: 10, sell: 40 },
  ];

  it("aggregates buy/sell by broker with weighted average prices", () => {
    const result = aggregateByBroker(trades);
    const x = result.find((b) => b.name === "X")!;
    expect(x.totalBuy).toBe(80);
    expect(x.totalSell).toBe(30);
    expect(x.avgBuyPrice).toBeCloseTo((100 * 50 + 101 * 30) / 80, 0);
  });
});

describe("fmtVol", () => {
  it("formats with locale separators", () => {
    expect(fmtVol(1234567)).toContain("1");
    expect(fmtVol(0)).toBe("0");
  });
});
```

- [ ] **Step 8: Run tests**

Run: `cd frontend && npm test`
Expected: All tests PASS

- [ ] **Step 9: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/ frontend/src/hooks/
git commit -m "feat: frontend data layer — types, API client, hooks, tests"
```

---

### Task 6: SVG Chart Components

**Files:**
- Create: `frontend/src/lib/chip-kline-svg.tsx`
- Create: `frontend/src/lib/chip-inst-bar-svg.tsx`
- Create: `frontend/src/lib/chip-bubble-svg.tsx`
- Create: `frontend/src/lib/chip-price-bar-svg.tsx`

**Interfaces:**
- Consumes: `CHIP` from `chip-theme.ts`, types from `chip-data.ts`
- Produces: `KlineChartSvg` component (props: candles, width, height, hoverIndex, onHoverIndex)
- Produces: `InstBarSvg` component (props: data, width, height, label, hoverIndex)
- Produces: `MarginLineSvg` component (props: marginData, shortData, marginBalanceData, shortBalanceData, width, height, label, hoverIndex)
- Produces: `BubbleChartSvg` component (props: trades, width, height, closePrice, onHover, onClick)
- Produces: `PriceBarSvg` component (props: data, width, height, selectedBroker)
- Produces: `klineScaleY()`, `bubbleRadius()`, `instBarHeight()` (exported for tests)

- [ ] **Step 1: Copy SVG files from source**

Copy these files verbatim from `C:\side-project\treading-king\frontend\src\lib\`:
- `chip-kline-svg.tsx`
- `chip-inst-bar-svg.tsx`
- `chip-bubble-svg.tsx`
- `chip-price-bar-svg.tsx`

No modifications needed — these are self-contained, importing only from `./chip-theme` and `./chip-data`.

- [ ] **Step 2: Create SVG test file**

Copy `C:\side-project\treading-king\frontend\src\lib\chip-svg.test.ts` to `frontend/src/lib/chip-svg.test.ts` — it tests `klineScaleY`, `bubbleRadius`, `instBarHeight`, `splitBrokers`, `aggregateByPrice`, `aggregateByBroker` (the latter three already tested in chip-data.test.ts but keeping for completeness).

- [ ] **Step 3: Run tests**

Run: `cd frontend && npm test`
Expected: All tests PASS (both chip-data.test.ts and chip-svg.test.ts)

- [ ] **Step 4: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chip-*-svg.tsx frontend/src/lib/chip-svg.test.ts
git commit -m "feat: SVG chart components — kline, inst-bar, bubble, price-bar"
```

---

### Task 7: Page Components + App Integration

**Files:**
- Create: `frontend/src/components/SymbolSearch.tsx`
- Create: `frontend/src/components/ChipKlineChart.tsx`
- Create: `frontend/src/components/ChipBrokersPanel.tsx`
- Create: `frontend/src/components/ChipBubbleView.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: All hooks, all SVG components, all types
- Produces: Complete working single-page application

- [ ] **Step 1: Create frontend/src/components/SymbolSearch.tsx**

```tsx
import { useCallback, useRef, useState } from "react";
import { Input } from "./ui/input";
import { api } from "@/lib/api";

interface Props {
  onPick: (symbol: string, name: string | null) => void;
  placeholder?: string;
}

export function SymbolSearch({ onPick, placeholder = "搜尋代號或名稱..." }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ symbol: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api.symbols(q.trim());
        setResults(r);
        setOpen(r.length > 0);
      } catch {
        setResults([]);
      }
    }, 200);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    search(v);
  };

  const handlePick = (s: { symbol: string; name: string }) => {
    setQuery(s.symbol);
    setOpen(false);
    onPick(s.symbol, s.name);
  };

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="bg-bg-deep border-line text-ink"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 w-full mt-1 bg-bg-deep border border-line max-h-60 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.symbol}
              type="button"
              onMouseDown={() => handlePick(r)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-line-strong/30 flex items-center gap-2 cursor-pointer"
            >
              <span className="text-ink font-medium">{r.symbol}</span>
              <span className="text-ink-muted">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create frontend/src/components/ChipKlineChart.tsx**

Copy from `C:\side-project\treading-king\frontend\src\components\ChipKlineChart.tsx` verbatim — it imports only from `../lib/chip-data`, `../lib/chip-kline-svg`, `../lib/chip-inst-bar-svg`, `../hooks/useContainerSize`. All paths are the same.

- [ ] **Step 3: Create frontend/src/components/ChipBrokersPanel.tsx**

Copy from `C:\side-project\treading-king\frontend\src\components\ChipBrokersPanel.tsx` verbatim — imports from `../lib/chip-data` and `../lib/chip-theme`.

- [ ] **Step 4: Create frontend/src/components/ChipBubbleView.tsx**

Copy from `C:\side-project\treading-king\frontend\src\components\ChipBubbleView.tsx` verbatim — imports from `../lib/chip-data`, `../lib/chip-bubble-svg`, `../lib/chip-price-bar-svg`, `../hooks/useContainerSize`.

- [ ] **Step 5: Rewrite frontend/src/App.tsx**

Adapt from `C:\side-project\treading-king\frontend\src\pages\ChipData.tsx` with these changes:
- Remove `active` prop (always active)
- Replace `SymbolSearch` import path to local component
- Add as the default export
- Keep all other logic identical (tab state, date auto-adjust, lazy loading, hidden pattern, error banner)

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SymbolSearch } from "./components/SymbolSearch";
import { ChipBrokersPanel } from "./components/ChipBrokersPanel";
import { ChipKlineChart } from "./components/ChipKlineChart";
import { useChipData } from "./hooks/useChipData";
import { useChipBubble } from "./hooks/useChipBubble";

const ChipBubbleView = lazy(() =>
  import("./components/ChipBubbleView").then((m) => ({ default: m.ChipBubbleView })),
);

type Tab = "overview" | "bubble";

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [symbol, setSymbol] = useState("");
  const [symbolName, setSymbolName] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr);
  const [tab, setTab] = useState<Tab>("overview");
  const userPickedDate = useRef(false);

  const { summary, history, loading, error, refresh: refreshChip } = useChipData(symbol, date);
  const bubbleHook = useChipBubble(symbol, date);

  useEffect(() => {
    if (userPickedDate.current) return;
    if (!history?.candles?.length) return;
    const lastCandleDate = history.candles[history.candles.length - 1].date;
    if (lastCandleDate < date) {
      setDate(lastCandleDate);
    }
  }, [history, date]);

  const refresh = () => {
    refreshChip();
    if (tab === "bubble") bubbleHook.refresh();
  };
  const isLoading = loading || bubbleHook.loading;

  const handlePick = (sym: string, name: string | null) => {
    setSymbol(sym);
    setSymbolName(name);
    userPickedDate.current = false;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5 pb-3 border-b border-line">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl text-ink font-semibold">籌碼分析</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-[220px]">
            <SymbolSearch onPick={handlePick} />
          </div>
          {symbol && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-ink font-medium">{symbol}</span>
              {symbolName && <span className="text-ink-muted">{symbolName}</span>}
            </div>
          )}
          <input
            type="date"
            value={date}
            onChange={(e) => { userPickedDate.current = true; setDate(e.target.value); }}
            className="bg-bg-deep border border-line text-ink px-2.5 py-1.5 text-sm outline-none focus:border-accent tabular-nums"
          />
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading || !symbol}
            className="px-3 py-1.5 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-40 disabled:cursor-default transition-colors cursor-pointer"
          >
            {isLoading ? "載入中..." : "重新整理"}
          </button>
        </div>
        <div className="flex mt-3 gap-0 border-b border-line -mb-[1px]">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`px-4 py-2 text-sm transition-colors cursor-pointer ${
              tab === "overview"
                ? "text-accent border-b-2 border-accent font-medium"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            籌碼總覽
          </button>
          <button
            type="button"
            onClick={() => setTab("bubble")}
            className={`px-4 py-2 text-sm transition-colors cursor-pointer ${
              tab === "bubble"
                ? "text-accent border-b-2 border-accent font-medium"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            泡泡圖
          </button>
        </div>
      </header>

      {(error || bubbleHook.error) && (
        <div className="shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error || bubbleHook.error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <div hidden={tab !== "overview"} className="h-full">
          <div className="h-full grid grid-cols-[1fr_420px] overflow-hidden">
            <div className="h-full overflow-hidden border-r border-line">
              <ChipKlineChart history={history} />
            </div>
            <div className="h-full overflow-hidden">
              <ChipBrokersPanel summary={summary} />
            </div>
          </div>
        </div>
        <div hidden={tab !== "bubble"} className="h-full">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-ink-dim text-sm">
                載入泡泡圖元件...
              </div>
            }
          >
            <ChipBubbleView
              bubbleData={bubbleHook.data}
              closePrice={history?.candles?.find(c => c.date === date)?.close ?? history?.candles?.[history.candles.length - 1]?.close}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Dev server smoke test**

Run backend: `cd backend && uvicorn main:app --port 8000`
Run frontend: `cd frontend && npm run dev`
Open browser: `http://localhost:5173`
Expected: Page renders with "籌碼分析" header, symbol search works, charts render when symbol selected.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ frontend/src/App.tsx
git commit -m "feat: page components + app integration — full chip analysis UI"
```

---

## Self-Review Checklist

1. **Spec coverage:** All 11 sections of the spec are covered:
   - Section 1 (Goal) → Tasks 1-7 collectively
   - Section 2 (Tech stack) → Task 1 (pyproject.toml) + Task 4 (package.json)
   - Section 3 (Env vars) → Task 1 (.env.example)
   - Section 4 (Project structure) → File structure table above
   - Section 5 (Backend API) → Tasks 2-3
   - Section 6 (Frontend) → Tasks 4-7
   - Section 7 (Tests) → Tasks 2, 3, 5, 6
   - Section 8 (Startup) → Task 1 (pyproject.toml scripts) + Task 7 (smoke test)
   - Section 9 (Removed items) → Implicit in scaffold (no traces of removed deps)
   - Section 10 (CORS) → Task 1 (main.py)
   - Section 11 (Shadcn config) → Task 4 (components.json)

2. **Placeholder scan:** No TBD/TODO found. All steps have concrete code or commands.

3. **Type consistency:** Verified cross-task interface signatures match:
   - `TokenBucket.acquire_async()` in Task 1 matches usage in Task 2
   - `get_finmind()` in Task 2 matches import in Task 3
   - `api.chip()` return type in Task 5 matches usage in Task 7
   - `useChipData(symbol, date)` signature in Task 5 matches Task 7
   - `ChipKlineChart`, `ChipBrokersPanel`, `ChipBubbleView` props match between Tasks 6 and 7
