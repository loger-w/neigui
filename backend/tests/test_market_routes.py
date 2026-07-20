"""SC-1 + SC-3 — Market routes integration.

Mocks fetch_market_snapshot via unittest.mock.patch (對齊 test_options_routes.py)。
"""
from __future__ import annotations

import gzip
import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app


_BASE_PAYLOAD = {
    "as_of": "2026-06-29T10:30:00+08:00",
    "last_tick": "2026-06-29T10:29:50",
    "is_trading_session": True,
    "stale": False,
    "lag_seconds": 10,
    "sectors": [
        {
            "id": "半導體業", "name": "半導體業", "member_count": 2,
            "avg_change_rate": 0.5, "total_amount": 100_000_000,
            "stocks": [
                {
                    "stock_id": "2330", "name": "台積電",
                    "change_rate": 1.0, "total_amount": 100_000_000,
                    "market_value": 60_000_000_000_000,
                },
            ],
        },
    ],
    "leaderboards": {
        "gainers": [], "losers": [], "amount": [], "volume_ratio": [],
    },
}


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_snapshot_happy_path_returns_200_and_shape() -> None:
    """SC-1: mock service 回完整 shape → 200 + sectors + leaderboards。"""
    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(return_value=_BASE_PAYLOAD),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert "sectors" in body
    assert "leaderboards" in body
    assert body["is_trading_session"] is True


def test_snapshot_refresh_param_passed_to_service() -> None:
    """SC-5: refresh=true → service 被 await 帶 refresh=True。"""
    mock_svc = AsyncMock(return_value=_BASE_PAYLOAD)
    with patch("routes.market.fetch_market_snapshot", new=mock_svc):
        TestClient(app).get("/api/market/snapshot?refresh=true")
    mock_svc.assert_awaited_once_with(refresh=True)


def test_snapshot_no_refresh_defaults_to_false() -> None:
    """SC-5: 無 refresh query → service 被 await 帶 refresh=False。"""
    mock_svc = AsyncMock(return_value=_BASE_PAYLOAD)
    with patch("routes.market.fetch_market_snapshot", new=mock_svc):
        TestClient(app).get("/api/market/snapshot")
    mock_svc.assert_awaited_once_with(refresh=False)


# ---------------------------------------------------------------------------
# Error path (E7 FinMind 失敗)
# ---------------------------------------------------------------------------


def test_snapshot_returns_502_when_service_raises_finmind_unreachable() -> None:
    """E7 / SC-1: service raise ValueError('finmind_unreachable') → 502。"""
    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(side_effect=ValueError("finmind_unreachable")),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_unreachable"


def test_snapshot_returns_503_on_unexpected_value_error() -> None:
    """SC-1: service raise ValueError(別的)→ 503。"""
    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(side_effect=ValueError("some_other_error")),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 503
    assert resp.json()["detail"]["error"] == "snapshot_unavailable"


# Audit X4 / Round-1 R5:test_snapshot_returns_502_on_httpx_timeout 已刪。
# 原因:routes/market.py 不再 catch httpx,service 用 asyncio.gather(return_exceptions=True)
# 並只 re-raise ValueError;httpx 例外無法穿過 service 邊界。原 test 直接 mock service
# raise httpx 是 fake path,留著只會誤導未來 reviewer 對錯誤處理的真實覆蓋度。


# ---------------------------------------------------------------------------
# Stale fallback path
# ---------------------------------------------------------------------------


def test_snapshot_stale_fallback_returns_200_with_flag() -> None:
    """E7: service 成功 return stale=True payload(disk cache 兜底)→ 200 + stale=true。"""
    stale_payload = {**_BASE_PAYLOAD, "stale": True}
    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(return_value=stale_payload),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 200
    assert resp.json()["stale"] is True


# ---------------------------------------------------------------------------
# v3 F10 — payload size measurement gate
# ---------------------------------------------------------------------------


def test_payload_size_under_budget() -> None:
    """SC-1 budget assert: 28 sectors × 30 stocks fixture → encoded json size
    < 50,000 bytes(SC-1 hard requirement);若 fail 改 cap 從 30 → 20。"""
    sectors = [
        {
            "id": f"sector_{i:02d}",
            "name": f"產業類別 {i:02d}",
            "member_count": 30,
            "avg_change_rate": 0.5,
            "total_amount": 1_000_000_000,
            "stocks": [
                {
                    "stock_id": f"{1000 + i * 30 + j}",
                    "name": f"中文名稱 {i}-{j}",
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
                "stock_id": f"{2000 + k:04d}",
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
    raw_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    raw_size = len(raw_bytes)
    gz_size = len(gzip.compress(raw_bytes))
    # SC-1 over-the-wire budget(brainstorm.md amendment 2026-06-29):
    # 量 gzip 後而非 raw,對齊 FastAPI GzipMiddleware 實際傳輸量。
    assert gz_size < 50_000, (
        f"Gzip-after size {gz_size} >= 50000 (SC-1 budget);raw was {raw_size}。"
        f" 若 fail 降 _HEATMAP_STOCKS_CAP_PER_SECTOR。"
    )


# ---------------------------------------------------------------------------
# prd 500 修正(2026-07-03)— CancelledError 邊界
# ---------------------------------------------------------------------------


def test_snapshot_returns_503_when_shared_task_cancelled_but_client_connected() -> None:
    """共用 inflight task 被取消(他人斷線觸發)而本 client 還連著 →
    不得裸 500,轉 503 snapshot_unavailable(前端有對應錯誤處理)。"""
    import asyncio

    with patch(
        "routes.market.fetch_market_snapshot",
        new=AsyncMock(side_effect=asyncio.CancelledError()),
    ):
        resp = TestClient(app).get("/api/market/snapshot")
    assert resp.status_code == 503
    assert resp.json()["detail"]["error"] == "snapshot_unavailable"


# ---------------------------------------------------------------------------
# GET /api/market/sector_members — SC-3 drill-down(change-spec.md §3 / §4 D)
# ---------------------------------------------------------------------------


_SECTOR_MEMBERS_PAYLOAD = {
    "industry": "半導體業",
    "sub_industry": "IC設計",
    "members": [
        {"stock_id": "2454", "name": "聯發科", "change_rate": 3.1,
         "vol_ratio": 1.5, "total_amount": 12_000_000_000},
    ],
}


def test_sector_members_happy_path_returns_200_and_shape() -> None:
    mock_svc = AsyncMock(return_value=_SECTOR_MEMBERS_PAYLOAD)
    with patch("routes.market.fetch_sector_members", new=mock_svc):
        resp = TestClient(app).get(
            "/api/market/sector_members?industry=%E5%8D%8A%E5%B0%8E%E9%AB%94%E6%A5%AD&sub_industry=IC%E8%A8%AD%E8%A8%88"
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["industry"] == "半導體業"
    assert body["sub_industry"] == "IC設計"
    assert len(body["members"]) == 1
    mock_svc.assert_awaited_once_with("半導體業", "IC設計")


def test_sector_members_no_sub_industry_passes_none() -> None:
    mock_svc = AsyncMock(return_value=_SECTOR_MEMBERS_PAYLOAD)
    with patch("routes.market.fetch_sector_members", new=mock_svc):
        resp = TestClient(app).get(
            "/api/market/sector_members?industry=%E5%8D%8A%E5%B0%8E%E9%AB%94%E6%A5%AD"
        )
    assert resp.status_code == 200
    mock_svc.assert_awaited_once_with("半導體業", None)


def test_sector_members_unknown_sector_returns_404() -> None:
    with patch(
        "routes.market.fetch_sector_members",
        new=AsyncMock(return_value=None),
    ):
        resp = TestClient(app).get("/api/market/sector_members?industry=%E4%B8%8D%E5%AD%98%E5%9C%A8")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "unknown_sector"


def test_sector_members_upstream_httpx_failure_returns_502() -> None:
    import httpx

    with patch(
        "routes.market.fetch_sector_members",
        new=AsyncMock(side_effect=httpx.ConnectError("simulated upstream blip")),
    ):
        resp = TestClient(app).get("/api/market/sector_members?industry=%E5%8D%8A%E5%B0%8E%E9%AB%94%E6%A5%AD")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_unreachable"


def test_sector_members_missing_industry_param_returns_422() -> None:
    resp = TestClient(app).get("/api/market/sector_members")
    assert resp.status_code == 422