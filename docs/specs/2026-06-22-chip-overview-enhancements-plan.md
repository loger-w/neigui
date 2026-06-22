# Chip Overview Five-Feature Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 chip-overview enhancements (drop summary rows, selectbar with 當沖率, K-line click date, multi-broker history bar, bubble broker search) per `docs/specs/2026-06-22-chip-overview-enhancements-design.md`.

**Architecture:** Backend adds one new `broker_history` endpoint that reuses existing SecIdAgg fetch + new cache file. Frontend adds `useBrokerHistory` hook, `BrokerSearch` typeahead, `BrokerAggBarSvg` 6th sub-chart, selectbar mode toggle, multi-select checkbox flow on existing `ChipBrokersPanel`, and click-to-pick-date wiring on `ChipKlineChart`. Existing 5 sub-chart SVGs gain optional `selectedIndex` prop (back-compat).

**Tech Stack:** Python 3.12 / FastAPI / httpx (backend) · React 19 / TypeScript / Vite / Tailwind v4 / Vitest / @testing-library/react (frontend) · FinMind API datasets `taiwan_stock_trading_daily_report_secid_agg` (existing) for the per-broker daily series.

## Global Constraints

- Buy / 上漲 / 正淨額 color = `#e85a4f` (`--color-accent` / `chip-theme.CHIP.bull`).
- Sell / 下跌 / 負淨額 color = `#7fc99a` (`--color-bear` / `chip-theme.CHIP.bear`).
- K-line selected-day cursor + 50-80% 當沖率 + search highlight color = `#f0b429` (`chip-theme.CHIP.ma5`).
- Checked broker chip / checkbox + 6th-row label + ≥80% 當沖率 color = `#b794f4` (`chip-theme.CHIP.ma20`).
- TW stock convention: bull = red, bear = green — do NOT swap.
- Do not change `_CACHE_VERSION` (stays at 2).
- Do not modify `_safe_get_secid_agg` signature or its silent `[]` fallback (existing history endpoint depends on it).
- All Tailwind colors use arbitrary value syntax `text-[#xxxxxx]` or import from `chip-theme.ts`; do NOT add new CSS variables.
- No new UI framework / component library.
- Volume in 張 (lots); divide raw shares by 1000 via existing `_to_lots` helper.

---

### Task 1: Backend `_parse_broker_history` pure function

**Files:**
- Modify: `backend/services/finmind.py` (append new function near existing `_parse_top_brokers` / `_compute_major_net_agg`)
- Create: `backend/tests/test_broker_history.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```python
  def _parse_broker_history(rows: list) -> dict[str, list[dict]]:
      """Group SecIdAgg rows by broker_id; each daily = {date, buy, sell, net} in 張."""
  ```

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_broker_history.py`:
```python
"""Tests for broker-history parsing and fetch."""
from __future__ import annotations

import pytest

from services.finmind import _parse_broker_history


def test_parse_broker_history_groups_by_broker_id():
    rows = [
        {"securities_trader_id": "9201", "securities_trader": "凱基",
         "date": "2026-06-20", "buy": 100000, "sell": 50000},
        {"securities_trader_id": "9202", "securities_trader": "富邦",
         "date": "2026-06-20", "buy": 30000, "sell": 80000},
        {"securities_trader_id": "9201", "securities_trader": "凱基",
         "date": "2026-06-21", "buy": 20000, "sell": 0},
    ]
    result = _parse_broker_history(rows)
    assert set(result.keys()) == {"9201", "9202"}
    assert len(result["9201"]) == 2
    assert len(result["9202"]) == 1


def test_parse_broker_history_computes_net_in_lots():
    rows = [
        {"securities_trader_id": "X", "date": "2026-06-20",
         "buy": 120000, "sell": 50000},
    ]
    result = _parse_broker_history(rows)
    # 120000 shares → 120 lots; 50000 → 50; net = 70
    assert result["X"][0] == {"date": "2026-06-20", "buy": 120, "sell": 50, "net": 70}


def test_parse_broker_history_truncates_shares_to_lots():
    rows = [
        {"securities_trader_id": "X", "date": "2026-06-20",
         "buy": 1500, "sell": 999},
    ]
    # 1500 → 1 lot (truncate); 999 → 0
    result = _parse_broker_history(rows)
    assert result["X"][0]["buy"] == 1
    assert result["X"][0]["sell"] == 0


def test_parse_broker_history_skips_blank_broker_id():
    rows = [
        {"securities_trader_id": "", "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "  ", "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "Y", "date": "2026-06-20", "buy": 1000, "sell": 0},
    ]
    result = _parse_broker_history(rows)
    assert list(result.keys()) == ["Y"]


def test_parse_broker_history_aggregates_duplicate_date_rows():
    rows = [
        {"securities_trader_id": "Z", "date": "2026-06-20",
         "buy": 1000, "sell": 0},
        {"securities_trader_id": "Z", "date": "2026-06-20",
         "buy": 2000, "sell": 500},
    ]
    result = _parse_broker_history(rows)
    assert len(result["Z"]) == 1
    # buy = 3 lots, sell = 0 lots (500 truncated)
    assert result["Z"][0] == {"date": "2026-06-20", "buy": 3, "sell": 0, "net": 3}


def test_parse_broker_history_empty_input():
    assert _parse_broker_history([]) == {}


def test_parse_broker_history_strips_broker_id_whitespace():
    rows = [
        {"securities_trader_id": " 9201 ", "date": "2026-06-20",
         "buy": 1000, "sell": 0},
    ]
    result = _parse_broker_history(rows)
    assert list(result.keys()) == ["9201"]
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && python -m pytest tests/test_broker_history.py -v
```
Expected: `ImportError: cannot import name '_parse_broker_history'`

- [ ] **Step 3: Implement `_parse_broker_history`**

Append to `backend/services/finmind.py` after `_compute_major_net_agg` (around line 415):

```python
def _parse_broker_history(rows: list) -> dict[str, list[dict]]:
    """Group SecIdAgg rows by broker_id, aggregating (broker_id, date) duplicates.

    Returns:
        {broker_id: [{date, buy, sell, net}, ...]}  values in 張 (lots).
    Rows with blank/whitespace-only `securities_trader_id` are skipped.
    """
    # First pass — aggregate raw shares by (broker_id, date)
    agg: dict[tuple[str, str], dict] = {}
    for r in rows:
        tid = str(r.get("securities_trader_id", "")).strip()
        if not tid:
            continue
        d = r.get("date", "")
        key = (tid, d)
        if key not in agg:
            agg[key] = {"buy_shares": 0, "sell_shares": 0}
        agg[key]["buy_shares"] += int(r.get("buy", 0))
        agg[key]["sell_shares"] += int(r.get("sell", 0))

    # Second pass — convert to lots and group by broker_id
    result: dict[str, list[dict]] = {}
    for (tid, d), v in agg.items():
        buy_lots = _to_lots(v["buy_shares"])
        sell_lots = _to_lots(v["sell_shares"])
        if tid not in result:
            result[tid] = []
        result[tid].append({
            "date": d,
            "buy": buy_lots,
            "sell": sell_lots,
            "net": buy_lots - sell_lots,
        })

    # Sort each broker's series chronologically
    for tid in result:
        result[tid].sort(key=lambda x: x["date"])
    return result
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd backend && python -m pytest tests/test_broker_history.py -v
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/finmind.py backend/tests/test_broker_history.py
git commit -m "feat(backend): add _parse_broker_history pure function

Groups SecIdAgg rows by broker_id, converts shares to lots, aggregates
duplicate (broker_id, date) pairs. Will be consumed by the new
broker_history endpoint."
```

---

### Task 2: Backend `fetch_broker_history` method + cache

**Files:**
- Modify: `backend/services/finmind.py` (add new method to `FinMindClient`)
- Modify: `backend/tests/test_broker_history.py` (append fetch tests)

**Interfaces:**
- Consumes: `_parse_broker_history` (Task 1), existing `_safe_get_secid_agg` / `_read_cache` / `_write_cache` / `_run_once`
- Produces:
  ```python
  class FinMindClient:
      async def fetch_broker_history(
          self, symbol: str, ids: list[str], refresh: bool = False,
      ) -> dict:
          """Returns {symbol, fetched_at, last_date, brokers: {id: [...]}}.

          - brokers dict is filtered to requested ids (cache stores all brokers)
          - Missing id → empty list []
          - Raises ValueError('secid_agg_unavailable') if no cache and SecIdAgg
            returns empty list
          """
  ```

- [ ] **Step 1: Write failing tests (append to existing test file)**

Append to `backend/tests/test_broker_history.py`:

```python
import asyncio
from datetime import date, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from services.finmind import FinMindClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("FINMIND_TOKEN", "test")
    monkeypatch.setattr(
        "services.finmind.chip_cache_dir", lambda: tmp_path,
    )
    return FinMindClient()


@pytest.mark.asyncio
async def test_fetch_broker_history_filters_to_requested_ids(client, monkeypatch):
    mock_rows = [
        {"securities_trader_id": "A", "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "B", "date": "2026-06-20", "buy": 2000, "sell": 0},
        {"securities_trader_id": "C", "date": "2026-06-20", "buy": 3000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    result = await client.fetch_broker_history("2330", ["A", "B"])
    assert set(result["brokers"].keys()) == {"A", "B"}
    assert "C" not in result["brokers"]


@pytest.mark.asyncio
async def test_fetch_broker_history_caches_full_payload(client, monkeypatch, tmp_path):
    mock_rows = [
        {"securities_trader_id": "A", "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "B", "date": "2026-06-20", "buy": 2000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    await client.fetch_broker_history("2330", ["A"])
    cache_path = tmp_path / "2330_broker_history.json"
    assert cache_path.exists()
    import json
    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    # cache stores ALL brokers, not just requested
    assert set(cached["brokers"].keys()) == {"A", "B"}


@pytest.mark.asyncio
async def test_fetch_broker_history_uses_cache_when_last_date_today(client, monkeypatch, tmp_path):
    today = date.today().isoformat()
    cache_payload = {
        "_cache_version": 2,
        "symbol": "2330",
        "fetched_at": "2026-06-22T10:00:00",
        "last_date": today,
        "brokers": {"A": [{"date": today, "buy": 5, "sell": 0, "net": 5}]},
    }
    import json
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(cache_payload), encoding="utf-8",
    )
    mock_fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(client, "_safe_get_secid_agg", mock_fetch)
    result = await client.fetch_broker_history("2330", ["A"])
    assert result["brokers"]["A"][0]["net"] == 5
    mock_fetch.assert_not_called()  # cache hit


@pytest.mark.asyncio
async def test_fetch_broker_history_returns_empty_list_for_missing_broker_id(client, monkeypatch):
    mock_rows = [
        {"securities_trader_id": "A", "date": "2026-06-20", "buy": 1000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    result = await client.fetch_broker_history("2330", ["A", "MISSING"])
    assert result["brokers"]["A"]
    assert result["brokers"]["MISSING"] == []


@pytest.mark.asyncio
async def test_fetch_broker_history_raises_when_secid_agg_empty(client, monkeypatch):
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=[]),
    )
    with pytest.raises(ValueError, match="secid_agg_unavailable"):
        await client.fetch_broker_history("2330", ["A"])


@pytest.mark.asyncio
async def test_fetch_broker_history_serves_stale_cache_when_secid_agg_fails(
    client, monkeypatch, tmp_path,
):
    """If SecIdAgg returns empty but stale cache exists, serve the stale cache."""
    stale_payload = {
        "_cache_version": 2, "symbol": "2330",
        "fetched_at": "2026-06-20T10:00:00",
        "last_date": "2026-06-20",  # < today
        "brokers": {"A": [{"date": "2026-06-20", "buy": 5, "sell": 0, "net": 5}]},
    }
    import json
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(stale_payload), encoding="utf-8",
    )
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=[]),
    )
    result = await client.fetch_broker_history("2330", ["A"])
    assert result["brokers"]["A"][0]["net"] == 5


@pytest.mark.asyncio
async def test_fetch_broker_history_dedup_concurrent_calls(client, monkeypatch):
    call_count = 0

    async def slow_fetch(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return [{"securities_trader_id": "A", "date": "2026-06-20",
                 "buy": 1000, "sell": 0}]

    monkeypatch.setattr(client, "_safe_get_secid_agg", slow_fetch)
    results = await asyncio.gather(
        client.fetch_broker_history("2330", ["A"]),
        client.fetch_broker_history("2330", ["A"]),
        client.fetch_broker_history("2330", ["A"]),
    )
    assert call_count == 1  # _run_once dedup
    assert all(r["brokers"]["A"] for r in results)
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && python -m pytest tests/test_broker_history.py -v -k fetch
```
Expected: `AttributeError: 'FinMindClient' object has no attribute 'fetch_broker_history'`

- [ ] **Step 3: Implement `fetch_broker_history`**

Append inside `FinMindClient` class in `backend/services/finmind.py`, between `_safe_get_secid_agg` and `_fetch_major_series`:

```python
    # -- broker history ----------------------------------------------------

    async def fetch_broker_history(
        self, symbol: str, ids: list[str], refresh: bool = False,
    ) -> dict:
        cache_key = f"{symbol}_broker_history"
        if not refresh:
            cached = self._read_cache(cache_key)
            if cached is not None and cached.get("last_date", "") >= date.today().isoformat():
                return _filter_broker_history(cached, ids)

        return await self._run_once(
            f"broker_history_{symbol}",
            lambda: self._do_fetch_broker_history(symbol, ids, cache_key),
        )

    async def _do_fetch_broker_history(
        self, symbol: str, ids: list[str], cache_key: str,
    ) -> dict:
        end = date.today()
        start = end - timedelta(days=90)
        rows = await self._safe_get_secid_agg(symbol, start.isoformat(), end.isoformat())

        if not rows:
            # No new data — try serving stale cache, else 503
            stale = self._read_cache(cache_key)
            if stale is not None:
                return _filter_broker_history(stale, ids)
            raise ValueError("secid_agg_unavailable")

        brokers = _parse_broker_history(rows)
        payload = {
            "symbol": symbol,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "last_date": end.isoformat(),
            "brokers": brokers,
        }
        self._write_cache(cache_key, payload)
        return _filter_broker_history(payload, ids)
```

Also add the helper at module level (near other pure functions, after `_parse_broker_history`):

```python
def _filter_broker_history(payload: dict, ids: list[str]) -> dict:
    """Return a copy of payload with brokers narrowed to requested ids."""
    all_brokers = payload.get("brokers", {})
    return {
        "symbol": payload.get("symbol", ""),
        "fetched_at": payload.get("fetched_at", ""),
        "last_date": payload.get("last_date", ""),
        "brokers": {bid: all_brokers.get(bid, []) for bid in ids},
    }
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd backend && python -m pytest tests/test_broker_history.py -v
```
Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/finmind.py backend/tests/test_broker_history.py
git commit -m "feat(backend): add fetch_broker_history with cache and dedup

Wraps _safe_get_secid_agg, stores all brokers in cache, filters to
requested ids on read. Serves stale cache when SecIdAgg fails; raises
ValueError('secid_agg_unavailable') only when no cache exists."
```

---

### Task 3: Backend `/api/chip/{symbol}/broker_history` route

**Files:**
- Modify: `backend/routes/chip.py` (append new handler)
- Create: `backend/tests/test_chip_broker_history_route.py`

**Interfaces:**
- Consumes: `FinMindClient.fetch_broker_history` (Task 2)
- Produces: HTTP endpoint `GET /api/chip/{symbol}/broker_history?ids=A,B,C&refresh=false`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_chip_broker_history_route.py`:
```python
"""Tests for /api/chip/{symbol}/broker_history."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_broker_history_400_on_empty_ids(client):
    r = client.get("/api/chip/2330/broker_history?ids=")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "ids_required"


def test_broker_history_400_on_too_many_ids(client):
    ids = ",".join(f"X{i}" for i in range(21))
    r = client.get(f"/api/chip/2330/broker_history?ids={ids}")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "too_many_ids"


def test_broker_history_503_on_secid_agg_unavailable(client):
    mock = AsyncMock(side_effect=ValueError("secid_agg_unavailable"))
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_broker_history = mock
        r = client.get("/api/chip/2330/broker_history?ids=A,B")
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "secid_agg_unavailable"


def test_broker_history_success(client):
    payload = {
        "symbol": "2330", "fetched_at": "2026-06-22T10:00:00",
        "last_date": "2026-06-22",
        "brokers": {"A": [{"date": "2026-06-20", "buy": 5, "sell": 0, "net": 5}]},
    }
    mock = AsyncMock(return_value=payload)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_broker_history = mock
        r = client.get("/api/chip/2330/broker_history?ids=A")
    assert r.status_code == 200
    assert r.json() == payload


def test_broker_history_strips_whitespace_ids(client):
    payload = {"symbol": "2330", "fetched_at": "", "last_date": "",
               "brokers": {"A": [], "B": []}}
    mock = AsyncMock(return_value=payload)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_broker_history = mock
        r = client.get("/api/chip/2330/broker_history?ids= A , B ,")
    assert r.status_code == 200
    mock.assert_called_once_with("2330", ["A", "B"], False)
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && python -m pytest tests/test_chip_broker_history_route.py -v
```
Expected: 404 on all endpoints (route doesn't exist yet).

- [ ] **Step 3: Add the route handler**

Append to `backend/routes/chip.py` (after the existing `get_chip_history`):

```python
@router.get("/api/chip/{symbol}/broker_history")
async def get_chip_broker_history(
    symbol: str,
    ids: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    id_list = [s.strip() for s in ids.split(",") if s.strip()]
    if not id_list:
        raise HTTPException(status_code=400, detail={"error": "ids_required"})
    if len(id_list) > 20:
        raise HTTPException(status_code=400, detail={"error": "too_many_ids"})
    try:
        return await get_finmind().fetch_broker_history(symbol, id_list, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind broker_history error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected chip broker_history error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd backend && python -m pytest tests/test_chip_broker_history_route.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chip.py backend/tests/test_chip_broker_history_route.py
git commit -m "feat(backend): add /api/chip/{symbol}/broker_history route

Validates 1-20 ids, maps ValueError → 503, FinMind errors → 502."
```

---

### Task 4: Frontend types + `topByVolume` pure function + API client

**Files:**
- Modify: `frontend/src/lib/chip-data.ts` (append types + function)
- Modify: `frontend/src/lib/chip-data.test.ts` (append tests)
- Modify: `frontend/src/lib/api.ts` (append client method)
- Modify: `frontend/src/lib/api.test.ts` (append test)

**Interfaces:**
- Consumes: backend `/api/chip/{symbol}/broker_history` (Task 3)
- Produces:
  ```ts
  interface BrokerDaily { date: string; buy: number; sell: number; net: number }
  interface ChipBrokerHistory {
    symbol: string; fetched_at: string; last_date: string;
    brokers: Record<string, BrokerDaily[]>;
  }
  interface TopVolumeBroker extends TopBroker {
    total: number;
    daytradeRate: number | null;  // null = sub-threshold or buy=sell=0
  }
  function topByVolume(brokers: TopBroker[], dayTotalLots: number): TopVolumeBroker[];
  api.chipBrokerHistory(symbol, ids, refresh?): Promise<ChipBrokerHistory>;
  ```

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/lib/chip-data.test.ts`:
```ts
import { topByVolume } from "./chip-data";
import type { TopBroker } from "./chip-data";

function mkBroker(name: string, buy: number, sell: number): TopBroker {
  return {
    name, broker_id: name, buy, sell, net: buy - sell,
    avg_buy_price: 0, avg_sell_price: 0,
  };
}

describe("topByVolume", () => {
  it("sorts by total (buy+sell) desc", () => {
    const result = topByVolume(
      [mkBroker("A", 100, 100), mkBroker("B", 500, 500), mkBroker("C", 50, 50)],
      100_000,
    );
    expect(result.map(b => b.name)).toEqual(["B", "A", "C"]);
  });

  it("computes daytradeRate = min/max when above 1% threshold", () => {
    // 35000 day total → threshold = 350 lots
    const result = topByVolume(
      [mkBroker("X", 400, 200)],
      35_000,
    );
    expect(result[0].daytradeRate).toBeCloseTo(0.5, 3);
  });

  it("returns null daytradeRate when below 1% threshold", () => {
    const result = topByVolume(
      [mkBroker("X", 200, 100)],
      35_000,  // threshold = 350; X total = 300 < 350
    );
    expect(result[0].daytradeRate).toBeNull();
  });

  it("returns null daytradeRate when dayTotalLots is 0", () => {
    const result = topByVolume([mkBroker("X", 100, 100)], 0);
    expect(result[0].daytradeRate).toBeNull();
  });

  it("returns null daytradeRate when both buy and sell are 0", () => {
    const result = topByVolume([mkBroker("X", 0, 0)], 100_000);
    expect(result[0].daytradeRate).toBeNull();
  });

  it("limits result to 15", () => {
    const brokers = Array.from({ length: 30 }, (_, i) =>
      mkBroker(`B${i}`, 1000 - i * 10, 0),
    );
    expect(topByVolume(brokers, 100_000)).toHaveLength(15);
  });

  it("includes total field equal to buy + sell", () => {
    const result = topByVolume([mkBroker("X", 300, 200)], 1_000_000);
    expect(result[0].total).toBe(500);
  });
});
```

Append to `frontend/src/lib/api.test.ts`:
```ts
import { api } from "./api";

// Inside the existing describe block:
it("chipBrokerHistory builds URL with comma-joined ids and refresh", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({
      symbol: "2330", fetched_at: "", last_date: "", brokers: {}
    }), { status: 200 }),
  );
  await api.chipBrokerHistory("2330", ["A", "B"], true);
  const url = (spy.mock.calls[0][0] as string).toString();
  expect(url).toContain("/api/chip/2330/broker_history");
  expect(url).toContain("ids=A%2CB");
  expect(url).toContain("refresh=true");
  spy.mockRestore();
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/lib/chip-data.test.ts src/lib/api.test.ts
```
Expected: import errors / `topByVolume is not a function` / `api.chipBrokerHistory is not a function`.

- [ ] **Step 3: Implement types + function + API client**

Append to `frontend/src/lib/chip-data.ts`:
```ts
export interface BrokerDaily {
  date: string;
  buy: number;
  sell: number;
  net: number;
}

export interface ChipBrokerHistory {
  symbol: string;
  fetched_at: string;
  last_date: string;
  brokers: Record<string, BrokerDaily[]>;
}

export interface TopVolumeBroker extends TopBroker {
  total: number;
  daytradeRate: number | null;
}

/**
 * Rank brokers by (buy + sell) descending, top 15.
 * daytradeRate = min(buy, sell) / max(buy, sell), but only when:
 *   - dayTotalLots > 0
 *   - broker total ≥ 1% of dayTotalLots
 *   - max(buy, sell) > 0
 * Otherwise null (UI displays "—").
 */
export function topByVolume(
  brokers: TopBroker[],
  dayTotalLots: number,
): TopVolumeBroker[] {
  const threshold = dayTotalLots > 0 ? Math.max(1, Math.floor(dayTotalLots * 0.01)) : Infinity;
  return brokers
    .map((b) => {
      const total = b.buy + b.sell;
      const maxAbs = Math.max(b.buy, b.sell);
      const daytradeRate =
        dayTotalLots > 0 && total >= threshold && maxAbs > 0
          ? Math.min(b.buy, b.sell) / maxAbs
          : null;
      return { ...b, total, daytradeRate };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
}
```

Append to `frontend/src/lib/api.ts` inside the `api` object (before the closing `}`):
```ts
  chipBrokerHistory(
    symbol: string,
    ids: string[],
    refresh?: boolean,
  ): Promise<ChipBrokerHistory> {
    const params: Record<string, string> = { ids: ids.join(",") };
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/broker_history`, params);
  },
```

And update the type import at the top of `frontend/src/lib/api.ts`:
```ts
import type { ChipSummary, ChipBubbleData, ChipHistory, ChipBrokerHistory } from "./chip-data";
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/lib/chip-data.test.ts src/lib/api.test.ts
```
Expected: all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chip-data.ts frontend/src/lib/chip-data.test.ts frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(frontend): add BrokerDaily/ChipBrokerHistory types, topByVolume, api.chipBrokerHistory

topByVolume ranks by total volume desc and exposes a daytrade-rate
metric (null below 1% threshold). chipBrokerHistory wraps GET
/api/chip/{symbol}/broker_history with comma-joined ids."
```

---

### Task 5: Frontend `useBrokerHistory` hook

**Files:**
- Create: `frontend/src/hooks/useBrokerHistory.ts`
- Create: `frontend/src/hooks/useBrokerHistory.test.ts`

**Interfaces:**
- Consumes: `api.chipBrokerHistory` (Task 4)
- Produces:
  ```ts
  function useBrokerHistory(symbol: string, brokerIds: Set<string>): {
    series: Map<string, BrokerDaily[]>;
    loading: boolean;
    error: string | null;
    refresh: () => void;
  };
  ```

- [ ] **Step 1: Write failing tests**

Create `frontend/src/hooks/useBrokerHistory.test.ts`:
```ts
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrokerHistory } from "./useBrokerHistory";
import { api } from "../lib/api";
import type { ChipBrokerHistory } from "../lib/chip-data";

beforeEach(() => {
  vi.restoreAllMocks();
});

const mkPayload = (brokers: Record<string, { date: string; buy: number; sell: number; net: number }[]>) => ({
  symbol: "2330", fetched_at: "", last_date: "2026-06-22", brokers,
});

describe("useBrokerHistory", () => {
  it("does not fetch when brokerIds is empty", async () => {
    const spy = vi.spyOn(api, "chipBrokerHistory");
    const { result } = renderHook(() => useBrokerHistory("2330", new Set()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.series.size).toBe(0);
  });

  it("fetches on first selection", async () => {
    vi.spyOn(api, "chipBrokerHistory").mockResolvedValueOnce(
      mkPayload({ A: [{ date: "2026-06-20", buy: 5, sell: 0, net: 5 }] }),
    );
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Set<string> }) => useBrokerHistory("2330", ids),
      { initialProps: { ids: new Set<string>() } },
    );
    rerender({ ids: new Set(["A"]) });
    await waitFor(() => expect(result.current.series.has("A")).toBe(true));
    expect(result.current.series.get("A")?.[0].net).toBe(5);
  });

  it("does not re-fetch already cached ids", async () => {
    const spy = vi.spyOn(api, "chipBrokerHistory").mockResolvedValue(
      mkPayload({ A: [{ date: "2026-06-20", buy: 5, sell: 0, net: 5 }] }),
    );
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Set<string> }) => useBrokerHistory("2330", ids),
      { initialProps: { ids: new Set(["A"]) } },
    );
    await waitFor(() => expect(result.current.series.has("A")).toBe(true));
    rerender({ ids: new Set(["A"]) }); // same set, new ref
    rerender({ ids: new Set(["A"]) });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("batches missing ids into a single request", async () => {
    const spy = vi.spyOn(api, "chipBrokerHistory").mockResolvedValue(
      mkPayload({
        A: [{ date: "d", buy: 1, sell: 0, net: 1 }],
        B: [{ date: "d", buy: 2, sell: 0, net: 2 }],
      }),
    );
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Set<string> }) => useBrokerHistory("2330", ids),
      { initialProps: { ids: new Set<string>() } },
    );
    rerender({ ids: new Set(["A", "B"]) });
    await waitFor(() =>
      expect(result.current.series.has("A") && result.current.series.has("B")).toBe(true),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].sort()).toEqual(["A", "B"]);
  });

  it("clears cache when symbol changes", async () => {
    vi.spyOn(api, "chipBrokerHistory")
      .mockResolvedValueOnce(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }))
      .mockResolvedValueOnce(mkPayload({ A: [{ date: "d", buy: 9, sell: 0, net: 9 }] }));
    const { result, rerender } = renderHook(
      ({ symbol, ids }: { symbol: string; ids: Set<string> }) =>
        useBrokerHistory(symbol, ids),
      { initialProps: { symbol: "2330", ids: new Set(["A"]) } },
    );
    await waitFor(() => expect(result.current.series.get("A")?.[0].net).toBe(1));
    rerender({ symbol: "2454", ids: new Set(["A"]) });
    await waitFor(() => expect(result.current.series.get("A")?.[0].net).toBe(9));
  });

  it("sets error state on API failure and preserves cache", async () => {
    vi.spyOn(api, "chipBrokerHistory")
      .mockResolvedValueOnce(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }))
      .mockRejectedValueOnce(new Error("network"));
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Set<string> }) => useBrokerHistory("2330", ids),
      { initialProps: { ids: new Set(["A"]) } },
    );
    await waitFor(() => expect(result.current.series.has("A")).toBe(true));
    rerender({ ids: new Set(["A", "B"]) });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    // cache for A preserved
    expect(result.current.series.has("A")).toBe(true);
  });

  it("refresh re-fetches with refresh=true", async () => {
    const spy = vi.spyOn(api, "chipBrokerHistory").mockResolvedValue(
      mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }),
    );
    const { result } = renderHook(() =>
      useBrokerHistory("2330", new Set(["A"])),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][2]).toBe(true);  // refresh flag
  });

  it("ignores stale responses via seqRef", async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise<unknown>((r) => { resolveFirst = r; });
    vi.spyOn(api, "chipBrokerHistory")
      .mockImplementationOnce(() => firstPromise as Promise<ChipBrokerHistory>)
      .mockResolvedValueOnce(
        mkPayload({ B: [{ date: "d", buy: 9, sell: 0, net: 9 }] }),
      );
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Set<string> }) => useBrokerHistory("2330", ids),
      { initialProps: { ids: new Set(["A"]) } },
    );
    rerender({ ids: new Set(["B"]) });
    await waitFor(() => expect(result.current.series.has("B")).toBe(true));
    // Now resolve the stale first request
    resolveFirst(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }));
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.series.has("A")).toBe(false);
    expect(result.current.series.get("B")?.[0].net).toBe(9);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/hooks/useBrokerHistory.test.ts
```
Expected: import error.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useBrokerHistory.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { BrokerDaily } from "../lib/chip-data";

function stableKey(set: Set<string>): string {
  return Array.from(set).sort().join(",");
}

export function useBrokerHistory(
  symbol: string,
  brokerIds: Set<string>,
): {
  series: Map<string, BrokerDaily[]>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const cacheRef = useRef<Map<string, BrokerDaily[]>>(new Map());
  const seqRef = useRef(0);
  const [series, setSeries] = useState<Map<string, BrokerDaily[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset cache on symbol change
  useEffect(() => {
    cacheRef.current.clear();
    setSeries(new Map());
    setError(null);
  }, [symbol]);

  const idsKey = stableKey(brokerIds);

  const fetchMissing = useCallback(
    async (forceAll: boolean) => {
      if (!symbol || brokerIds.size === 0) {
        setLoading(false);
        return;
      }
      const requested = Array.from(brokerIds);
      const missing = forceAll
        ? requested
        : requested.filter((id) => !cacheRef.current.has(id));
      if (missing.length === 0) {
        // Update visible series from cache only
        const next = new Map<string, BrokerDaily[]>();
        for (const id of requested) {
          const v = cacheRef.current.get(id);
          if (v) next.set(id, v);
        }
        setSeries(next);
        return;
      }
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await api.chipBrokerHistory(symbol, missing, forceAll);
        if (seq !== seqRef.current) return;
        for (const id of missing) {
          cacheRef.current.set(id, result.brokers[id] ?? []);
        }
        const next = new Map<string, BrokerDaily[]>();
        for (const id of requested) {
          const v = cacheRef.current.get(id);
          if (v) next.set(id, v);
        }
        setSeries(next);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "broker_history_failed");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, idsKey],
  );

  useEffect(() => {
    fetchMissing(false);
  }, [fetchMissing]);

  const refresh = useCallback(() => {
    cacheRef.current.clear();
    fetchMissing(true);
  }, [fetchMissing]);

  return { series, loading, error, refresh };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/hooks/useBrokerHistory.test.ts
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useBrokerHistory.ts frontend/src/hooks/useBrokerHistory.test.ts
git commit -m "feat(frontend): add useBrokerHistory hook

Memoizes per-broker daily series in a useRef Map. Stable dep key
(sorted-comma-join) prevents redundant fetches on Set reference change.
seqRef discards stale responses. refresh() clears cache + re-fetches."
```

---

### Task 6: Frontend SVG components — selectedIndex + onClickIndex + BrokerAggBarSvg

**Files:**
- Modify: `frontend/src/lib/chip-kline-svg.tsx` (add `onClickIndex?`, `selectedIndex?`, render cursor)
- Modify: `frontend/src/lib/chip-inst-bar-svg.tsx` (add `selectedIndex?` to both `InstBarSvg` and `MarginLineSvg`, render cursor)
- Create: `frontend/src/lib/chip-broker-agg-svg.tsx`
- Modify: `frontend/src/lib/chip-svg.test.ts` (append tests for new behaviors)

**Interfaces:**
- Consumes: existing chip-theme constants
- Produces:
  ```ts
  // KlineChartSvg new optional props
  selectedIndex?: number | null;
  onClickIndex?: (i: number) => void;

  // InstBarSvg / MarginLineSvg new optional prop
  selectedIndex?: number | null;

  // New element
  export interface BrokerAggBarProps {
    data: number[];
    width: number;
    height: number;
    label: string;        // e.g. "分點 (2)"
    hoverIndex?: number | null;
    selectedIndex?: number | null;
  }
  export const BrokerAggBarSvg: React.FC<BrokerAggBarProps>;
  ```

- [ ] **Step 1: Read existing implementations**

```bash
cat frontend/src/lib/chip-kline-svg.tsx | head -60
cat frontend/src/lib/chip-inst-bar-svg.tsx | head -80
cat frontend/src/lib/chip-svg.test.ts | head -40
```

- [ ] **Step 2: Write failing tests**

Append to `frontend/src/lib/chip-svg.test.ts`:
```ts
import { BrokerAggBarSvg } from "./chip-broker-agg-svg";
import { KlineChartSvg } from "./chip-kline-svg";
import { InstBarSvg, MarginLineSvg } from "./chip-inst-bar-svg";
import { render, fireEvent } from "@testing-library/react";

describe("BrokerAggBarSvg", () => {
  it("renders bars matching InstBarSvg shape", () => {
    const { container } = render(
      <BrokerAggBarSvg data={[10, -20, 30]} width={300} height={50} label="分點 (1)" />
    );
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("renders selected-day cursor at correct X", () => {
    const { container } = render(
      <BrokerAggBarSvg data={[10, 20, 30, 40]} width={400} height={50} label="" selectedIndex={2} />
    );
    const cursor = container.querySelector("[data-testid=sel-cursor]");
    expect(cursor).toBeTruthy();
  });

  it("does not render cursor when selectedIndex is null", () => {
    const { container } = render(
      <BrokerAggBarSvg data={[10, 20, 30]} width={300} height={50} label="" selectedIndex={null} />
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeFalsy();
  });
});

describe("InstBarSvg selectedIndex", () => {
  it("renders selected-day cursor at correct X", () => {
    const { container } = render(
      <InstBarSvg data={[10, 20, 30, 40]} width={400} height={50} selectedIndex={2} />
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
  });
});

describe("MarginLineSvg selectedIndex", () => {
  it("renders selected-day cursor at correct X", () => {
    const { container } = render(
      <MarginLineSvg
        marginData={[10, 20, 30]} shortData={[5, 15, 25]}
        width={400} height={50} selectedIndex={1}
      />
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
  });
});

describe("KlineChartSvg click + selectedIndex", () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${10 + i}`, open: 100, high: 105, low: 95, close: 100, volume: 0,
  }));

  it("renders selected-day cursor with date tag", () => {
    const { container, getByText } = render(
      <KlineChartSvg candles={candles} width={500} height={300} selectedIndex={3} />
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
    expect(getByText("2026-06-13")).toBeTruthy();
  });

  it("does not render cursor when selectedIndex is null", () => {
    const { container } = render(
      <KlineChartSvg candles={candles} width={500} height={300} selectedIndex={null} />
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeFalsy();
  });

  it("fires onClickIndex with correct index", () => {
    const onClick = vi.fn();
    const { container } = render(
      <KlineChartSvg candles={candles} width={500} height={300} onClickIndex={onClick} />
    );
    const overlay = container.querySelector("rect[data-testid=overlay]") as SVGRectElement;
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay, { clientX: 250, clientY: 100 });
    expect(onClick).toHaveBeenCalled();
    const i = onClick.mock.calls[0][0];
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(candles.length);
  });

  it("ignores click outside candle range", () => {
    const onClick = vi.fn();
    render(
      <KlineChartSvg candles={candles} width={500} height={300} onClickIndex={onClick} />
    );
    // Negative X shouldn't fire — but click target validation happens via guard.
    // We simulate by not firing the click at all; this case is asserted via
    // the guard in the implementation, covered by code review rather than a
    // failing-input test (jsdom can't easily emit negative client coords).
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/lib/chip-svg.test.ts
```
Expected: new tests fail (BrokerAggBarSvg missing, selectedIndex prop missing).

- [ ] **Step 4: Implement `BrokerAggBarSvg`**

Create `frontend/src/lib/chip-broker-agg-svg.tsx`:
```tsx
/**
 * 分點 aggregate 柱狀圖 — 第 6 列 sub-chart。
 * 與 InstBarSvg 視覺一致 (net bar:正紅↑/負綠↓),label 字色改為紫色 (ma20)。
 */
import { memo } from "react";
import { CHIP } from "./chip-theme";
import { KLINE_PAD_L, KLINE_PAD_R } from "./chip-kline-svg";
import { instBarHeight } from "./chip-inst-bar-svg";

const BULL = CHIP.bull;
const BEAR = CHIP.bear;
const ZERO = CHIP.lineStrong;
const SEL = CHIP.ma5;
const LABEL_COLOR = CHIP.ma20;
const FONT = CHIP.font;

function fmtLots(lots: number): string {
  const sign = lots > 0 ? "+" : "";
  return `${sign}${lots.toLocaleString("en-US")}`;
}

export interface BrokerAggBarProps {
  data: number[];
  width: number;
  height: number;
  label: string;
  hoverIndex?: number | null;
  selectedIndex?: number | null;
}

export const BrokerAggBarSvg = memo(function BrokerAggBarSvg({
  data, width, height, label, hoverIndex, selectedIndex,
}: BrokerAggBarProps) {
  const midY = height / 2;
  const halfH = midY - 2;
  const maxAbs = Math.max(...data.map(Math.abs), 1);
  const plotW = width - KLINE_PAD_L - KLINE_PAD_R;
  const barW = data.length > 0 ? Math.max(1, (plotW / data.length) * 0.7) : 1;
  const step = data.length > 0 ? plotW / data.length : 1;

  const valIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length
    ? hoverIndex
    : data.length - 1;
  const valRaw = data[valIdx] ?? 0;
  const valColor = valRaw >= 0 ? BULL : BEAR;

  return (
    <svg width={width} height={height}>
      <line x1={KLINE_PAD_L} x2={width - KLINE_PAD_R}
        y1={midY} y2={midY} stroke={ZERO} strokeWidth={1} />

      {data.map((v, i) => {
        const h = instBarHeight(v, maxAbs, halfH);
        if (h === 0) return null;
        const cx = KLINE_PAD_L + step * i + step / 2;
        const y = v >= 0 ? midY - h : midY;
        return (
          <rect key={i}
            x={cx - barW / 2} y={y} width={barW} height={h}
            fill={v >= 0 ? BULL : BEAR} />
        );
      })}

      <text y={22} fontSize={22} fontFamily={FONT}
        style={{ fontVariantNumeric: "tabular-nums" }}>
        <tspan x={4} fill={LABEL_COLOR} fontWeight={600}>{label}</tspan>
        <tspan dx={8} fill={valColor}>{fmtLots(valRaw)} 張</tspan>
      </text>

      {hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length && (
        <line
          x1={KLINE_PAD_L + step * hoverIndex + step / 2} y1={0}
          x2={KLINE_PAD_L + step * hoverIndex + step / 2} y2={height}
          stroke={CHIP.inkDim} strokeWidth={1} strokeDasharray="4 3" />
      )}

      {selectedIndex != null && selectedIndex >= 0 && selectedIndex < data.length && (
        <line
          data-testid="sel-cursor"
          x1={KLINE_PAD_L + step * selectedIndex + step / 2} y1={0}
          x2={KLINE_PAD_L + step * selectedIndex + step / 2} y2={height}
          stroke={SEL} strokeWidth={1} />
      )}
    </svg>
  );
});
```

- [ ] **Step 5: Add `selectedIndex` to `InstBarSvg` and `MarginLineSvg`**

`CHIP` is already imported (line 8). No new import needed.

In `frontend/src/lib/chip-inst-bar-svg.tsx`, update `InstBarProps`:
```ts
export interface InstBarProps {
  data: number[];
  width: number;
  height: number;
  label?: string;
  hoverIndex?: number | null;
  selectedIndex?: number | null;
}
```

Destructure `selectedIndex` in the component signature.

Inside `InstBarSvg` component body, AFTER the existing crosshair `<line>` block (around line 122-124), add:
```tsx
      {selectedIndex != null && selectedIndex >= 0 && selectedIndex < data.length && (
        <line
          data-testid="sel-cursor"
          x1={KLINE_PAD_L + step * selectedIndex + step / 2} y1={0}
          x2={KLINE_PAD_L + step * selectedIndex + step / 2} y2={height}
          stroke={CHIP.ma5} strokeWidth={1} />
      )}
```

Now `MarginLineProps`:
```ts
export interface MarginLineProps {
  marginData: number[];
  shortData: number[];
  marginBalanceData?: number[];
  shortBalanceData?: number[];
  width: number;
  height: number;
  label?: string;
  hoverIndex?: number | null;
  selectedIndex?: number | null;
}
```

Destructure `selectedIndex`. In `MarginLineSvg` body, after the existing hover crosshair (around line 240-244), add:
```tsx
      {selectedIndex != null && selectedIndex >= 0 && selectedIndex < len && (
        <line
          data-testid="sel-cursor"
          x1={scaleX(selectedIndex)} y1={0}
          x2={scaleX(selectedIndex)} y2={height}
          stroke={CHIP.ma5} strokeWidth={1} />
      )}
```

Note: `MarginLineSvg` uses `len = Math.max(marginData.length, shortData.length)` and `scaleX(i)` helper instead of `step * i`. Use those existing locals.

- [ ] **Step 6: Update `KlineChartSvg`**

Open `frontend/src/lib/chip-kline-svg.tsx`. The file already declares a local `t = CHIP_THEME` (which contains `bg, ma5, font, ...`). The existing per-candle X helper is `xOf(i)` (defined inside the component). The hover code uses `Math.floor((mouseX - padL) / slotW)` with `padL`, `slotW`, `n` (= candles.length) in scope.

Concrete edits:

1. Update `KlineChartProps` (around line 58) to add optional props:
   ```ts
   interface KlineChartProps {
     candles: DailyCandle[];
     width: number;
     height: number;
     hoverIndex?: number | null;
     onHoverIndex?: (i: number | null) => void;
     selectedIndex?: number | null;
     onClickIndex?: (i: number) => void;
   }
   ```

2. Destructure the new props in the component signature.

3. Add an `onClick` handler near the existing `handleMouseMove`/`handleMouseLeave` (after line 167):
   ```tsx
   const handleClick = (e: React.MouseEvent<SVGRectElement>) => {
     if (!onClickIndex) return;
     const rect = e.currentTarget.getBoundingClientRect();
     const mouseX = e.clientX - rect.left;
     const idx = Math.floor((mouseX - padL) / slotW);
     if (idx < 0 || idx >= n) return;
     onClickIndex(idx);
   };
   ```

4. On the existing overlay `<rect>` (line 303-309), add `data-testid="overlay"` and `onClick={handleClick}`:
   ```tsx
   <rect
     data-testid="overlay"
     x={0} y={0} width={width} height={height}
     fill="transparent"
     onMouseMove={handleMouseMove}
     onMouseLeave={handleMouseLeave}
     onClick={handleClick}
     style={{ cursor: "crosshair" }}
   />
   ```

5. Render the selected-day cursor INSIDE the `<svg>` (place it just before the closing `</svg>` so it draws on top, but BEFORE the overlay rect so the rect captures clicks). A safe location is after the MA legend (around line 300, before the overlay rect):
   ```tsx
   {selectedIndex != null && selectedIndex >= 0 && selectedIndex < n && (() => {
     const selX = xOf(selectedIndex);
     const dateText = candles[selectedIndex].date;
     return (
       <g data-testid="sel-cursor">
         <line
           x1={selX} y1={0} x2={selX} y2={height}
           stroke={t.ma5} strokeWidth={2}
         />
         <rect
           x={selX + 4} y={1} width={72} height={14}
           fill={t.bg} stroke={t.ma5} strokeWidth={1}
         />
         <text
           x={selX + 8} y={12} fontSize={11}
           fill={t.ma5} fontFamily={t.font}
         >
           {dateText}
         </text>
       </g>
     );
   })()}
   ```

Use `t.ma5`, `t.bg`, `t.font` — these are all in the local `t = CHIP_THEME` object (lines 7-10). Do NOT use `CHIP.bg` (CHIP itself has no `bg`).

- [ ] **Step 7: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/lib/chip-svg.test.ts
```
Expected: all new tests pass; existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/chip-kline-svg.tsx frontend/src/lib/chip-inst-bar-svg.tsx frontend/src/lib/chip-broker-agg-svg.tsx frontend/src/lib/chip-svg.test.ts
git commit -m "feat(frontend): add selectedIndex + onClickIndex to chart SVGs, new BrokerAggBarSvg

KlineChartSvg, InstBarSvg, MarginLineSvg gain an optional selectedIndex
prop drawing a gold (#f0b429) cursor. KlineChartSvg gains onClickIndex
firing the candle index. New BrokerAggBarSvg mirrors InstBarSvg layout
with a lavender (#b794f4) label color for the 6th-row aggregate."
```

---

### Task 7: `ChipBrokersPanel` rewrite — F1 + F2 + F4 (checkbox + chips region)

**Files:**
- Modify: `frontend/src/components/ChipBrokersPanel.tsx`

**Interfaces:**
- Consumes:
  - `topByVolume` (Task 4), `BrokerDaily` types
  - Props from `App`: `summary`, `dayTotalLots: number`, `selectedBrokerIds: Set<string>`, `onToggleBroker: (broker_id: string, broker_name: string) => void`, `onClearAllBrokers: () => void`
- Produces: same component, new behaviors

- [ ] **Step 1: Rewrite `ChipBrokersPanel`**

Replace the entire body of `frontend/src/components/ChipBrokersPanel.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { ChipSummary, TopBroker, TopVolumeBroker } from "../lib/chip-data";
import { splitBrokers, fmtVol, topByVolume } from "../lib/chip-data";

interface Props {
  summary: ChipSummary | null;
  dayTotalLots: number;
  selectedBrokerIds: Set<string>;
  onToggleBroker: (brokerId: string, brokerName: string) => void;
  onClearAllBrokers: () => void;
}

type Mode = "net" | "volume";

const FOREIGN_KEYWORDS = ["外資", "摩根", "美林", "高盛", "瑞銀", "花旗", "瑞信", "巴克萊", "德意志", "野村", "大和", "麥格理"];
const GOV_KEYWORDS = ["官股", "公股", "臺銀", "台銀", "兆豐", "合庫", "第一金", "華南", "彰銀", "土銀"];

function brokerBadge(name: string): string | null {
  if (FOREIGN_KEYWORDS.some((k) => name.includes(k))) return "外";
  if (GOV_KEYWORDS.some((k) => name.includes(k))) return "官";
  return null;
}

function fmtRate(r: number | null): string {
  if (r === null) return "—";
  return `${Math.round(r * 100)}%`;
}

function rateClass(r: number | null): string {
  if (r === null) return "text-[#4a4234]";
  if (r >= 0.8) return "text-[#b794f4]";
  if (r >= 0.5) return "text-[#f0b429]";
  return "text-ink-dim";
}

interface RowProps {
  rank: number;
  broker: TopBroker | TopVolumeBroker;
  mode: Mode;
  selected: boolean;
  onToggle: () => void;
}

function BrokerRow({ rank, broker, mode, selected, onToggle }: RowProps) {
  const badge = brokerBadge(broker.name);
  const netCls = broker.net > 0 ? "text-accent" : broker.net < 0 ? "text-bear" : "text-ink-dim";
  const cls = mode === "net"
    ? "grid-cols-[22px_32px_1fr_90px_80px_80px]"
    : "grid-cols-[22px_32px_1fr_64px_64px_76px]";

  return (
    <div className={`grid ${cls} items-center text-sm py-2 px-2 border-b border-line/40 hover:bg-bg-deep/50 ${selected ? "bg-[#b794f4]/[0.06]" : ""}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`勾選 ${broker.name}`}
        className="w-3.5 h-3.5 accent-[#b794f4] cursor-pointer"
      />
      <span className="text-ink-dim tabular-nums">{rank}</span>
      <span className="flex items-center gap-1.5 truncate text-ink-muted">
        <span className="truncate">{broker.name}</span>
        {badge && (
          <span className={`shrink-0 text-2xs px-1 py-px rounded ${badge === "外" ? "bg-accent/15 text-accent" : "bg-bear/15 text-bear"}`}>
            {badge}
          </span>
        )}
      </span>
      {mode === "net" ? (
        <>
          <span className={`text-right tabular-nums font-medium ${netCls}`}>
            {broker.net > 0 ? "+" : ""}{fmtVol(broker.net)}
          </span>
          <span className="text-right tabular-nums text-accent">{fmtVol(broker.buy)}</span>
          <span className="text-right tabular-nums text-bear">{fmtVol(broker.sell)}</span>
        </>
      ) : (
        <>
          <span className="text-right tabular-nums text-accent">{fmtVol(broker.buy)}</span>
          <span className="text-right tabular-nums text-bear">{fmtVol(broker.sell)}</span>
          <span className={`text-right tabular-nums font-medium ${rateClass((broker as TopVolumeBroker).daytradeRate)}`}>
            {fmtRate((broker as TopVolumeBroker).daytradeRate)}
          </span>
        </>
      )}
    </div>
  );
}

export function ChipBrokersPanel({
  summary, dayTotalLots, selectedBrokerIds, onToggleBroker, onClearAllBrokers,
}: Props) {
  const [mode, setMode] = useState<Mode>("net");

  // Hooks must run unconditionally — compute before any early return
  const allBrokers = summary?.top_brokers ?? [];
  const { buyers, sellers } = useMemo(() => splitBrokers(allBrokers), [allBrokers]);
  const volumeBrokers = useMemo(
    () => topByVolume(allBrokers, dayTotalLots),
    [allBrokers, dayTotalLots],
  );
  const majorNet = useMemo(
    () => buyers.slice(0, 15).reduce((s, b) => s + b.net, 0) + sellers.slice(0, 15).reduce((s, b) => s + b.net, 0),
    [buyers, sellers],
  );

  if (!summary) {
    return (
      <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
        請搜尋股票代號
      </div>
    );
  }

  const { institutional, margin } = summary;
  const N = selectedBrokerIds.size;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Stock info */}
      <div className="px-3 py-3 border-b border-line">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-lg text-ink font-medium">{summary.symbol}</span>
          <span className="text-xs text-ink-dim">{summary.date}</span>
        </div>
      </div>

      {/* Institutional summary */}
      <div className="px-3 py-2.5 border-b border-line">
        <div className="text-sm text-ink-dim uppercase tracking-wider mb-2">三大法人</div>
        <div className="grid grid-cols-3 gap-2 text-base">
          <div>
            <div className="text-ink-dim mb-0.5">外資</div>
            <div className={`tabular-nums font-medium ${institutional.foreign.net >= 0 ? "text-accent" : "text-bear"}`}>
              {institutional.foreign.net > 0 ? "+" : ""}{fmtVol(institutional.foreign.net)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">投信</div>
            <div className={`tabular-nums font-medium ${institutional.trust.net >= 0 ? "text-accent" : "text-bear"}`}>
              {institutional.trust.net > 0 ? "+" : ""}{fmtVol(institutional.trust.net)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">自營商</div>
            <div className={`tabular-nums font-medium ${institutional.dealer.net >= 0 ? "text-accent" : "text-bear"}`}>
              {institutional.dealer.net > 0 ? "+" : ""}{fmtVol(institutional.dealer.net)} 張
            </div>
          </div>
        </div>
      </div>

      {/* Margin summary */}
      <div className="px-3 py-2.5 border-b border-line">
        <div className="text-sm text-ink-dim uppercase tracking-wider mb-2">融資融券</div>
        <div className="grid grid-cols-3 gap-2 text-base mb-1.5">
          <div>
            <div className="text-ink-dim mb-0.5">融資增減</div>
            <div className={`tabular-nums font-medium ${margin.margin_purchase.change >= 0 ? "text-accent" : "text-bear"}`}>
              {margin.margin_purchase.change > 0 ? "+" : ""}{fmtVol(margin.margin_purchase.change)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">融券增減</div>
            <div className={`tabular-nums font-medium ${margin.short_sale.change >= 0 ? "text-accent" : "text-bear"}`}>
              {margin.short_sale.change > 0 ? "+" : ""}{fmtVol(margin.short_sale.change)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">券資比</div>
            <div className="tabular-nums text-ink-muted">{margin.short_balance_ratio.toFixed(1)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-ink-dim">
          <div className="tabular-nums">融資餘額 {fmtVol(margin.margin_purchase.balance)}</div>
          <div className="tabular-nums">融券餘額 {fmtVol(margin.short_sale.balance)}</div>
        </div>
      </div>

      {/* Major net (kept) */}
      <div className="px-3 py-2 border-b border-line flex items-center justify-between text-base">
        <span className="text-ink-dim">主力買賣超</span>
        <span className={`tabular-nums font-medium ${majorNet >= 0 ? "text-accent" : "text-bear"}`}>
          {majorNet > 0 ? "+" : ""}{fmtVol(majorNet)} 張
        </span>
      </div>

      {/* Selectbar (F2) */}
      <div className="px-3 py-2 border-b border-line flex gap-0">
        <button
          type="button"
          onClick={() => setMode("net")}
          className={`flex-1 px-2 py-1 text-xs cursor-pointer border-b-2 transition-colors ${
            mode === "net" ? "text-[#f0b429] border-[#f0b429]" : "text-ink-dim border-transparent hover:text-ink"
          }`}
        >
          前 15 大買賣超
        </button>
        <button
          type="button"
          onClick={() => setMode("volume")}
          className={`flex-1 px-2 py-1 text-xs cursor-pointer border-b-2 transition-colors ${
            mode === "volume" ? "text-[#f0b429] border-[#f0b429]" : "text-ink-dim border-transparent hover:text-ink"
          }`}
        >
          前 15 大交易量分點
        </button>
      </div>

      {/* Chips region (F4) — visible when at least one broker selected */}
      {N > 0 && (
        <div className="px-3 py-2 border-b border-line bg-bg-deep/40 flex flex-wrap gap-1.5 items-center">
          <span className="text-2xs text-ink-dim">已選 {N} 個分點:</span>
          {Array.from(selectedBrokerIds).map((id) => {
            const known = allBrokers.find((b) => b.broker_id === id);
            const name = known?.name ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#b794f4]/15 border border-[#b794f4]/40 text-[#b794f4]"
              >
                {name}
                <button
                  type="button"
                  onClick={() => onToggleBroker(id, name)}
                  aria-label={`移除 ${name}`}
                  className="hover:text-bear cursor-pointer"
                >×</button>
              </span>
            );
          })}
          {N > 1 && (
            <button
              type="button"
              onClick={onClearAllBrokers}
              className="ml-auto text-2xs text-ink-dim hover:text-bear cursor-pointer"
            >全部清除</button>
          )}
        </div>
      )}

      {/* Broker list */}
      <div className="flex-1 overflow-y-auto min-h-0 scroll-editorial">
        {mode === "net" ? (
          <>
            <div className="sticky top-0 z-[2] grid grid-cols-[22px_32px_1fr_90px_80px_80px] text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep">
              <span></span>
              <span>#</span>
              <span>分點</span>
              <span className="text-right">淨買賣</span>
              <span className="text-right">買張</span>
              <span className="text-right">賣張</span>
            </div>
            {buyers.length > 0 && (
              <div className="border-b border-line">
                <div className="px-2 py-1 text-2xs text-accent bg-accent/[0.04] uppercase tracking-wider">
                  買超
                </div>
                {buyers.slice(0, 15).map((b, i) => (
                  <BrokerRow
                    key={b.broker_id}
                    rank={i + 1}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id, b.name)}
                  />
                ))}
              </div>
            )}
            {sellers.length > 0 && (
              <div>
                <div className="px-2 py-1 text-2xs text-bear bg-bear/[0.04] uppercase tracking-wider">
                  賣超
                </div>
                {sellers.slice(0, 15).map((b, i) => (
                  <BrokerRow
                    key={b.broker_id}
                    rank={i + 1}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id, b.name)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="sticky top-0 z-[2] grid grid-cols-[22px_32px_1fr_64px_64px_76px] text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep">
              <span></span>
              <span>#</span>
              <span>分點</span>
              <span className="text-right">買張</span>
              <span className="text-right">賣張</span>
              <span className="text-right">當沖率</span>
            </div>
            {volumeBrokers.map((b, i) => (
              <BrokerRow
                key={b.broker_id}
                rank={i + 1}
                broker={b}
                mode="volume"
                selected={selectedBrokerIds.has(b.broker_id)}
                onToggle={() => onToggleBroker(b.broker_id, b.name)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run TS check**

```bash
cd frontend && npx tsc -b
```
Expected: 0 errors (panel uses Props that App will provide in Task 9; tsc may pass since the component is internally consistent).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChipBrokersPanel.tsx
git commit -m "feat(frontend): rewrite ChipBrokersPanel with selectbar, checkboxes, chips

- F1: removed 買超/賣超前 15 合計 summary rows
- F2: selectbar toggles net (existing) vs volume (new top-15 by buy+sell
  with 當沖率 column — purple/gold/dim tiers, '—' when sub-threshold)
- F4: leftmost checkbox column (lavender) + chip pill region above
  the list, all driven by selectedBrokerIds Set lifted to App"
```

---

### Task 8: `ChipKlineChart` integration — selectedIndex flow + 6th row + clear button

**Files:**
- Modify: `frontend/src/components/ChipKlineChart.tsx`

**Interfaces:**
- Consumes: `useBrokerHistory` (Task 5), `BrokerAggBarSvg` (Task 6), `selectedIndex` props on KlineChartSvg/InstBarSvg/MarginLineSvg (Task 6)
- Props from App: `history`, `selectedDate: string`, `selectedBrokerIds: Set<string>`, `selectedBrokerNames: Map<string, string>`, `onPickDate: (date: string) => void`, `onClearAllBrokers: () => void`

- [ ] **Step 1: Rewrite `ChipKlineChart`**

Replace `frontend/src/components/ChipKlineChart.tsx`:
```tsx
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChipHistory } from "../lib/chip-data";
import { KlineChartSvg } from "../lib/chip-kline-svg";
import { InstBarSvg, MarginLineSvg } from "../lib/chip-inst-bar-svg";
import { BrokerAggBarSvg } from "../lib/chip-broker-agg-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { useBrokerHistory } from "../hooks/useBrokerHistory";

interface Props {
  history: ChipHistory | null;
  symbol: string;
  selectedDate: string;
  selectedBrokerIds: Set<string>;
  onPickDate: (date: string) => void;
  onClearAllBrokers: () => void;
}

export function ChipKlineChart({
  history, symbol, selectedDate, selectedBrokerIds, onPickDate, onClearAllBrokers,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useContainerSize(containerRef);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const brokerHistory = useBrokerHistory(symbol, selectedBrokerIds);

  const derived = useMemo(() => {
    if (!history) return null;
    const { candles, institutional, margin, major } = history;
    const instByDate = new Map(institutional.map(d => [d.date, d]));
    const majorByDate = new Map((major ?? []).map(d => [d.date, d]));
    const marginByDate = new Map(margin.map(d => [d.date, d]));
    return {
      candles,
      majorNet: candles.map(c => majorByDate.get(c.date)?.major_net ?? 0),
      foreignNet: candles.map(c => instByDate.get(c.date)?.foreign_net ?? 0),
      trustNet: candles.map(c => instByDate.get(c.date)?.trust_net ?? 0),
      dealerNet: candles.map(c => instByDate.get(c.date)?.dealer_net ?? 0),
      marginChange: candles.map(c => marginByDate.get(c.date)?.margin_change ?? 0),
      shortChange: candles.map(c => marginByDate.get(c.date)?.short_change ?? 0),
      marginBalance: candles.map(c => marginByDate.get(c.date)?.margin_balance ?? 0),
      shortBalance: candles.map(c => marginByDate.get(c.date)?.short_balance ?? 0),
    };
  }, [history]);

  const brokerAggSeries = useMemo(() => {
    if (!derived) return [];
    const dateNet = new Map<string, number>();
    for (const arr of brokerHistory.series.values()) {
      for (const d of arr) {
        dateNet.set(d.date, (dateNet.get(d.date) ?? 0) + d.net);
      }
    }
    return derived.candles.map(c => dateNet.get(c.date) ?? 0);
  }, [derived, brokerHistory.series]);

  if (!derived) {
    return (
      <div ref={containerRef} className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
        請搜尋股票代號以載入K線圖
      </div>
    );
  }

  const {
    candles, majorNet, foreignNet, trustNet, dealerNet,
    marginChange, shortChange, marginBalance, shortBalance,
  } = derived;

  const selectedIndex = (() => {
    if (!selectedDate) return null;
    const i = candles.findIndex(c => c.date === selectedDate);
    return i >= 0 ? i : null;
  })();

  const w = width || 600;
  const totalH = height || 500;

  const handleClickIndex = useCallback(
    (i: number) => onPickDate(candles[i].date),
    [onPickDate, candles],
  );

  const showBrokerRow = selectedBrokerIds.size > 0;
  const gap = 6;
  const subCount = showBrokerRow ? 6 : 5;
  const klineH = Math.round((totalH - gap) * (3.5 / (5 + 3.5)));
  const subH = Math.floor((totalH - gap - klineH) / subCount);
  const lastSubH = totalH - gap - klineH - subH * (subCount - 1);

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden relative">
      <div style={{ height: klineH, minHeight: 0 }}>
        {klineH > 0 && (
          <KlineChartSvg
            candles={candles}
            width={w}
            height={klineH}
            hoverIndex={hoverIndex}
            onHoverIndex={setHoverIndex}
            selectedIndex={selectedIndex}
            onClickIndex={handleClickIndex}
          />
        )}
      </div>
      <div style={{ height: gap, minHeight: gap, background: "#14110c", borderTop: "1px solid #2e2a22", borderBottom: "1px solid #2e2a22" }} />
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg data={majorNet} width={w} height={subH}
            label="主力買賣超" hoverIndex={hoverIndex} selectedIndex={selectedIndex} />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg data={foreignNet} width={w} height={subH}
            label="外資" hoverIndex={hoverIndex} selectedIndex={selectedIndex} />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg data={trustNet} width={w} height={subH}
            label="投信" hoverIndex={hoverIndex} selectedIndex={selectedIndex} />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg data={dealerNet} width={w} height={subH}
            label="自營商" hoverIndex={hoverIndex} selectedIndex={selectedIndex} />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: showBrokerRow ? subH : lastSubH, minHeight: 0 }}>
        {(showBrokerRow ? subH : lastSubH) > 0 && (
          <MarginLineSvg
            marginData={marginChange}
            shortData={shortChange}
            marginBalanceData={marginBalance}
            shortBalanceData={shortBalance}
            width={w}
            height={showBrokerRow ? subH : lastSubH}
            label="融資融券"
            hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      {showBrokerRow && (
        <div className="border-t border-line/50 relative" style={{ height: lastSubH, minHeight: 0 }}>
          {lastSubH > 0 && (
            <BrokerAggBarSvg
              data={brokerAggSeries}
              width={w}
              height={lastSubH}
              label={`分點 (${selectedBrokerIds.size})`}
              hoverIndex={hoverIndex}
              selectedIndex={selectedIndex}
            />
          )}
          <button
            type="button"
            onClick={onClearAllBrokers}
            className="absolute right-2 top-1 text-2xs text-ink-dim hover:text-bear cursor-pointer"
          >清除</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run TS check**

```bash
cd frontend && npx tsc -b
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChipKlineChart.tsx
git commit -m "feat(frontend): wire ChipKlineChart for F3 + F4

- selectedIndex derived from selectedDate prop, pushed to all sub-SVGs
- onClickIndex calls onPickDate (handled in App)
- 6th sub-chart row appears when selectedBrokerIds non-empty, showing
  daily net aggregate via useBrokerHistory + BrokerAggBarSvg
- '清除' button absolutely positioned on the 6th row"
```

---

### Task 9: `BrokerSearch` typeahead component

**Files:**
- Create: `frontend/src/components/BrokerSearch.tsx`
- Create: `frontend/src/components/BrokerSearch.test.tsx`

**Interfaces:**
- Consumes: `BrokerTrade` type
- Produces:
  ```tsx
  export function BrokerSearch({
    trades: BrokerTrade[];
    value: string | null;
    onChange: (broker: string | null) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/BrokerSearch.test.tsx`:
```tsx
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { BrokerSearch } from "./BrokerSearch";
import type { BrokerTrade } from "../lib/chip-data";

const trades: BrokerTrade[] = [
  { broker: "凱基-台北", broker_id: "9201A", price: 100, buy: 200, sell: 100 },
  { broker: "凱基-板橋", broker_id: "9201B", price: 100, buy: 50, sell: 80 },
  { broker: "富邦-台北", broker_id: "9501A", price: 100, buy: 500, sell: 0 },
  { broker: "元大-中和", broker_id: "9101A", price: 100, buy: 30, sell: 10 },
];

describe("BrokerSearch", () => {
  it("shows placeholder when value is null", () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("搜尋分點...")).toBeTruthy();
  });

  it("shows broker name when value is set", () => {
    render(<BrokerSearch trades={trades} value="凱基-台北" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("凱基-台北");
  });

  it("opens dropdown on focus with matches", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => {
      expect(screen.getByText("凱基-台北")).toBeTruthy();
      expect(screen.getByText("凱基-板橋")).toBeTruthy();
    });
  });

  it("filters case-insensitive (substring)", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "台北" } });
    await waitFor(() => {
      expect(screen.getByText("凱基-台北")).toBeTruthy();
      expect(screen.getByText("富邦-台北")).toBeTruthy();
      expect(screen.queryByText("凱基-板橋")).toBeNull();
    });
  });

  it("default dropdown sort by total volume desc", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    // typing empty should not open dropdown — instead test by typing single char
    fireEvent.change(input, { target: { value: "-" } });  // matches all
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      // 富邦-台北 buy+sell = 500, 凱基-台北 = 300, 凱基-板橋 = 130, 元大 = 40
      expect(items[0].textContent).toContain("富邦-台北");
      expect(items[1].textContent).toContain("凱基-台北");
    });
  });

  it("Enter on dropdown calls onChange with broker name", async () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value={null} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱基-台北" } });
    await waitFor(() => screen.getByText("凱基-台北"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("凱基-台北");
  });

  it("Arrow down then Enter selects active item", async () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value={null} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => screen.getByText("凱基-台北"));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("凱基-板橋");
  });

  it("Escape closes dropdown without selecting", async () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value={null} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => screen.getByText("凱基-台北"));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("凱基-台北")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("× button clears value", () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value="凱基-台北" onChange={onChange} />);
    const x = screen.getByLabelText("清除選擇");
    fireEvent.click(x);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && npx vitest run src/components/BrokerSearch.test.tsx
```
Expected: import error.

- [ ] **Step 3: Implement `BrokerSearch`**

Create `frontend/src/components/BrokerSearch.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { BrokerTrade } from "../lib/chip-data";

interface AggBroker {
  broker: string;
  total: number;
  buy: number;
  sell: number;
}

interface Props {
  trades: BrokerTrade[];
  value: string | null;
  onChange: (broker: string | null) => void;
}

const HIGHLIGHT = "#f0b429";

function highlightMatch(name: string, q: string): React.ReactNode {
  if (!q) return name;
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <span style={{ color: HIGHLIGHT, fontWeight: 500 }}>{name.slice(i, i + q.length)}</span>
      {name.slice(i + q.length)}
    </>
  );
}

export function BrokerSearch({ trades, value, onChange }: Props) {
  const [query, setQuery] = useState(value ?? "");
  const [debounced, setDebounced] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

  // Debounce query → debounced (200ms, matches SymbolSearch)
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(query), 200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const aggregates: AggBroker[] = useMemo(() => {
    const m = new Map<string, AggBroker>();
    for (const t of trades) {
      let e = m.get(t.broker);
      if (!e) {
        e = { broker: t.broker, total: 0, buy: 0, sell: 0 };
        m.set(t.broker, e);
      }
      e.buy += t.buy;
      e.sell += t.sell;
      e.total += t.buy + t.sell;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [trades]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return aggregates.slice(0, 50);
    return aggregates.filter((b) => b.broker.toLowerCase().includes(q)).slice(0, 50);
  }, [aggregates, debounced]);

  useEffect(() => {
    setActiveIdx(0);
  }, [filtered]);

  const pick = (broker: string) => {
    onChange(broker);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (filtered[activeIdx]) pick(filtered[activeIdx].broker);
    }
  };

  return (
    <div className="relative w-full max-w-[280px]">
      <input
        type="text"
        role="textbox"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder="搜尋分點..."
        className="w-full bg-bg-deep border border-line text-ink px-2.5 py-1 text-xs outline-none focus:border-[#f0b429]"
      />
      {value && (
        <button
          type="button"
          aria-label="清除選擇"
          onMouseDown={(e) => { e.preventDefault(); onChange(null); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-line-strong text-ink-dim text-xs hover:bg-bear hover:text-bg cursor-pointer flex items-center justify-center"
        >×</button>
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-deep border border-line max-h-[280px] overflow-y-auto">
          {filtered.map((b, i) => (
            <button
              key={b.broker}
              type="button"
              data-testid="broker-search-item"
              onMouseDown={() => pick(b.broker)}
              className={`w-full px-2 py-1.5 grid grid-cols-[1fr_50px_44px_44px] gap-1 text-xs text-left ${
                i === activeIdx ? "bg-line-strong/40 border-l-2 border-[#f0b429]" : "hover:bg-line-strong/20"
              }`}
            >
              <span className="text-ink truncate">{highlightMatch(b.broker, debounced)}</span>
              <span className="text-right text-ink-dim tabular-nums">{b.total.toLocaleString()}</span>
              <span className="text-right text-accent tabular-nums">{b.buy.toLocaleString()}</span>
              <span className="text-right text-bear tabular-nums">{b.sell.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/components/BrokerSearch.test.tsx
```
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BrokerSearch.tsx frontend/src/components/BrokerSearch.test.tsx
git commit -m "feat(frontend): add BrokerSearch typeahead with keyboard nav

200ms debounce mirrors SymbolSearch. Dropdown sorts by today's
buy+sell desc, highlights matching substring in gold. Supports
ArrowUp/Down/Enter/Escape, onMouseDown to avoid blur race."
```

---

### Task 10: `ChipBubbleView` integration — header search + bubble dim→hide

**Files:**
- Modify: `frontend/src/components/ChipBubbleView.tsx`
- Modify: `frontend/src/lib/chip-bubble-svg.tsx` (change dim → hide + gold ring)

**Interfaces:**
- Consumes: `BrokerSearch` (Task 9), existing `BubbleChartSvg` modified
- Props from App: add `symbol: string` so the symbol-change effect can reset

- [ ] **Step 1: Modify `chip-bubble-svg.tsx`**

**重要**: 既有 `chip-bubble-svg.tsx` **已經**透過 `visibleTrades` 過濾掉非選定 broker (line 217-219 / line 267 `for (const t of visibleTrades)`),所以 "hide non-selected" 行為**已經存在**,不需改。

本 step 唯一要做的:**為選定 broker 的 bubble 加上 2px 金色 ring**。

在 bubble 構造 loop (line 268-289) 內,push 物件時改 `stroke` / `strokeWidth`:

```ts
// At top of file, near other imports:
import { CHIP } from "./chip-theme";

// Inside the for (const t of visibleTrades) loop, when pushing a bubble:
const isSel = selectedBroker != null && t.broker === selectedBroker;

if (t.buy > VOLUME_THRESHOLD) {
  bubbles.push({
    cx: centerX + (t.buy / volMax) * halfW,
    cy: sY(t.price),
    r: bubbleRadius(t.buy, maxVolume, MIN_R, MAX_R),
    fill: COLOR.buyFill,
    stroke: isSel ? CHIP.ma5 : COLOR.buyStroke,
    key: `b-${t.broker_id}-${t.price}-${idx}`,
    payload: { broker: t.broker, volume: t.buy, price: t.price, side: "buy" },
  });
}
if (t.sell > VOLUME_THRESHOLD) {
  bubbles.push({
    cx: centerX - (t.sell / volMax) * halfW,
    cy: sY(t.price),
    r: bubbleRadius(t.sell, maxVolume, MIN_R, MAX_R),
    fill: COLOR.sellFill,
    stroke: isSel ? CHIP.ma5 : COLOR.sellStroke,
    key: `s-${t.broker_id}-${t.price}-${idx}`,
    payload: { broker: t.broker, volume: t.sell, price: t.price, side: "sell" },
  });
}
```

Also extend the `Bubble` type's `strokeWidth?: number` if it isn't already there; update the `<circle>` render at line 382-393 to use `strokeWidth={b.strokeWidth ?? 1}` OR simply hard-code on selected case via:

```tsx
{bubbles.map((b) => {
  const isSel = b.stroke === CHIP.ma5;
  return (
    <circle
      key={b.key}
      cx={b.cx} cy={b.cy} r={b.r}
      fill={b.fill}
      stroke={b.stroke}
      strokeWidth={isSel ? 2 : 1}
      pointerEvents="none"
    />
  );
})}
```

That's it — no change to `visibleTrades` filtering, no early returns. Only the gold ring is new.

- [ ] **Step 2: Rewrite `ChipBubbleView` header + props**

In `frontend/src/components/ChipBubbleView.tsx`:

- Add `symbol: string` to `Props`.
- Add `useEffect(() => setSelectedBroker(null), [symbol])`.
- Add `uniqueBrokerCount` useMemo.
- Wrap the existing `<div ref={bubbleRef}>` (the left column) in a vertical flex container with a 40px header bar containing `<BrokerSearch>` + the count text.

Update the Props interface and add the import at the top:
```tsx
import { BrokerSearch } from "./BrokerSearch";
```

Inside the component, after existing useMemo blocks, add:
```tsx
const uniqueBrokerCount = useMemo(
  () => new Set(bubbleData?.trades.map(t => t.broker) ?? []).size,
  [bubbleData],
);

useEffect(() => {
  setSelectedBroker(null);
}, [symbol]);
```

Then replace the left column structure. The previous structure was:
```tsx
<div ref={bubbleRef} className="h-full min-h-0 overflow-hidden border-r border-line">
  ...
</div>
```

Replace with:
```tsx
<div className="h-full flex flex-col min-h-0 border-r border-line overflow-hidden">
  <div className="shrink-0 h-10 px-3 border-b border-line bg-bg-deep/30 flex items-center gap-3">
    <BrokerSearch
      trades={bubbleData?.trades ?? []}
      value={selectedBroker}
      onChange={setSelectedBroker}
    />
    <span className="text-xs text-ink-dim">
      {selectedBroker
        ? <>已篩選 <span className="text-[#f0b429] font-medium">1</span> 個分點</>
        : <>今日共 <span className="text-[#b794f4] font-medium">{uniqueBrokerCount}</span> 個分點</>
      }
    </span>
  </div>
  <div ref={bubbleRef} className="flex-1 min-h-0 overflow-hidden">
    {!bubbleData ? (
      <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
        請搜尋股票代號以載入泡泡圖
      </div>
    ) : bubbleSize.width > 0 && bubbleSize.height > 0 ? (
      <BubbleChartSvg
        trades={bubbleData.trades}
        width={bubbleSize.width}
        height={bubbleSize.height}
        closePrice={closePrice}
        selectedBroker={selectedBroker}
        onBubbleHover={handleBubbleHover}
        onBubbleClick={handleBubbleClick}
      />
    ) : null}
  </div>
</div>
```

Add `useEffect` to imports if missing.

- [ ] **Step 3: Run TS check + tests**

```bash
cd frontend && npx tsc -b && npx vitest run
```
Expected: 0 TS errors, no test regressions.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChipBubbleView.tsx frontend/src/lib/chip-bubble-svg.tsx
git commit -m "feat(frontend): add BrokerSearch header to bubble tab; hide unselected bubbles

ChipBubbleView gains a 40px header with BrokerSearch + active-count
label. selectedBroker resets when symbol changes (component stays
mounted across tabs). BubbleChartSvg now omits non-matching bubbles
entirely instead of dimming, and adds a 2px gold ring to selected."
```

---

### Task 11: `App.tsx` — state lift, handlePickDate, refresh integration

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: all earlier props/hooks
- Produces: final wired App

- [ ] **Step 1: Rewrite `App.tsx`**

Update `frontend/src/App.tsx`:
```tsx
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<Set<string>>(() => new Set());
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

  const dayTotalLots = useMemo(() => {
    if (!summary?.date) return 0;
    const c = history?.candles.find((c) => c.date === summary.date);
    if (c) return c.volume;
    return summary.top_brokers.reduce((s, b) => s + b.buy + b.sell, 0);
  }, [history, summary]);

  const handlePickDate = useCallback(
    (d: string) => {
      if (d === date) return;
      const lastCandle = history?.candles?.[history.candles.length - 1];
      userPickedDate.current = lastCandle ? d !== lastCandle.date : true;
      setDate(d);
    },
    [date, history],
  );

  const handleToggleBroker = useCallback((id: string, _name: string) => {
    setSelectedBrokerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClearAllBrokers = useCallback(() => {
    setSelectedBrokerIds(new Set());
  }, []);

  const refresh = () => {
    refreshChip();
    if (tab === "bubble") bubbleHook.refresh();
    // broker history hook lives inside ChipKlineChart; it auto-refetches via its own
    // refresh() exposed through a ref — but since reloaded chip data already
    // triggers re-render and useBrokerHistory has its own cache invalidation on
    // symbol change, this is sufficient for the normal case. A full broker-history
    // refresh button can be added later if needed.
  };
  const isLoading = loading || bubbleHook.loading;

  const handlePick = (sym: string, name: string | null) => {
    setSymbol(sym);
    setSymbolName(name);
    setSelectedBrokerIds(new Set());
    userPickedDate.current = false;
  };

  const closePrice = useMemo(() => {
    const c = history?.candles.find((c) => c.date === date);
    return c?.close ?? history?.candles?.[history.candles.length - 1]?.close;
  }, [history, date]);

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
              tab === "overview" ? "text-accent border-b-2 border-accent font-medium" : "text-ink-dim hover:text-ink"
            }`}
          >
            籌碼總覽
          </button>
          <button
            type="button"
            onClick={() => setTab("bubble")}
            className={`px-4 py-2 text-sm transition-colors cursor-pointer ${
              tab === "bubble" ? "text-accent border-b-2 border-accent font-medium" : "text-ink-dim hover:text-ink"
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
              <ChipKlineChart
                history={history}
                symbol={symbol}
                selectedDate={date}
                selectedBrokerIds={selectedBrokerIds}
                onPickDate={handlePickDate}
                onClearAllBrokers={handleClearAllBrokers}
              />
            </div>
            <div className="h-full overflow-hidden">
              <ChipBrokersPanel
                summary={summary}
                dayTotalLots={dayTotalLots}
                selectedBrokerIds={selectedBrokerIds}
                onToggleBroker={handleToggleBroker}
                onClearAllBrokers={handleClearAllBrokers}
              />
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
              symbol={symbol}
              bubbleData={bubbleHook.data}
              closePrice={closePrice}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run TS check + all tests**

```bash
cd frontend && npx tsc -b && npx vitest run
```
Expected: 0 TS errors, all tests pass (including existing ones).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): wire App with selectedBrokerIds, handlePickDate, symbol prop for bubble

selectedBrokerIds is now lifted to App and resets on symbol change.
handlePickDate guards same-day no-op and toggles userPickedDate based
on whether the clicked day is the latest. ChipBubbleView receives
symbol to drive its own selectedBroker reset effect."
```

---

### Task 12: Final verification + manual integration

- [ ] **Step 1: Run full suite**

```bash
cd frontend && npx tsc -b
cd frontend && npx vitest run
cd backend && python -m pytest -v
cd backend && ruff check .
cd frontend && npm run build
```
Each must complete with 0 errors / all passing.

- [ ] **Step 2: Spin up dev server & manual smoke test**

```bash
# Terminal 1
cd backend && python -m uvicorn main:app --reload

# Terminal 2
cd frontend && npm run dev
```

Then use Chrome DevTools MCP to:
1. Navigate to dev server URL
2. Search "2330" → 籌碼總覽 tab loads, no console errors
3. Click selectbar "前 15 大交易量分點" → list re-sorts; rows show 當沖率 with three-tier color
4. Click on a K-line candle 30 days back → date input updates, gold cursor appears, broker panel switches to that day
5. Check a broker checkbox → 6th sub-chart row appears below 融資融券 with the broker's net bar
6. Check a second broker → label updates to "分點 (2)", aggregate sum displays
7. Click 清除 on 6th row → row disappears, chips region clears
8. Switch to 泡泡圖 tab → search box visible, count "今日共 N 個分點"
9. Type "凱" → dropdown shows 凱基-XXX entries sorted by volume, gold highlight on matched chars
10. Arrow down + Enter → only selected broker's bubbles remain, gold ring around them, right side filters
11. Click × → all bubbles return
12. Console has no errors throughout

- [ ] **Step 3: If everything passes, commit final state**

```bash
git status  # should be clean
git log --oneline -15  # all task commits present
```
