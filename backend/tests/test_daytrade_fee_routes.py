"""/api/daytrade-fee route 測試(/feat daytrade-borrow-fee Wave 2)。

痛點:main.py 中央 httpx.HTTPError handler 回 finmind_error — 對 TWSE/TPEx
是錯標籤,route 層必須自己 catch(design P1-1 用基類全蓋)。
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import services.daytrade_fee as df


@pytest.fixture()
def client():
    from main import app

    return TestClient(app, raise_server_exceptions=False)


def test_shape_ok(monkeypatch, client):
    async def fake_get_day(date_str, refresh=False):
        assert date_str is None
        assert refresh is False
        return {"as_of_date": "2026-07-09", "rows": [], "month_counts": {}}

    monkeypatch.setattr(df, "get_day", fake_get_day)
    r = client.get("/api/daytrade-fee")
    assert r.status_code == 200
    assert r.json()["as_of_date"] == "2026-07-09"


def test_params_passthrough(monkeypatch, client):
    seen = {}

    async def fake_get_day(date_str, refresh=False):
        seen["date"] = date_str
        seen["refresh"] = refresh
        return {"as_of_date": date_str, "rows": [], "month_counts": {}}

    monkeypatch.setattr(df, "get_day", fake_get_day)
    r = client.get("/api/daytrade-fee", params={"date": "2026-07-08", "refresh": "true"})
    assert r.status_code == 200
    assert seen == {"date": "2026-07-08", "refresh": True}


def test_bad_date_400(client):
    r = client.get("/api/daytrade-fee", params={"date": "07/08/2026"})
    assert r.status_code == 400
    assert r.json() == {"detail": {"error": "bad_date"}}


@pytest.mark.parametrize(
    "exc",
    [
        httpx.ConnectError("boom"),
        httpx.ReadError("mid-stream"),  # P1-1:基類 catch,不漏 TransportError 子類
        httpx.HTTPStatusError(
            "500",
            request=httpx.Request("GET", "http://x"),
            response=httpx.Response(500),
        ),
    ],
)
def test_upstream_error_502_borrow_fee_upstream(monkeypatch, client, exc):
    async def fake_get_day(date_str, refresh=False):
        raise exc

    monkeypatch.setattr(df, "get_day", fake_get_day)
    r = client.get("/api/daytrade-fee")
    assert r.status_code == 502
    assert r.json() == {"detail": {"error": "borrow_fee_upstream"}}


def test_404_no_data_passthrough(monkeypatch, client):
    async def fake_get_day(date_str, refresh=False):
        raise HTTPException(status_code=404, detail={"error": "no_data"})

    monkeypatch.setattr(df, "get_day", fake_get_day)
    r = client.get("/api/daytrade-fee")
    assert r.status_code == 404
    assert r.json() == {"detail": {"error": "no_data"}}
