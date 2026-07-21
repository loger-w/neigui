# /api/broker/* route 層 — design .claude/feat/broker-daily-flows/design.md v3 §2.3
from __future__ import annotations

import os

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("FINMIND_TOKEN", "test")

import services.broker_flows as bf  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


def _async_ret(value):
    async def _fn(*args, **kwargs):
        return value
    return _fn


def _async_raise(exc):
    async def _fn(*args, **kwargs):
        raise exc
    return _fn


def test_daily_flows_missing_broker_id_422(client):
    r = client.get("/api/broker/daily-flows")
    # validation error 不在 {"error": code} contract 內(design R4:既有全站行為)
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)


def test_traders_missing_search_422(client):
    r = client.get("/api/broker/traders")
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)


def test_daily_flows_invalid_date_400(client, monkeypatch):
    monkeypatch.setattr(
        bf, "get_daily_flows",
        _async_raise(HTTPException(400, {"error": "invalid_date"})),
    )
    r = client.get("/api/broker/daily-flows", params={"broker_id": "9600", "date": "2026-02-31"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_date"


def test_daily_flows_passthrough_success(client, monkeypatch):
    payload = {
        "broker_id": "9600", "broker_name": "富邦",
        "requested_date": "2026-07-17", "as_of_date": "2026-07-17",
        "no_trading_day": False, "stock_count": 1, "fetched_at": "t",
        "buy_top": [], "sell_top": [],
    }
    calls: list = []

    async def fake(broker_id, date_param, refresh):
        calls.append((broker_id, date_param, refresh))
        return payload

    monkeypatch.setattr(bf, "get_daily_flows", fake)
    r = client.get("/api/broker/daily-flows", params={"broker_id": " 9600 "})
    assert r.status_code == 200
    assert r.json() == payload
    assert calls == [("9600", None, False)]  # strip + 預設值


def test_daily_flows_refresh_param_forwarded(client, monkeypatch):
    calls: list = []

    async def fake(broker_id, date_param, refresh):
        calls.append((broker_id, date_param, refresh))
        return {"ok": True}

    monkeypatch.setattr(bf, "get_daily_flows", fake)
    r = client.get(
        "/api/broker/daily-flows",
        params={"broker_id": "9600", "date": "2026-07-16", "refresh": "true"},
    )
    assert r.status_code == 200
    assert calls == [("9600", "2026-07-16", True)]


def test_daily_flows_503_passthrough(client, monkeypatch):
    monkeypatch.setattr(
        bf, "get_daily_flows",
        _async_raise(HTTPException(503, {"error": "broker_flows_unavailable"})),
    )
    r = client.get("/api/broker/daily-flows", params={"broker_id": "9600"})
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "broker_flows_unavailable"


def test_daily_flows_404_passthrough(client, monkeypatch):
    monkeypatch.setattr(
        bf, "get_daily_flows",
        _async_raise(HTTPException(404, {"error": "broker_not_found"})),
    )
    r = client.get("/api/broker/daily-flows", params={"broker_id": "0000"})
    assert r.status_code == 404
    assert r.json()["detail"]["error"] == "broker_not_found"


def test_traders_passthrough(client, monkeypatch):
    hits = [{"broker_id": "9600", "broker_name": "富邦"}]
    monkeypatch.setattr(bf, "search_traders", _async_ret(hits))
    r = client.get("/api/broker/traders", params={"search": "富邦"})
    assert r.status_code == 200
    assert r.json() == hits
