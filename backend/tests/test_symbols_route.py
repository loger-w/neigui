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


# --- get_symbol_name_map(broker_flows 名稱 join 用,feat/broker-daily-flows)---

async def test_get_symbol_name_map_builds_dict(monkeypatch):
    monkeypatch.setattr(
        symbols_mod, "_symbols",
        [{"symbol": "2330", "name": "台積電"}, {"symbol": "2317", "name": "鴻海"}],
    )
    m = await symbols_mod.get_symbol_name_map()
    assert m == {"2330": "台積電", "2317": "鴻海"}


async def test_get_symbol_name_map_raises_when_unavailable(monkeypatch):
    monkeypatch.setattr(symbols_mod, "_symbols", [])

    async def fake_load() -> None:
        return None

    monkeypatch.setattr(symbols_mod, "load_symbols", fake_load)
    import pytest

    with pytest.raises(ValueError, match="symbols_unavailable"):
        await symbols_mod.get_symbol_name_map()


# --- lazy reload contract ------------------------------------------------
# Background: if startup-time load_symbols() fails (FinMind 4xx, network
# blip), _symbols stays [] forever and /api/symbols/* silently returns
# nothing until the process is restarted. The routes now trigger a
# best-effort lazy reload when _symbols is empty.

def test_all_symbols_lazy_reloads_when_empty(monkeypatch):
    monkeypatch.setattr(symbols_mod, "_symbols", [])

    async def fake_load() -> None:
        symbols_mod._symbols = [
            {"symbol": "2330", "name": "台積電"},
            {"symbol": "2317", "name": "鴻海"},
        ]

    monkeypatch.setattr(symbols_mod, "load_symbols", fake_load)
    r = TestClient(app).get("/api/symbols/all")
    assert r.status_code == 200
    assert [s["symbol"] for s in r.json()] == ["2330", "2317"]


def test_all_symbols_returns_503_when_lazy_load_fails(monkeypatch):
    monkeypatch.setattr(symbols_mod, "_symbols", [])

    async def fake_load() -> None:
        # Mirrors load_symbols' real failure mode: it swallows the upstream
        # exception, logs a warning, and leaves _symbols untouched.
        return None

    monkeypatch.setattr(symbols_mod, "load_symbols", fake_load)
    r = TestClient(app).get("/api/symbols/all")
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "symbols_unavailable"


def test_search_symbols_lazy_reloads_when_empty(monkeypatch):
    monkeypatch.setattr(symbols_mod, "_symbols", [])

    async def fake_load() -> None:
        symbols_mod._symbols = [
            {"symbol": "2330", "name": "台積電"},
            {"symbol": "2317", "name": "鴻海"},
        ]

    monkeypatch.setattr(symbols_mod, "load_symbols", fake_load)
    r = TestClient(app).get("/api/symbols", params={"search": "23"})
    assert r.status_code == 200
    assert [s["symbol"] for s in r.json()] == ["2330", "2317"]
