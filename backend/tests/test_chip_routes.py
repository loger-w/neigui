"""Tests for routes/chip.py — chip data API endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app

MOCK_SUMMARY = {
    "symbol": "2330",
    "date": "2026-06-19",
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
        {
            "name": "美林",
            "broker_id": "9A00",
            "buy": 100,
            "sell": 5,
            "net": 95,
            "avg_buy_price": 100.0,
            "avg_sell_price": 101.0,
        },
    ],
}

MOCK_BUBBLE = {
    "symbol": "2330",
    "date": "2026-06-19",
    "fetched_at": "2026-06-19T20:15:00",
    "trades": [{"broker": "美林", "broker_id": "9A00", "price": 100.0, "buy": 50, "sell": 3}],
}

MOCK_HISTORY = {
    "symbol": "2330",
    "fetched_at": "2026-06-19T20:15:00",
    "last_date": "2026-06-19",
    "candles": [
        {"date": "2026-06-19", "open": 100, "high": 105, "low": 99, "close": 103, "volume": 30000}
    ],
    "institutional": [
        {
            "date": "2026-06-19",
            "foreign_net": 50,
            "trust_net": 5,
            "dealer_net": -10,
            "major_net": 45,
        }
    ],
    "margin": [
        {
            "date": "2026-06-19",
            "margin_balance": 1000,
            "short_balance": 50,
            "margin_change": 10,
            "short_change": -3,
        }
    ],
    "major": [{"date": "2026-06-19", "major_net": 45}],
}


MOCK_HISTORY_BASE = {
    "symbol": "2330",
    "fetched_at": "2026-06-19T20:15:00",
    "last_date": "2026-06-19",
    "candles": MOCK_HISTORY["candles"],
    "institutional": MOCK_HISTORY["institutional"],
    "margin": MOCK_HISTORY["margin"],
    "major": [],
}

MOCK_HISTORY_MAJOR = {
    "symbol": "2330",
    "fetched_at": "2026-06-19T20:15:00",
    "last_date": "2026-06-19",
    "major": [{"date": "2026-06-19", "major_net": 45}],
}


MOCK_INTRADAY = {
    "symbol": "2330",
    "date": "2026-06-26",
    "fetched_at": "2026-06-26T15:55:00",
    "points": [
        {"t": "09:00", "price": 2360.0},
        {"t": "09:01", "price": 2365.0},
        {"t": "13:30", "price": 2340.0},
    ],
}


@pytest.fixture
def mock_fm():
    svc = AsyncMock()
    svc.fetch_chip_summary = AsyncMock(return_value=MOCK_SUMMARY)
    svc.fetch_chip_bubble = AsyncMock(return_value=MOCK_BUBBLE)
    svc.fetch_chip_history = AsyncMock(return_value=MOCK_HISTORY)
    svc.fetch_chip_history_base = AsyncMock(return_value=MOCK_HISTORY_BASE)
    svc.fetch_chip_history_major = AsyncMock(return_value=MOCK_HISTORY_MAJOR)
    svc.fetch_chip_intraday = AsyncMock(return_value=MOCK_INTRADAY)
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


def test_chip_intraday_route_returns_payload(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/intraday?date=2026-06-26")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "2330"
    assert body["date"] == "2026-06-26"
    assert body["points"][0]["t"] == "09:00"
    mock_fm.fetch_chip_intraday.assert_awaited_once_with("2330", "2026-06-26", False)


def test_chip_intraday_default_date(mock_fm):
    """無 date param → 走 _today() default,refresh=False(F-P3-18:鎖 clock
    路徑的實值,route 若退回 wall-clock 或亂傳日期會紅)。"""
    from routes.chip import _today

    resp = TestClient(app).get("/api/chip/2330/intraday")
    assert resp.status_code == 200
    call = mock_fm.fetch_chip_intraday.await_args
    assert call.args[0] == "2330"
    assert call.args[1] == _today()
    assert call.args[2] is False


def test_chip_intraday_refresh_param(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/intraday?date=2026-06-26&refresh=true")
    assert resp.status_code == 200
    mock_fm.fetch_chip_intraday.assert_awaited_once_with("2330", "2026-06-26", True)


def test_chip_history(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history")
    assert resp.status_code == 200
    assert len(resp.json()["candles"]) == 1


def test_chip_history_default_days(mock_fm):
    """W1: 不帶 days,service 收到 default 90。"""
    resp = TestClient(app).get("/api/chip/2330/history")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history.assert_awaited_once_with("2330", False, 90)


def test_chip_history_with_days(mock_fm):
    """帶 days=60,service 收到 60。"""
    resp = TestClient(app).get("/api/chip/2330/history?days=60")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history.assert_awaited_once_with("2330", False, 60)


def test_chip_history_days_too_small(mock_fm):
    """days=1 < ge=5 → 422 由 Pydantic Query 攔截。"""
    resp = TestClient(app).get("/api/chip/2330/history?days=1")
    assert resp.status_code == 422


def test_chip_history_days_out_of_range(mock_fm):
    """days=1000 > le=540 → 422。"""
    resp = TestClient(app).get("/api/chip/2330/history?days=1000")
    assert resp.status_code == 422


def test_chip_history_days_max_boundary(mock_fm):
    """days=540(K 線縮放上限)接受;541 拒。"""
    ok = TestClient(app).get("/api/chip/2330/history?days=540")
    assert ok.status_code == 200
    bad = TestClient(app).get("/api/chip/2330/history?days=541")
    assert bad.status_code == 422


# -- history split: /base + /major --------------------------------------


def test_chip_history_base_route(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history/base?days=540")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history_base.assert_awaited_once_with("2330", False, 540)
    body = resp.json()
    # Schema parity with /history but `major: []`.
    assert body["candles"] == MOCK_HISTORY_BASE["candles"]
    assert body["institutional"] == MOCK_HISTORY_BASE["institutional"]
    assert body["margin"] == MOCK_HISTORY_BASE["margin"]
    assert body["major"] == []


def test_chip_history_base_refresh_passthrough(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history/base?days=540&refresh=true")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history_base.assert_awaited_once_with("2330", True, 540)


def test_chip_history_base_default_days(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history/base")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history_base.assert_awaited_once_with("2330", False, 90)


def test_chip_history_major_route(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history/major?days=540")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history_major.assert_awaited_once_with("2330", False, 540)
    body = resp.json()
    # Slim payload: only major series.
    assert body["major"] == MOCK_HISTORY_MAJOR["major"]
    assert "candles" not in body
    assert "institutional" not in body
    assert "margin" not in body


def test_chip_history_major_refresh_passthrough(mock_fm):
    resp = TestClient(app).get("/api/chip/2330/history/major?days=540&refresh=true")
    assert resp.status_code == 200
    mock_fm.fetch_chip_history_major.assert_awaited_once_with("2330", True, 540)


def test_legacy_history_route_unchanged(mock_fm):
    """Regression: /history still returns the full super-set; split endpoints
    do not affect existing callers."""
    resp = TestClient(app).get("/api/chip/2330/history?days=540")
    assert resp.status_code == 200
    body = resp.json()
    assert "candles" in body
    assert "institutional" in body
    assert "margin" in body
    assert "major" in body
    assert body["major"] == MOCK_HISTORY["major"]
    mock_fm.fetch_chip_history.assert_awaited_once_with("2330", False, 540)
    mock_fm.fetch_chip_history_base.assert_not_called()
    mock_fm.fetch_chip_history_major.assert_not_called()


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
