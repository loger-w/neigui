"""/api/warrants/* route 測試(warrant-selector design §1.5)。

痛點:中央 httpx.HTTPError handler 回 finmind_error — 對 TWSE/TPEx/MIS 是
錯標籤,warrants/quotes handler 必須自己 catch(R9 逐 endpoint)。
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

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


def test_brokers_route_removed():
    # mod warrant-selector-table SC-3:分點買賣超前後端整組移除,route 不得殘留。
    # app.routes 不攤平 included router(_IncludedRouter)→ 走 openapi paths。
    from main import app

    assert "/api/warrants/{warrant_id}/brokers" not in app.openapi()["paths"]


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


# ------------------------------------------------- iv_drift 欄(warrant-iv-drift)
# WA-1(mod/batch-ui-update):/iv-history endpoint 已刪;service 保留供
# iv_drift 欄 merge,以下 fixture 與測試只覆蓋該讀取路徑。


@pytest.fixture()
def _reset_ivh(monkeypatch):
    import services.warrant_iv_history as ivh

    monkeypatch.setattr(ivh, "_drift_mem", None)
    monkeypatch.setattr(ivh, "_rebuild_bg_task", None)
    ivh._series_lru.clear()
    return ivh


def test_warrants_rows_carry_iv_drift(monkeypatch, client, _reset_ivh):
    # SC-4:讀取時 merge iv_drift label(不烙進快照檔)
    ivh = _reset_ivh
    snap = {
        "as_of_date": "2026-07-09",
        "tpex_date": "2026-07-09",
        "by_underlying": {"2330": [{"warrant_id": "030012", "name": "測試"}]},
    }

    async def fake_load(refresh: bool = False):
        return snap

    monkeypatch.setattr(ws, "_load_snapshot", fake_load)
    monkeypatch.setattr(
        ivh,
        "_drift_mem",
        {
            "_cache_version": 1,
            "built_from": [],
            "drift": {
                "030012": {
                    "label": "declining",
                    "slope_bid": -0.002,
                    "slope_ask": -0.001,
                    "n_valid": 55,
                }
            },
        },
    )
    r = client.get("/api/warrants/2330")
    assert r.status_code == 200
    row = r.json()["warrants"][0]
    assert row["iv_drift"] == "declining"
    # 快照 mem 不得被就地變異(design R10)
    assert "iv_drift" not in snap["by_underlying"]["2330"][0]


def test_iv_history_route_removed(client):
    # WA-1:引波展開整刪 — endpoint 不得殘留(防前端誤依賴已死路徑)
    r = client.get("/api/warrants/030012/iv-history")
    assert r.status_code in (404, 405)
