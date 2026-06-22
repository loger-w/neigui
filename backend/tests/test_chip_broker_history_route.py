"""Tests for /api/chip/{symbol}/broker_history."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("FINMIND_TOKEN", "test")

from main import app  # noqa: E402


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
    payload = {
        "symbol": "2330", "fetched_at": "", "last_date": "",
        "brokers": {"A": [], "B": []},
    }
    mock = AsyncMock(return_value=payload)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_broker_history = mock
        r = client.get("/api/chip/2330/broker_history?ids= A , B ,")
    assert r.status_code == 200
    mock.assert_called_once_with("2330", ["A", "B"], False)
