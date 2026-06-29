# Implementation: Backend Routes

Covers: `routes/market.py`(新增)+ `main.py`(modify,register router)+ `tests/test_market_routes.py`(新增)。

Design source:`../design.md` v3 §4 (endpoint contract)、§5 (錯誤路徑)、§9。

---

## File 1:`backend/routes/market.py`(新增)

### Module
```python
"""Market dashboard API routes.

Single endpoint:
- GET /api/market/snapshot — 整盤 + sectors + leaderboards 派生

Error contract(對齊 routes/options.py 慣例):
- 502 detail={"error": "finmind_unreachable"} — services raise ValueError
- 503 detail={"error": "snapshot_unavailable"} — service 尚未 ready

design.md §4 §9
"""
from __future__ import annotations

import logging
import httpx
from fastapi import APIRouter, HTTPException, Query

from services.finmind_realtime import fetch_market_snapshot

logger = logging.getLogger(__name__)

router = APIRouter()
```

### Route
```python
@router.get("/snapshot")
async def get_market_snapshot(
    refresh: bool = Query(default=False),
) -> dict:
    """Return market snapshot (sectors + leaderboards).

    See design.md §4 for payload shape + size budget.
    """
    try:
        return await fetch_market_snapshot(refresh=refresh)
    except ValueError as exc:
        # service raise ValueError 代表 upstream 全掛無 cache 兜底
        msg = str(exc)
        if msg == "finmind_unreachable":
            raise HTTPException(
                status_code=502,
                detail={"error": "finmind_unreachable"},
            ) from exc
        logger.exception("market snapshot service raised unexpected ValueError")
        raise HTTPException(
            status_code=503,
            detail={"error": "snapshot_unavailable"},
        ) from exc
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        # 兜底 — service 內若漏 catch
        logger.exception("market snapshot upstream http error")
        raise HTTPException(
            status_code=502,
            detail={"error": "finmind_unreachable"},
        ) from exc
```

### Notes
- Route 不做業務邏輯,僅 dispatch + error mapping
- 對齊 CLAUDE.md §2:catch specific httpx exceptions + `logger.exception` + 轉 502
- 不接受 `?date=YYYY-MM-DD` query(live-only,對齊 initial-design.md §1 約定)
- Future:若加篩選器 / 監控 / 排行榜獨立 endpoint,擴 router 不擴 service

---

## File 2:`backend/main.py`(modify)

### Diff
找到 router 註冊區塊(對齊既有 options router 註冊位置),加一行:
```python
from routes import chip, market, options, symbols  # alphabetic
...
app.include_router(market.router, prefix="/api/market")  # NEW
```

不動 global exception handler / CORS / gzip。

### Verification
```bash
python -c "from main import app; print([r.path for r in app.routes if 'market' in r.path])"
# 應該印 ['/api/market/snapshot']
```

---

## File 3:`backend/tests/test_market_routes.py`(新增)

### Test signatures

```python
"""SC-1 + SC-3 — Market routes integration.

Uses conftest fixtures _reset_finmind_singleton_and_env automatically.
Mocks fetch_market_snapshot via unittest.mock.patch (對齊 test_options_routes.py)。
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


# --- happy path ---

def test_snapshot_happy_path_returns_200_and_shape() -> None:
    """SC-1: mock service 回完整 shape → 200 + sectors + leaderboards。"""
    svc_return = {
        "as_of": "2026-06-29T10:30:00+08:00",
        "last_tick": "2026-06-29T10:29:50",
        "is_trading_session": True,
        "stale": False,
        "lag_seconds": 10,
        "sectors": [
            {"id": "半導體業", "name": "半導體業", "member_count": 2,
             "avg_change_rate": 0.5, "total_amount": 100_000_000,
             "stocks": [{"stock_id": "2330", "name": "台積電",
                         "change_rate": 1.0, "total_amount": 100_000_000,
                         "market_value": 60_000_000_000_000}]},
        ],
        "leaderboards": {
            "gainers": [], "losers": [], "amount": [], "volume_ratio": [],
        },
    }
    with patch("routes.market.fetch_market_snapshot",
               new=AsyncMock(return_value=svc_return)):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert "sectors" in body
    assert "leaderboards" in body
    assert body["is_trading_session"] is True


def test_snapshot_refresh_param_passed_to_service() -> None:
    """SC-5: refresh=true → service 被 await 帶 refresh=True。"""
    mock_svc = AsyncMock(return_value={
        "as_of": "...", "last_tick": None, "is_trading_session": False,
        "stale": False, "lag_seconds": None,
        "sectors": [], "leaderboards": {"gainers": [], "losers": [],
                                          "amount": [], "volume_ratio": []},
    })
    with patch("routes.market.fetch_market_snapshot", new=mock_svc):
        TestClient(app).get("/api/market/snapshot?refresh=true")
    mock_svc.assert_awaited_once_with(refresh=True)


# --- error path (E7 FinMind 失敗) ---

def test_snapshot_returns_502_when_service_raises_finmind_unreachable() -> None:
    """E7 / SC-1: service raise ValueError('finmind_unreachable') → 502 +
    detail.error。"""
    with patch("routes.market.fetch_market_snapshot",
               new=AsyncMock(side_effect=ValueError("finmind_unreachable"))):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_unreachable"


def test_snapshot_returns_503_on_unexpected_value_error() -> None:
    """SC-1: service raise ValueError(別的) → 503。"""
    with patch("routes.market.fetch_market_snapshot",
               new=AsyncMock(side_effect=ValueError("some_other_error"))):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 503
    assert resp.json()["detail"]["error"] == "snapshot_unavailable"


def test_snapshot_returns_502_on_httpx_timeout() -> None:
    """E3: service 內漏 catch → 路由 catch httpx 例外 → 502。"""
    import httpx
    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(side_effect=httpx.TimeoutException("up")),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_unreachable"


# --- stale fallback path ---

def test_snapshot_stale_fallback_returns_200_with_flag() -> None:
    """E7: service 成功 return stale=True payload(disk cache 兜底)→ 200 +
    stale=true,不應 5xx。"""
    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(return_value={
            "as_of": "...", "last_tick": "2026-06-29T10:00:00",
            "is_trading_session": False, "stale": True,
            "lag_seconds": 1800,
            "sectors": [], "leaderboards": {"gainers": [], "losers": [],
                                              "amount": [], "volume_ratio": []},
        }),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 200
    assert resp.json()["stale"] is True


# --- v3 F10 — payload size measurement gate ---

def test_payload_size_under_budget() -> None:
    """SC-1 budget assert: 28 sectors × 30 stocks fixture → encoded json
    size < 50,000 bytes(SC-1 hard requirement)。
    
    Fixture 故意拉滿 cap 上限(28 × 30 = 840 個 stocks + 4 個 leaderboard
    各 30 row)模擬最壞情況。
    """
    sectors = [
        {
            "id": f"sector_{i:02d}",
            "name": f"產業類別 {i:02d}",
            "member_count": 30,
            "avg_change_rate": 0.5,
            "total_amount": 1_000_000_000,
            "stocks": [
                {
                    "stock_id": f"{1000+i*30+j}",
                    "name": f"中文名稱 {i}-{j}",   # 中文 UTF-8 3 B/char
                    "change_rate": 1.92,
                    "total_amount": 35_923_705_000,
                    "market_value": 60_681_745_956_780,
                }
                for j in range(30)
            ],
        }
        for i in range(28)
    ]
    leaderboards = {
        key: [
            {
                "stock_id": f"{2000+k:04d}",
                "name": "中文名稱",
                "change_rate": 5.5,
                "total_amount": 1_000_000_000,
                "volume_ratio": 2.5,
                "sector": "半導體業",
            }
            for k in range(30)
        ]
        for key in ("gainers", "losers", "amount", "volume_ratio")
    }
    payload = {
        "as_of": "2026-06-29T10:30:00+08:00",
        "last_tick": "2026-06-29T10:29:50",
        "is_trading_session": True,
        "stale": False,
        "lag_seconds": 10,
        "sectors": sectors,
        "leaderboards": leaderboards,
    }
    raw_size = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    assert raw_size < 50_000, (
        f"Payload size {raw_size} >= 50000 (SC-1 budget);若 fail 改 "
        f"_HEATMAP_STOCKS_CAP_PER_SECTOR 從 30 → 20 重跑。"
    )
```

**SC mapping**:全 6 個 test → SC-1(snapshot route)+ SC-3(payload includes leaderboards)+ E3/E7(error)+ SC-5(refresh 旗標)。
