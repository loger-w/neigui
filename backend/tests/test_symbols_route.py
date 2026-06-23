"""Tests for routes/symbols.py."""
from fastapi.testclient import TestClient

import routes.symbols as symbols_mod
from main import app


def test_search_symbols_filters_by_prefix(monkeypatch):
    monkeypatch.setattr(
        symbols_mod,
        "_symbols",
        [
            {"symbol": "2330", "name": "台積電"},
            {"symbol": "2317", "name": "鴻海"},
            {"symbol": "2454", "name": "聯發科"},
        ],
    )
    r = TestClient(app).get("/api/symbols", params={"search": "23"})
    assert r.status_code == 200
    symbols = [s["symbol"] for s in r.json()]
    assert "2330" in symbols
    assert "2317" in symbols
    assert "2454" not in symbols


def test_search_symbols_filters_by_name_substring(monkeypatch):
    monkeypatch.setattr(
        symbols_mod,
        "_symbols",
        [
            {"symbol": "2330", "name": "台積電"},
            {"symbol": "2317", "name": "鴻海"},
        ],
    )
    r = TestClient(app).get("/api/symbols", params={"search": "台積"})
    assert r.status_code == 200
    assert [s["symbol"] for s in r.json()] == ["2330"]


def test_search_symbols_caps_at_20(monkeypatch):
    monkeypatch.setattr(
        symbols_mod,
        "_symbols",
        [{"symbol": f"2{i:03d}", "name": f"s{i}"} for i in range(50)],
    )
    r = TestClient(app).get("/api/symbols", params={"search": "2"})
    assert r.status_code == 200
    assert len(r.json()) == 20


def test_all_symbols_returns_complete_list(monkeypatch):
    data = [
        {"symbol": "2330", "name": "台積電"},
        {"symbol": "2317", "name": "鴻海"},
        {"symbol": "2454", "name": "聯發科"},
    ]
    monkeypatch.setattr(symbols_mod, "_symbols", data)
    r = TestClient(app).get("/api/symbols/all")
    assert r.status_code == 200
    assert r.json() == data


def test_all_symbols_empty_when_not_loaded(monkeypatch):
    monkeypatch.setattr(symbols_mod, "_symbols", [])
    r = TestClient(app).get("/api/symbols/all")
    assert r.status_code == 200
    assert r.json() == []
