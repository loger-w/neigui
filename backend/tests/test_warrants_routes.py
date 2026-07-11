"""/api/warrants/* route 測試(warrant-selector design §1.5)。

痛點:中央 httpx.HTTPError handler 回 finmind_error — 對 TWSE/TPEx/MIS 是
錯標籤,warrants/quotes handler 必須自己 catch;brokers 上游真是 FinMind,
反而不 catch(R9 逐 endpoint)。
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

import services.warrant_brokers as wb
import services.warrant_quotes as wq
import services.warrants as ws


@pytest.fixture()
def client():
    from main import app

    return TestClient(app, raise_server_exceptions=False)


def test_warrants_shape_ok(monkeypatch, client):
    async def fake(stock_id: str, refresh: bool = False):
        assert stock_id == "2330"
        return {"as_of_date": "2026-07-09", "warrants": []}

    monkeypatch.setattr(ws, "get_underlying_warrants", fake)
    r = client.get("/api/warrants/2330")
    assert r.status_code == 200
    assert r.json() == {"as_of_date": "2026-07-09", "warrants": []}


def test_warrants_refresh_passthrough(monkeypatch, client):
    seen = {}

    async def fake(stock_id: str, refresh: bool = False):
        seen["refresh"] = refresh
        return {"as_of_date": "2026-07-09", "warrants": []}

    monkeypatch.setattr(ws, "get_underlying_warrants", fake)
    assert client.get("/api/warrants/2330?refresh=true").status_code == 200
    assert seen["refresh"] is True


def test_warrants_bad_symbol_400(client):
    r = client.get("/api/warrants/abc!")
    assert r.status_code == 400
    assert r.json()["detail"] == {"error": "bad_symbol"}


def test_brokers_bad_symbol_400(client):
    # R2-3:warrant_id 同樣驗證(未驗證直傳 FinMind 會 ×5 回退放大配額浪費)
    r = client.get("/api/warrants/0300123456789/brokers")
    assert r.status_code == 400
    assert r.json()["detail"] == {"error": "bad_symbol"}


def test_warrants_upstream_error_502(monkeypatch, client):
    async def boom(stock_id: str, refresh: bool = False):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(ws, "get_underlying_warrants", boom)
    r = client.get("/api/warrants/2330")
    assert r.status_code == 502
    assert r.json()["detail"] == {"error": "warrant_upstream"}


def test_quotes_shape_and_upstream_error(monkeypatch, client):
    async def fake(stock_id: str, refresh: bool = False):
        return {
            "stock_id": stock_id,
            "underlying_price": None,
            "quote_date": None,
            "quote_time": None,
            "quotes": {},
        }

    monkeypatch.setattr(wq, "get_quotes", fake)
    r = client.get("/api/warrants/9999/quotes")
    assert r.status_code == 200
    assert r.json()["quotes"] == {}

    async def boom(stock_id: str, refresh: bool = False):
        raise httpx.ReadTimeout("mis slow")

    monkeypatch.setattr(wq, "get_quotes", boom)
    r = client.get("/api/warrants/9999/quotes")
    assert r.status_code == 502
    assert r.json()["detail"] == {"error": "warrant_upstream"}


def test_brokers_shape_ok(monkeypatch, client):
    async def fake(warrant_id: str, refresh: bool = False):
        assert warrant_id == "030012"
        return {"data_date": "2026-07-09", "rows": []}

    monkeypatch.setattr(wb, "get_brokers", fake)
    r = client.get("/api/warrants/030012/brokers")
    assert r.status_code == 200
    assert r.json()["data_date"] == "2026-07-09"


def test_brokers_httpx_error_falls_to_central_handler(monkeypatch, client):
    # R9:brokers 上游 = FinMind,不自己 catch → 中央 handler finmind_error
    async def boom(warrant_id: str, refresh: bool = False):
        raise httpx.ConnectError("finmind down")

    monkeypatch.setattr(wb, "get_brokers", boom)
    r = client.get("/api/warrants/030012/brokers")
    assert r.status_code == 502
    assert r.json()["detail"] == {"error": "finmind_error"}
