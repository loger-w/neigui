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
