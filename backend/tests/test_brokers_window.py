"""Tests for the N-day brokers aggregate window (chip-brokers-window spec).

Endpoint:  GET /api/chip/{symbol}/brokers_window?date=...&days=N
Service:   FinMindClient.fetch_brokers_window + _aggregate_brokers_window

Strategy:
- _aggregate_brokers_window 是純函式 → 直接餵 fixture summaries,assert 輸出 shape
- fetch_brokers_window 是 orchestration → mock services.trading_calendar.get_trading_days
  (cheap calendar, replaces former 540-day history pull) + mock fetch_chip_summary,
  verify 取最後 N 個 trading days、fan-out 與 aggregate 正確
"""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


# ---------------------------------------------------------------------------
# Fixtures — 5 個 trading days 的 summary,broker A / B 數值方便手算驗證
# ---------------------------------------------------------------------------


def _summary(
    date_str: str,
    a_buy: int,
    a_sell: int,
    a_buy_price: float,
    a_sell_price: float,
    b_buy: int = 0,
    b_sell: int = 0,
    b_buy_price: float = 0,
    b_sell_price: float = 0,
    foreign_buy: int = 100,
    foreign_sell: int = 80,
    margin_change: int = 5,
    margin_balance: int = 1000,
    short_balance: int = 50,
) -> dict:
    return {
        "symbol": "2330",
        "date": date_str,
        "fetched_at": f"{date_str}T20:00:00",
        "institutional": {
            "foreign": {"buy": foreign_buy, "sell": foreign_sell,
                        "net": foreign_buy - foreign_sell},
            "trust": {"buy": 10, "sell": 5, "net": 5},
            "dealer": {"buy": 20, "sell": 30, "net": -10},
        },
        "margin": {
            "margin_purchase": {"balance": margin_balance,
                                "change": margin_change, "limit": 5000},
            "short_sale": {"balance": short_balance, "change": -3, "limit": 5000},
            "short_balance_ratio": round(short_balance / margin_balance * 100, 2),
        },
        "top_brokers": [
            {"name": "美林", "broker_id": "A",
             "buy": a_buy, "sell": a_sell, "net": a_buy - a_sell,
             "avg_buy_price": a_buy_price, "avg_sell_price": a_sell_price},
            *(
                [{
                    "name": "元大", "broker_id": "B",
                    "buy": b_buy, "sell": b_sell, "net": b_buy - b_sell,
                    "avg_buy_price": b_buy_price, "avg_sell_price": b_sell_price,
                }] if b_buy or b_sell else []
            ),
        ],
    }


# ---------------------------------------------------------------------------
# Pure aggregate function tests
# ---------------------------------------------------------------------------


def test_aggregate_sums_buy_sell_net_per_broker():
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-16", a_buy=100, a_sell=20, a_buy_price=100, a_sell_price=101),
        _summary("2026-06-17", a_buy=50, a_sell=10, a_buy_price=102, a_sell_price=103),
        _summary("2026-06-18", a_buy=30, a_sell=5, a_buy_price=104, a_sell_price=105,
                 b_buy=200, b_sell=100, b_buy_price=110, b_sell_price=111),
    ]
    trading_dates = [s["date"] for s in summaries]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-18", days=5,
        trading_dates=trading_dates, summaries=summaries,
    )
    by_id = {b["broker_id"]: b for b in out["top_brokers"]}
    assert by_id["A"]["buy"] == 180
    assert by_id["A"]["sell"] == 35
    assert by_id["A"]["net"] == 145
    assert by_id["B"]["buy"] == 200
    assert by_id["B"]["sell"] == 100
    assert by_id["B"]["net"] == 100


def test_aggregate_weighted_avg_price():
    from services.finmind import _aggregate_brokers_window

    # 加權平均 = Σ(daily_avg × daily_qty) / Σ daily_qty
    # A buy: (100×100 + 102×50 + 104×30) / (100+50+30) = (10000+5100+3120)/180 = 18220/180 = 101.222
    # A sell: (101×20 + 103×10 + 105×5) / 35 = (2020+1030+525)/35 = 3575/35 = 102.143
    summaries = [
        _summary("2026-06-16", a_buy=100, a_sell=20, a_buy_price=100, a_sell_price=101),
        _summary("2026-06-17", a_buy=50, a_sell=10, a_buy_price=102, a_sell_price=103),
        _summary("2026-06-18", a_buy=30, a_sell=5, a_buy_price=104, a_sell_price=105),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-18", days=5,
        trading_dates=[s["date"] for s in summaries], summaries=summaries,
    )
    a = next(b for b in out["top_brokers"] if b["broker_id"] == "A")
    assert a["avg_buy_price"] == pytest.approx(18220 / 180, abs=0.01)
    assert a["avg_sell_price"] == pytest.approx(3575 / 35, abs=0.01)


def test_aggregate_avg_price_zero_when_no_trades_on_side():
    """B 全天只買不賣 → avg_sell_price = 0(panel 會 render 為 —)。"""
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-16", a_buy=10, a_sell=0, a_buy_price=100, a_sell_price=0,
                 b_buy=20, b_sell=0, b_buy_price=110, b_sell_price=0),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-16", days=1,
        trading_dates=["2026-06-16"], summaries=summaries,
    )
    a = next(b for b in out["top_brokers"] if b["broker_id"] == "A")
    assert a["avg_sell_price"] == 0
    assert a["sell"] == 0


def test_aggregate_margin_change_sums_balance_takes_end_date():
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-16", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0,
                 margin_change=5, margin_balance=1000, short_balance=50),
        _summary("2026-06-17", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0,
                 margin_change=3, margin_balance=1003, short_balance=47),
        _summary("2026-06-18", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0,
                 margin_change=2, margin_balance=1005, short_balance=45),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-18", days=3,
        trading_dates=[s["date"] for s in summaries], summaries=summaries,
    )
    # change = N 天累加
    assert out["margin"]["margin_purchase"]["change"] == 10  # 5+3+2
    # balance / limit / ratio = end_date 的值
    assert out["margin"]["margin_purchase"]["balance"] == 1005
    assert out["margin"]["short_sale"]["balance"] == 45
    assert out["margin"]["short_balance_ratio"] == pytest.approx(45 / 1005 * 100, abs=0.01)


def test_aggregate_institutional_sums_each_side():
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-16", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0,
                 foreign_buy=100, foreign_sell=50),
        _summary("2026-06-17", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0,
                 foreign_buy=80, foreign_sell=120),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-17", days=2,
        trading_dates=[s["date"] for s in summaries], summaries=summaries,
    )
    assert out["institutional"]["foreign"]["buy"] == 180
    assert out["institutional"]["foreign"]["sell"] == 170
    assert out["institutional"]["foreign"]["net"] == 10


def test_aggregate_total_traded_lots_formula():
    """total_traded_lots = floor(Σ(broker.buy + broker.sell) / 2)
    (sum buy + sell counts every traded lot twice — once as buy, once as sell)
    """
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-16", a_buy=100, a_sell=50, a_buy_price=100, a_sell_price=100,
                 b_buy=30, b_sell=20, b_buy_price=100, b_sell_price=100),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-16", days=1,
        trading_dates=["2026-06-16"], summaries=summaries,
    )
    # (100+50+30+20) / 2 = 100
    assert out["total_traded_lots"] == 100


def test_aggregate_sorts_top_brokers_by_abs_net_desc():
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-16", a_buy=10, a_sell=2, a_buy_price=100, a_sell_price=100,
                 b_buy=2, b_sell=500, b_buy_price=100, b_sell_price=100),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-16", days=1,
        trading_dates=["2026-06-16"], summaries=summaries,
    )
    # B 的 |net| = 498, A 的 |net| = 8 → B 排前面
    assert out["top_brokers"][0]["broker_id"] == "B"
    assert out["top_brokers"][1]["broker_id"] == "A"


def test_aggregate_actual_days_reflects_input():
    from services.finmind import _aggregate_brokers_window

    summaries = [
        _summary("2026-06-17", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0),
        _summary("2026-06-18", a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0),
    ]
    out = _aggregate_brokers_window(
        symbol="2330", date_str="2026-06-18", days=10,
        trading_dates=["2026-06-17", "2026-06-18"], summaries=summaries,
    )
    assert out["actual_days"] == 2
    assert out["window_days"] == 10
    assert out["trading_dates"] == ["2026-06-17", "2026-06-18"]
    assert out["date"] == "2026-06-18"
    assert out["symbol"] == "2330"


# ---------------------------------------------------------------------------
# fetch_brokers_window orchestration
# ---------------------------------------------------------------------------


def _mock_trading_calendar(dates_iso: list[str]):
    """Return an AsyncMock that mimics get_trading_days behavior.

    `dates_iso` is the full available calendar (ascending). The mock filters
    to dates ≤ end_date, takes the last n, returns newest-first — same
    contract as services.trading_calendar.get_trading_days.
    """
    available = [date.fromisoformat(d) for d in dates_iso]

    async def fake(end_date: date, n: int) -> list[date]:
        eligible = [d for d in available if d <= end_date]
        return list(reversed(eligible[-n:]))

    return AsyncMock(side_effect=fake)


@pytest.mark.asyncio
async def test_fetch_brokers_window_picks_last_n_trading_days(monkeypatch):
    """Calendar 有 10 個 trading days,days=3 → 取最後 3 個。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = [f"2026-06-{i:02d}" for i in range(10, 20)]  # 10 個 days
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()
    summaries_returned: list[dict] = []

    async def fake_summary(symbol: str, d: str, refresh: bool) -> dict:
        s = _summary(d, a_buy=10, a_sell=2, a_buy_price=100, a_sell_price=101)
        summaries_returned.append(s)
        return s
    client.fetch_chip_summary = AsyncMock(side_effect=fake_summary)

    out = await client.fetch_brokers_window("2330", "2026-06-19", days=3)
    assert out["trading_dates"] == ["2026-06-17", "2026-06-18", "2026-06-19"]
    assert client.fetch_chip_summary.await_count == 3
    # date arg passed
    called_dates = [c.args[1] for c in client.fetch_chip_summary.await_args_list]
    assert called_dates == ["2026-06-17", "2026-06-18", "2026-06-19"]


@pytest.mark.asyncio
async def test_fetch_brokers_window_filters_dates_after_anchor(monkeypatch):
    """選 2026-06-15 為 end_date,calendar 有到 2026-06-19 → 應該只取 ≤15 的部分。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15",
             "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()
    client.fetch_chip_summary = AsyncMock(
        side_effect=lambda symbol, d, refresh: _summary(
            d, a_buy=1, a_sell=0, a_buy_price=100, a_sell_price=0,
        ),
    )

    out = await client.fetch_brokers_window("2330", "2026-06-15", days=10)
    # 取 ≤ 2026-06-15 的最後 10 個(實際只有 4 個)
    assert out["trading_dates"] == ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15"]
    assert out["actual_days"] == 4


@pytest.mark.asyncio
async def test_fetch_brokers_window_raises_when_no_summaries(monkeypatch):
    """Calendar 沒有任何 trading day ≤ anchor → raise ValueError。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    # All calendar dates > anchor 2026-06-15
    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar(["2026-06-20", "2026-06-21"]),
    )

    client = FinMindClient()
    client.fetch_chip_summary = AsyncMock()

    with pytest.raises(ValueError, match="brokers_window"):
        await client.fetch_brokers_window("2330", "2026-06-15", days=10)
    client.fetch_chip_summary.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_brokers_window_skips_failed_summaries(monkeypatch):
    """單日 fetch_chip_summary 失敗(回 Exception)→ 其他天還能 aggregate。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = ["2026-06-17", "2026-06-18", "2026-06-19"]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()

    async def fake_summary(symbol: str, d: str, refresh: bool) -> dict:
        if d == "2026-06-18":
            raise RuntimeError("upstream blip")
        return _summary(d, a_buy=10, a_sell=2, a_buy_price=100, a_sell_price=101)
    client.fetch_chip_summary = AsyncMock(side_effect=fake_summary)

    out = await client.fetch_brokers_window("2330", "2026-06-19", days=3)
    # actual_days reflects all 3 selected, but aggregate uses only 2 successes
    assert out["actual_days"] == 3
    a = next(b for b in out["top_brokers"] if b["broker_id"] == "A")
    assert a["buy"] == 20  # 10 + 10 (失敗那天 skipped)


@pytest.mark.asyncio
async def test_fetch_brokers_window_passes_refresh_through(monkeypatch):
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    calendar_mock = _mock_trading_calendar(["2026-06-19"])
    monkeypatch.setattr(tc, "get_trading_days", calendar_mock)

    client = FinMindClient()
    client.fetch_chip_summary = AsyncMock(
        return_value=_summary("2026-06-19", a_buy=1, a_sell=0,
                              a_buy_price=100, a_sell_price=0),
    )

    await client.fetch_brokers_window("2330", "2026-06-19", days=10, refresh=True)
    # Trading calendar is independent of per-day data freshness; no refresh param
    calendar_mock.assert_awaited_once_with(date(2026, 6, 19), n=10)
    client.fetch_chip_summary.assert_awaited_once_with("2330", "2026-06-19", True)


@pytest.mark.asyncio
async def test_fetch_brokers_window_does_not_pull_chip_history(monkeypatch):
    """Regression guard for the perf fix: brokers_window must NOT call
    fetch_chip_history (which cold-fetches 540-day major series ~24s)."""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar(["2026-06-19"]),
    )

    client = FinMindClient()
    client.fetch_chip_history = AsyncMock(
        side_effect=AssertionError("fetch_chip_history MUST NOT be called"),
    )
    client.fetch_chip_summary = AsyncMock(
        return_value=_summary("2026-06-19", a_buy=1, a_sell=0,
                              a_buy_price=100, a_sell_price=0),
    )

    await client.fetch_brokers_window("2330", "2026-06-19", days=10)
    client.fetch_chip_history.assert_not_called()


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------


WINDOW_PAYLOAD = {
    "symbol": "2330", "date": "2026-06-19", "window_days": 10,
    "trading_dates": ["2026-06-19"], "fetched_at": "2026-06-19T20:00:00",
    "top_brokers": [], "margin": {
        "margin_purchase": {"balance": 0, "change": 0, "limit": 0},
        "short_sale": {"balance": 0, "change": 0, "limit": 0},
        "short_balance_ratio": 0,
    },
    "institutional": {
        "foreign": {"buy": 0, "sell": 0, "net": 0},
        "trust": {"buy": 0, "sell": 0, "net": 0},
        "dealer": {"buy": 0, "sell": 0, "net": 0},
    },
    "total_traded_lots": 0, "actual_days": 1,
}


def test_route_brokers_window_default_days_is_10():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r = TestClient(app).get("/api/chip/2330/brokers_window?date=2026-06-19")
    assert r.status_code == 200
    mock.assert_awaited_once_with("2330", "2026-06-19", 10, False)


def test_route_brokers_window_with_days_30():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r = TestClient(app).get(
            "/api/chip/2330/brokers_window?date=2026-06-19&days=30",
        )
    assert r.status_code == 200
    mock.assert_awaited_once_with("2330", "2026-06-19", 30, False)


def test_route_brokers_window_with_refresh():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r = TestClient(app).get(
            "/api/chip/2330/brokers_window?date=2026-06-19&days=20&refresh=true",
        )
    assert r.status_code == 200
    mock.assert_awaited_once_with("2330", "2026-06-19", 20, True)


def test_route_brokers_window_days_too_small():
    """ge=1 allows 1 (single-day "today snapshot"); 0 / negative rejected."""
    with patch("routes.chip.get_finmind"):
        r0 = TestClient(app).get("/api/chip/2330/brokers_window?days=0")
        rneg = TestClient(app).get("/api/chip/2330/brokers_window?days=-1")
    assert r0.status_code == 422
    assert rneg.status_code == 422


def test_route_brokers_window_days_1_is_valid():
    """days=1 acts as today-only snapshot — wires to the new RangeSelector
    `1 日` preset; route must accept it."""
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r = TestClient(app).get(
            "/api/chip/2330/brokers_window?date=2026-06-19&days=1",
        )
    assert r.status_code == 200
    mock.assert_awaited_once_with("2330", "2026-06-19", 1, False)


def test_route_brokers_window_days_too_large():
    with patch("routes.chip.get_finmind"):
        r = TestClient(app).get("/api/chip/2330/brokers_window?days=61")
    assert r.status_code == 422


def test_route_brokers_window_days_boundaries():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r10 = TestClient(app).get(
            "/api/chip/2330/brokers_window?date=2026-06-19&days=10",
        )
        r60 = TestClient(app).get(
            "/api/chip/2330/brokers_window?date=2026-06-19&days=60",
        )
    assert r10.status_code == 200
    assert r60.status_code == 200


def test_route_brokers_window_default_date_is_today():
    """date 不傳走 today。"""
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r = TestClient(app).get("/api/chip/2330/brokers_window")
    assert r.status_code == 200
    # service 拿到的 date 不是空字串(應該被填成 today)
    call_args = mock.await_args.args
    assert call_args[1] != ""


def test_route_brokers_window_503_when_unavailable():
    """value error from service → 503(沿用 main.py 全域 handler)"""
    mock = AsyncMock(side_effect=ValueError("brokers_window_unavailable"))
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_brokers_window = mock
        r = TestClient(app).get("/api/chip/2330/brokers_window?date=2026-06-19")
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "brokers_window_unavailable"
