"""Tests for GZip middleware."""
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

MOCK_HISTORY = {
    "symbol": "2330",
    "fetched_at": "2026-06-19T20:15:00",
    "last_date": "2026-06-19",
    "candles": [
        {
            "date": f"2026-06-{d:02d}",
            "open": 100,
            "high": 105,
            "low": 99,
            "close": 103,
            "volume": 30000,
        }
        for d in range(1, 20)
    ],
    "institutional": [],
    "margin": [],
    "major": [],
}

SMALL_RESPONSE = {"symbol": "2330", "ok": True}


@pytest.fixture
def mock_fm():
    svc = AsyncMock()
    svc.fetch_chip_history = AsyncMock(return_value=MOCK_HISTORY)
    svc.fetch_chip_summary = AsyncMock(return_value=SMALL_RESPONSE)
    with patch("routes.chip.get_finmind", return_value=svc):
        yield svc


def test_gzip_large_response(mock_fm):
    resp = TestClient(app).get(
        "/api/chip/2330/history",
        headers={"Accept-Encoding": "gzip"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"
    assert resp.json()["symbol"] == "2330"


def test_no_gzip_without_accept_encoding(mock_fm):
    resp = TestClient(app).get(
        "/api/chip/2330/history",
        headers={"Accept-Encoding": "identity"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") != "gzip"


def test_no_gzip_small_response(mock_fm):
    resp = TestClient(app).get(
        "/api/chip/2330?date=2026-06-19",
        headers={"Accept-Encoding": "gzip"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") != "gzip"
