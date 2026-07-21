"""Tests for routes/symbols.py."""
from fastapi.testclient import TestClient

import routes.symbols as symbols_mod
from main import app


# --- load_symbols 走 FinMind 接入慣例(next-time 收編:裸 httpx → get_finmind)---


class _StubClient:
    def __init__(self, rows: list[dict] | Exception):
        self._rows = rows
        self.calls: list[tuple[str, dict]] = []

    async def _get(self, url: str, params: dict) -> list:
        self.calls.append((url, params))
        if isinstance(self._rows, Exception):
            raise self._rows
        return self._rows


async def test_load_symbols_fetches_via_finmind_client(monkeypatch):
    # 收編契約:production 路徑走 per-module get_finmind()(TokenBucket +
    # singleton + fake-override 全部隨之生效),不再自建裸 httpx client。
    stub = _StubClient(
        [
            {"stock_id": "2330", "stock_name": "台積電", "type": "twse"},
            {"stock_id": "2330", "stock_name": "台積電", "type": "twse"},  # dup
            {"stock_id": "6488", "stock_name": "環球晶", "type": "tpex"},
            {"stock_id": "TXO", "stock_name": "期權", "type": "index"},  # 非現股 type
            {"stock_id": "", "stock_name": "空 id", "type": "twse"},
        ]
    )
    monkeypatch.setattr(symbols_mod, "get_finmind", lambda: stub)
    monkeypatch.setattr(symbols_mod, "_symbols", [])
    await symbols_mod.load_symbols()
    assert symbols_mod._symbols == [
        {"symbol": "2330", "name": "台積電"},
        {"symbol": "6488", "name": "環球晶"},
    ]
    assert stub.calls == [
        (
            "https://api.finmindtrade.com/api/v4/data",
            {"dataset": "TaiwanStockInfo"},
        )
    ]


async def test_load_symbols_swallows_upstream_failure(monkeypatch):
    # 既有契約保持:上游失敗只留 warning、_symbols 不動(lazy reload 下輪重試)。
    stub = _StubClient(RuntimeError("boom"))
    monkeypatch.setattr(symbols_mod, "get_finmind", lambda: stub)
    monkeypatch.setattr(symbols_mod, "_symbols", [])
    await symbols_mod.load_symbols()  # 不得 raise
    assert symbols_mod._symbols == []


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
