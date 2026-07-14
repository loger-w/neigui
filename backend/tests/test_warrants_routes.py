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


# ---------------------------------------------------------------- iv-history(warrant-iv-drift)


@pytest.fixture()
def _reset_ivh(monkeypatch):
    import services.warrant_iv_history as ivh

    monkeypatch.setattr(ivh, "_drift_mem", None)
    monkeypatch.setattr(ivh, "_rebuild_bg_task", None)
    ivh._series_lru.clear()
    ivh._inflight.clear()
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
            "drift": {"030012": {"label": "declining", "slope_bid": -0.002, "slope_ask": -0.001, "n_valid": 55}},
        },
    )
    r = client.get("/api/warrants/2330")
    assert r.status_code == 200
    row = r.json()["warrants"][0]
    assert row["iv_drift"] == "declining"
    # 快照 mem 不得被就地變異(design R10)
    assert "iv_drift" not in snap["by_underlying"]["2330"][0]


def test_iv_history_ok_shape(monkeypatch, client, _reset_ivh):
    ivh = _reset_ivh

    async def fake(warrant_id: str, refresh: bool = False):
        return {
            "warrant_id": warrant_id,
            "terms_approx_dates": ["2026-07-08"],
            "series": [{"date": "2026-07-09", "iv_bid": 0.41, "iv_ask": 0.45}],
            "drift": {"label": "stable", "slope_bid": 0.0, "slope_ask": 0.0, "n_valid": 30},
        }

    monkeypatch.setattr(ivh, "get_iv_history", fake)
    r = client.get("/api/warrants/030012/iv-history")
    assert r.status_code == 200
    body = r.json()
    assert body["warrant_id"] == "030012"
    assert body["series"][0]["iv_bid"] == 0.41
    assert body["drift"]["label"] == "stable"


def test_iv_history_unknown_warrant_404(monkeypatch, client, _reset_ivh):
    ivh = _reset_ivh

    async def fake(warrant_id: str, refresh: bool = False):
        return None

    monkeypatch.setattr(ivh, "get_iv_history", fake)
    r = client.get("/api/warrants/999999/iv-history")
    assert r.status_code == 404
    assert r.json()["detail"] == {"error": "not_found"}


def test_iv_history_bad_id_400(client):
    r = client.get("/api/warrants/abc!/iv-history")
    assert r.status_code == 400
    assert r.json()["detail"] == {"error": "bad_symbol"}


def test_iv_history_empty_archives_returns_200_empty_series(monkeypatch, client, _reset_ivh):
    # SC-5 核心 edge:無 archive(冷啟動 / 新環境)→ 200 空 series 不炸
    snap = {
        "as_of_date": "2026-07-09",
        "tpex_date": "2026-07-09",
        "by_underlying": {"2330": [{"warrant_id": "030012", "name": "測試"}]},
    }

    async def fake_get_snapshot(refresh: bool = False):
        return snap

    monkeypatch.setattr(ws, "get_snapshot", fake_get_snapshot)
    r = client.get("/api/warrants/030012/iv-history")
    assert r.status_code == 200
    body = r.json()
    assert body["series"] == []
    assert body["drift"]["label"] == "insufficient"


def test_iv_history_upstream_error_502(monkeypatch, client, _reset_ivh):
    ivh = _reset_ivh

    async def boom(warrant_id: str, refresh: bool = False):
        raise httpx.ConnectError("twse down")

    monkeypatch.setattr(ivh, "get_iv_history", boom)
    r = client.get("/api/warrants/030012/iv-history")
    assert r.status_code == 502
    assert r.json()["detail"] == {"error": "warrant_upstream"}


# ---------------------------------------------------------------- issuers rank(warrant-selector-enhance)


@pytest.fixture()
def _reset_wi(monkeypatch):
    import services.warrant_issuers as wi

    monkeypatch.setattr(wi, "_map_mem", None)
    monkeypatch.setattr(wi, "_rank_mem", None)
    monkeypatch.setattr(wi, "_map_bg_task", None)
    wi._inflight.clear()
    return wi


def test_issuer_rank_ok_shape(monkeypatch, client, _reset_wi):
    wi = _reset_wi
    payload = {
        "_cache_version": 1,
        "as_of_date": "2026-07-10",
        "built_from_days": 10,
        "issuers": [
            {
                "issuer_id": "9200", "issuer_name": "凱基", "n_warrants": 5,
                "n_scored": 5, "iv_std_median": 0.01, "spread_median": 0.04,
                "declining_share": 0.2, "composite": 0.1, "rank": 1, "tier": "front",
            }
        ],
    }

    async def fake(refresh: bool = False):
        return payload

    monkeypatch.setattr(wi, "get_issuer_rank", fake)
    r = client.get("/api/warrants/issuers/rank")
    assert r.status_code == 200
    body = r.json()
    assert body["as_of_date"] == "2026-07-10"
    assert body["issuers"][0]["tier"] == "front"


def test_issuer_rank_not_ready_503(monkeypatch, client, _reset_wi):
    wi = _reset_wi

    async def fake(refresh: bool = False):
        return None

    monkeypatch.setattr(wi, "get_issuer_rank", fake)
    r = client.get("/api/warrants/issuers/rank")
    assert r.status_code == 503
    assert r.json()["detail"] == {"error": "issuer_rank_not_ready"}


def test_issuer_rank_upstream_error_502(monkeypatch, client, _reset_wi):
    wi = _reset_wi

    async def boom(refresh: bool = False):
        raise httpx.ConnectError("twse down")

    monkeypatch.setattr(wi, "get_issuer_rank", boom)
    r = client.get("/api/warrants/issuers/rank")
    assert r.status_code == 502
    assert r.json()["detail"] == {"error": "warrant_upstream"}


def test_warrants_rows_carry_issuer_fields(monkeypatch, client, _reset_wi):
    # SC-4:讀取時 merge issuer_name / issuer_tier(不烙快照、不 await 上游)
    wi = _reset_wi
    snap = {
        "as_of_date": "2026-07-09",
        "tpex_date": "2026-07-09",
        "by_underlying": {"2330": [{"warrant_id": "030012", "name": "測試"}]},
    }

    async def fake_load(refresh: bool = False):
        return snap

    monkeypatch.setattr(ws, "_load_snapshot", fake_load)
    monkeypatch.setattr(
        wi,
        "_map_mem",
        {
            "_cache_version": 1,
            "fetched_on": "2026-07-14",
            "map": {"030012": {"issuer_id": "9200", "issuer_name": "凱基"}},
        },
    )
    monkeypatch.setattr(
        wi,
        "_rank_mem",
        {
            "_cache_version": 1,
            "as_of_date": "2026-07-10",
            "built_from_days": 10,
            "issuers": [{"issuer_id": "9200", "tier": "front"}],
        },
    )
    r = client.get("/api/warrants/2330")
    assert r.status_code == 200
    row = r.json()["warrants"][0]
    assert row["issuer_name"] == "凱基"
    assert row["issuer_tier"] == "front"
    assert "issuer_name" not in snap["by_underlying"]["2330"][0]


def test_warrants_rows_issuer_null_safe(monkeypatch, client, _reset_wi):
    # 對照 miss → null,不炸(SC-4;背景 task 由 accessor spawn,不阻塞)
    snap = {
        "as_of_date": "2026-07-09",
        "tpex_date": "2026-07-09",
        "by_underlying": {"2330": [{"warrant_id": "999999", "name": "測試"}]},
    }

    async def fake_load(refresh: bool = False):
        return snap

    monkeypatch.setattr(ws, "_load_snapshot", fake_load)
    r = client.get("/api/warrants/2330")
    assert r.status_code == 200
    row = r.json()["warrants"][0]
    assert row["issuer_name"] is None
    assert row["issuer_tier"] is None
