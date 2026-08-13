"""Tests for the N-day bubble aggregate window (bubble-streak-screenshot SC-1/SC-2).

Endpoint:  GET /api/chip/{symbol}/bubble_window?date=...&days=N
Service:   FinMindClient.fetch_bubble_window + _aggregate_bubble_window

Strategy(結構抄 test_brokers_window.py):
- _aggregate_bubble_window 是純函式 → 直接餵 fixture bubbles,assert 輸出
- fetch_bubble_window 是 orchestration → mock services.trading_calendar.get_trading_days
  + mock fetch_chip_bubble,verify 取最後 N 個 trading days、fan-out 與 aggregate 正確
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app


# ---------------------------------------------------------------------------
# Fixtures — fetch_chip_bubble payload shape(finmind.py:254-268)
# ---------------------------------------------------------------------------


def _trade(broker: str, broker_id: str, price: float, buy: int, sell: int) -> dict:
    return {"broker": broker, "broker_id": broker_id, "price": price, "buy": buy, "sell": sell}


def _bubble(date_str: str, trades: list[dict]) -> dict:
    return {
        "symbol": "2330",
        "date": date_str,
        "fetched_at": f"{date_str}T20:00:00",
        "trades": trades,
    }


def _mock_trading_calendar(dates_iso: list[str]):
    """Mimic services.trading_calendar.get_trading_days:filter ≤ end_date,
    取最後 n 個,newest-first 回傳。"""
    available = [date.fromisoformat(d) for d in dates_iso]

    async def fake(end_date: date, n: int) -> list[date]:
        eligible = [d for d in available if d <= end_date]
        return list(reversed(eligible[-n:]))

    return AsyncMock(side_effect=fake)


# ---------------------------------------------------------------------------
# 1-5:純函式 _aggregate_bubble_window
# ---------------------------------------------------------------------------


def test_aggregate_sums_same_broker_price_across_days():
    """測試 1:兩日同 (broker_id, price) → buy/sell 加總,名稱取後日(分點改名)。"""
    from services.finmind import _aggregate_bubble_window

    bubbles = [
        _bubble("2026-06-25", [_trade("元大舊名", "9600", 1100.0, 100, 80)]),
        _bubble("2026-06-26", [_trade("元大新名", "9600", 1100.0, 50, 30)]),
    ]
    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=2,
        trading_dates=["2026-06-25", "2026-06-26"],
        bubbles=bubbles,
    )
    assert len(out["trades"]) == 1
    t = out["trades"][0]
    assert t["broker_id"] == "9600"
    assert t["price"] == 1100.0
    assert t["buy"] == 150
    assert t["sell"] == 110
    assert t["broker"] == "元大新名"


def test_aggregate_empty_broker_id_falls_back_to_name():
    """測試 2:broker_id 全程缺席 → 以 name 當 key;不同名不誤併。"""
    from services.finmind import _aggregate_bubble_window

    bubbles = [
        _bubble(
            "2026-06-25",
            [_trade("甲分點", "", 1100.0, 10, 5), _trade("乙分點", "", 1100.0, 20, 7)],
        ),
        _bubble("2026-06-26", [_trade("甲分點", "", 1100.0, 3, 1)]),
    ]
    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=2,
        trading_dates=["2026-06-25", "2026-06-26"],
        bubbles=bubbles,
    )
    by_name = {t["broker"]: t for t in out["trades"]}
    assert len(out["trades"]) == 2
    assert by_name["甲分點"]["buy"] == 13
    assert by_name["甲分點"]["sell"] == 6
    assert by_name["乙分點"]["buy"] == 20


def test_aggregate_mixed_broker_id_merges_to_single_row():
    """測試 3 [R8]:同名分點 day1 id=""、day2 id="9600" → 單一列不分裂。"""
    from services.finmind import _aggregate_bubble_window

    bubbles = [
        _bubble("2026-06-25", [_trade("元大", "", 1100.0, 100, 80)]),
        _bubble("2026-06-26", [_trade("元大", "9600", 1100.0, 50, 30)]),
    ]
    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=2,
        trading_dates=["2026-06-25", "2026-06-26"],
        bubbles=bubbles,
    )
    assert len(out["trades"]) == 1
    t = out["trades"][0]
    assert t["broker_id"] == "9600"
    assert t["buy"] == 150
    assert t["sell"] == 110


def test_aggregate_single_day_is_passthrough():
    """測試 4:單日輸入 → 值原樣不變(只是換 payload 外殼)。"""
    from services.finmind import _aggregate_bubble_window

    trades = [
        _trade("甲分點", "A", 1100.0, 10, 5),
        _trade("乙分點", "B", 1101.0, 20, 7),
    ]
    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=5,
        trading_dates=["2026-06-26"],
        bubbles=[_bubble("2026-06-26", trades)],
    )
    assert sorted(out["trades"], key=lambda t: t["price"]) == trades


def test_aggregate_output_shape():
    """測試 5:top-level 欄位齊(ChipBubbleData 超集)。"""
    from services.finmind import _aggregate_bubble_window

    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=5,
        trading_dates=["2026-06-25", "2026-06-26"],
        bubbles=[
            _bubble("2026-06-25", [_trade("甲", "A", 1100.0, 1, 0)]),
            _bubble("2026-06-26", [_trade("甲", "A", 1100.0, 1, 0)]),
        ],
    )
    assert out["symbol"] == "2330"
    assert out["date"] == "2026-06-26"
    assert out["window_days"] == 5
    assert out["trading_dates"] == ["2026-06-25", "2026-06-26"]
    assert out["actual_days"] == 2
    assert out["fetched_at"]
    assert isinstance(out["trades"], list)


def test_aggregate_actual_days_excludes_empty_trade_days():
    """[R17] 空 trades 日不計入 actual_days(停牌 / 無成交日 FinMind 回 200 + [])。"""
    from services.finmind import _aggregate_bubble_window

    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=3,
        trading_dates=["2026-06-24", "2026-06-25", "2026-06-26"],
        bubbles=[
            _bubble("2026-06-24", [_trade("甲", "A", 1100.0, 1, 0)]),
            _bubble("2026-06-25", []),
            _bubble("2026-06-26", [_trade("甲", "A", 1100.0, 2, 0)]),
        ],
    )
    assert out["actual_days"] == 2
    assert out["trades"][0]["buy"] == 3


# ---------------------------------------------------------------------------
# [review-1 AGG-NAME-TO-ID-AMBIGUITY] name → id 對映的歧義處理
# ---------------------------------------------------------------------------


def test_aggregate_ambiguous_name_two_ids_does_not_merge_empty_id_day(caplog):
    """案例 A:同一名稱對到兩個不同 broker_id → 該 name 的對映不可用。

    痛點:name_to_id 是「後日蓋前日」的單值表,同名兩 id 時只會留最後一個,
    之後那些「缺 id」的成交會被無聲併進最後那個 id 的列(錯併 = 假的分點行為)。
    寧可不併(多一列)也不錯併(把 A2 的量算到 A1 頭上)。
    """
    from services.finmind import _aggregate_bubble_window

    bubbles = [
        _bubble(
            "2026-06-25",
            [_trade("甲分點", "A1", 1100.0, 10, 0), _trade("甲分點", "A2", 1100.0, 20, 0)],
        ),
        _bubble("2026-06-26", [_trade("甲分點", "", 1100.0, 5, 0)]),
    ]
    with caplog.at_level(logging.WARNING, logger="services.finmind"):
        out = _aggregate_bubble_window(
            symbol="2330",
            date_str="2026-06-26",
            days=2,
            trading_dates=["2026-06-25", "2026-06-26"],
            bubbles=bubbles,
        )
    # 三列:A1 / A2 / 缺 id 那筆自成一列(不錯併)
    assert len(out["trades"]) == 3
    assert sorted(t["buy"] for t in out["trades"]) == [5, 10, 20]
    by_id = {t["broker_id"]: t for t in out["trades"]}
    assert by_id["A1"]["buy"] == 10
    assert by_id["A2"]["buy"] == 20
    assert by_id[""]["buy"] == 5
    # 歧義要出現在 log(靜默降級 = 之後查不出量為何對不上)
    assert any("甲分點" in r.message for r in caplog.records if r.levelno >= logging.WARNING)


def test_aggregate_renamed_broker_with_missing_id_day_stays_split():
    """案例 B(characterization):分點改名 + 舊名那天缺 id → 分裂為兩列。

    現行為固定:name→id 對映只從「有 id 的成交」建表,舊名那天既無 id、
    新表也沒有舊名的 entry,無從得知兩者是同一分點。此測試把這個已知極限
    釘住 —— 之後若有人加「名稱模糊比對」而讓它悄悄合併,這裡會紅並強迫
    重新討論(合併準確度 vs 錯併風險)。
    """
    from services.finmind import _aggregate_bubble_window

    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=2,
        trading_dates=["2026-06-25", "2026-06-26"],
        bubbles=[
            _bubble("2026-06-25", [_trade("元大舊名", "", 1100.0, 10, 0)]),
            _bubble("2026-06-26", [_trade("元大新名", "B1", 1100.0, 5, 0)]),
        ],
    )
    assert len(out["trades"]) == 2
    by_name = {t["broker"]: t for t in out["trades"]}
    assert by_name["元大舊名"]["buy"] == 10
    assert by_name["元大舊名"]["broker_id"] == ""
    assert by_name["元大新名"]["buy"] == 5
    assert by_name["元大新名"]["broker_id"] == "B1"


def test_aggregate_name_equal_to_other_broker_id_does_not_collide():
    """案例 C:A 分點的**名稱**恰等於 B 分點的 **broker_id** → 不得互撞。

    痛點:key 是 `(norm_id or broker, price)`,id 與 name 共用同一個 namespace,
    所以「名稱 9600 的無 id 分點」與「id 9600 的分點」會撞成同一列(量相加)。
    key 加上來源標籤(id / name)後兩者永遠分開。
    """
    from services.finmind import _aggregate_bubble_window

    out = _aggregate_bubble_window(
        symbol="2330",
        date_str="2026-06-26",
        days=1,
        trading_dates=["2026-06-26"],
        bubbles=[
            _bubble(
                "2026-06-26",
                [
                    _trade("9600", "", 1100.0, 10, 0),
                    _trade("元大", "9600", 1100.0, 20, 0),
                ],
            ),
        ],
    )
    assert len(out["trades"]) == 2
    by_name = {t["broker"]: t for t in out["trades"]}
    assert by_name["9600"]["buy"] == 10
    assert by_name["元大"]["buy"] == 20


# ---------------------------------------------------------------------------
# 6, 8-11:fetch_bubble_window orchestration
# ---------------------------------------------------------------------------


async def test_fetch_bubble_window_picks_last_n_trading_days(monkeypatch):
    """測試 6:happy path — 取最後 N 個交易日、逐日 fan-out、聚合輸出。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = [f"2026-06-{i:02d}" for i in range(10, 20)]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    out = await client.fetch_bubble_window("2330", "2026-06-19", days=3)
    assert out["trading_dates"] == ["2026-06-17", "2026-06-18", "2026-06-19"]
    assert client.fetch_chip_bubble.await_count == 3
    called_dates = [c.args[1] for c in client.fetch_chip_bubble.await_args_list]
    assert called_dates == ["2026-06-17", "2026-06-18", "2026-06-19"]
    assert out["window_days"] == 3
    assert out["actual_days"] == 3
    assert out["trades"] == [_trade("甲", "A", 1100.0, 30, 24)]


async def test_fetch_bubble_window_raises_when_calendar_empty(monkeypatch):
    """測試 8(前半):calendar 無任何 ≤ anchor 的交易日 → ValueError。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar(["2026-06-20", "2026-06-21"])
    )

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock()

    try:
        await client.fetch_bubble_window("2330", "2026-06-15", days=5)
    except ValueError as exc:
        assert str(exc) == "bubble_window_unavailable"
    else:
        raise AssertionError("expected ValueError bubble_window_unavailable")
    client.fetch_chip_bubble.assert_not_called()


async def test_fetch_bubble_window_raises_when_all_days_fail(monkeypatch):
    """測試 8(後半):所有日 fetch 都拋 → ValueError(不能靜默回空 payload,
    那會被使用者讀成「這幾天沒人交易」)。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar(["2026-06-25", "2026-06-26"])
    )

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock(side_effect=RuntimeError("upstream down"))

    try:
        await client.fetch_bubble_window("2330", "2026-06-26", days=2)
    except ValueError as exc:
        assert str(exc) == "bubble_window_unavailable"
    else:
        raise AssertionError("expected ValueError bubble_window_unavailable")


async def test_fetch_bubble_window_partial_failure_actual_days_4(monkeypatch):
    """測試 9 [R2]:5 日中 1 日 fetch 失敗 → 200,聚合只含成功日,actual_days == 4。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        if d == "2026-06-24":
            raise RuntimeError("upstream blip")
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    out = await client.fetch_bubble_window("2330", "2026-06-26", days=5)
    assert out["actual_days"] == 4
    assert out["trading_dates"] == dates
    assert out["trades"][0]["buy"] == 40
    assert out["trades"][0]["sell"] == 32


async def test_fetch_bubble_window_empty_trade_days_actual_days_3(monkeypatch):
    """測試 9b [R17]:5 日中 2 日回 {"trades": []} → 200,actual_days == 3。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        if d in ("2026-06-23", "2026-06-25"):
            return _bubble(d, [])
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    out = await client.fetch_bubble_window("2330", "2026-06-26", days=5)
    assert out["actual_days"] == 3
    assert out["trades"][0]["buy"] == 30


async def test_fetch_bubble_window_caches_aggregate_payload(monkeypatch):
    """測試 10(前半):過去日第二次呼叫吃 self-cache → 不再 fan-out。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    calendar_mock = _mock_trading_calendar(["2026-06-25", "2026-06-26"])
    monkeypatch.setattr(tc, "get_trading_days", calendar_mock)

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock(
        side_effect=lambda symbol, d, refresh: _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])
    )

    out1 = await client.fetch_bubble_window("2330", "2026-06-26", days=2)
    out2 = await client.fetch_bubble_window("2330", "2026-06-26", days=2)
    assert out1 == out2
    assert client.fetch_chip_bubble.await_count == 2
    assert calendar_mock.await_count == 1


async def test_fetch_bubble_window_refresh_bypasses_cache(monkeypatch):
    """測試 10(後半):refresh=True 跳過 self-cache 重新 fan-out,且 refresh
    傳進逐日 fetch_chip_bubble。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar(["2026-06-25", "2026-06-26"])
    )

    client = FinMindClient()
    seen_refresh: list[bool] = []

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        seen_refresh.append(refresh)
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    await client.fetch_bubble_window("2330", "2026-06-26", days=2)
    await client.fetch_bubble_window("2330", "2026-06-26", days=2, refresh=True)
    assert client.fetch_chip_bubble.await_count == 4
    assert seen_refresh == [False, False, True, True]


async def test_fetch_bubble_window_cache_write_failure_still_returns_result(monkeypatch):
    """測試 11:cache 寫失敗(磁碟滿 / 唯讀)→ 仍回聚合結果,不 500。"""
    from services.finmind import FinMindClient
    import services.finmind as fm_mod
    import services.trading_calendar as tc

    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(["2026-06-26"]))

    def boom(*_a, **_kw):
        raise OSError("simulated disk full")

    monkeypatch.setattr(fm_mod, "atomic_write_json", boom)

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock(
        return_value=_bubble("2026-06-26", [_trade("甲", "A", 1100.0, 10, 8)])
    )

    out = await client.fetch_bubble_window("2330", "2026-06-26", days=2)
    assert out["symbol"] == "2330"
    assert out["actual_days"] == 1


# ---------------------------------------------------------------------------
# [review-1] fix 波補測:降級結果不進 cache / dedup key / anchor / today TTL
# ---------------------------------------------------------------------------


async def test_fetch_bubble_window_partial_failure_is_not_cached(monkeypatch):
    """[BW-CACHE-PARTIAL-PERSIST] 部分日 fetch 失敗的降級聚合**不得**寫進永久
    cache —— 那會讓「某天上游抽風」被固化成該 (symbol, date, days) 的長期答案
    (過去日的 cache 無 TTL,重新整理以外永不復原)。

    降級結果照樣回給呼叫端(可用性優先),但下一次呼叫必須重新 fan-out。
    """
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        if d == "2026-06-24":
            raise RuntimeError("upstream blip")
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    out1 = await client.fetch_bubble_window("2330", "2026-06-26", days=5)
    assert out1["actual_days"] == 4
    assert client.fetch_chip_bubble.await_count == 5
    # 第二次呼叫:cache 沒被寫 → 重新 fan-out(await 次數翻倍)
    out2 = await client.fetch_bubble_window("2330", "2026-06-26", days=5)
    assert client.fetch_chip_bubble.await_count == 10
    assert out2["actual_days"] == 4


async def test_fetch_bubble_window_complete_window_is_cached(monkeypatch):
    """對照組:全日成功(含「回 200 + trades:[]」的無成交日)= 完整結果,
    照常寫 cache,第二次呼叫不再 fan-out。空 trades 不是失敗。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = ["2026-06-24", "2026-06-25", "2026-06-26"]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        if d == "2026-06-25":
            return _bubble(d, [])
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    await client.fetch_bubble_window("2330", "2026-06-26", days=3)
    assert client.fetch_chip_bubble.await_count == 3
    await client.fetch_bubble_window("2330", "2026-06-26", days=3)
    assert client.fetch_chip_bubble.await_count == 3


async def test_fetch_bubble_window_concurrent_refresh_does_not_dedup_into_non_refresh(
    monkeypatch,
):
    """[SC2-DEDUP-KEY-NO-TEST] lock test(移植 test_brokers_window.py:421):
    並發的 refresh=True 呼叫不得 await 一個 in-flight 的 refresh=False task,
    否則 refresh 呼叫端無聲拿到舊資料。防線 = _run_once dedup key 的
    `_r{int(refresh)}`;拿掉它兩個呼叫會塌成同一個 task。
    """
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar(["2026-06-25", "2026-06-26"])
    )

    client = FinMindClient()
    seen_refresh: list[bool] = []

    async def fake_bubble(symbol: str, d: str, refresh: bool) -> dict:
        # 讓兩個呼叫端都真的處在 in-flight 狀態才繼續
        await asyncio.sleep(0)
        seen_refresh.append(refresh)
        return _bubble(d, [_trade("甲", "A", 1100.0, 10, 8)])

    client.fetch_chip_bubble = AsyncMock(side_effect=fake_bubble)

    await asyncio.gather(
        client.fetch_bubble_window("2330", "2026-06-26", days=2, refresh=False),
        client.fetch_bubble_window("2330", "2026-06-26", days=2, refresh=True),
    )
    # 修復前:兩者共乘一個 task → 2;修復後:各自 fan-out → 4
    assert client.fetch_chip_bubble.await_count == 4
    assert True in seen_refresh and False in seen_refresh


async def test_fetch_bubble_window_filters_dates_after_anchor(monkeypatch):
    """[BACKEND-EDGE-TEST-GAPS a] lock test:anchor 落在 calendar 中段時,
    trading_dates 只能含 ≤ anchor 的交易日(往後看 = look-ahead,使用者選
    過去日期看到的量會混進之後幾天)。"""
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    dates = [
        "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15",
        "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19",
    ]
    monkeypatch.setattr(tc, "get_trading_days", _mock_trading_calendar(dates))

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock(
        side_effect=lambda symbol, d, refresh: _bubble(
            d, [_trade("甲", "A", 1100.0, 10, 8)]
        )
    )

    out = await client.fetch_bubble_window("2330", "2026-06-15", days=10)
    assert out["trading_dates"] == ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15"]
    assert out["actual_days"] == 4
    called_dates = [c.args[1] for c in client.fetch_chip_bubble.await_args_list]
    assert called_dates == ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15"]


async def test_fetch_bubble_window_today_fresh_cache_served(monkeypatch):
    """[BACKEND-EDGE-TEST-GAPS b-1] lock test:date = 今日且 cache 新鮮
    (< 30 min)→ 直接回 cache,不重新 fan-out。"""
    from services import clock
    from services.finmind import FinMindClient
    import services.trading_calendar as tc

    today = clock.today()
    prev = today - timedelta(days=1)
    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar([prev.isoformat(), today.isoformat()])
    )

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock(
        side_effect=lambda symbol, d, refresh: _bubble(
            d, [_trade("甲", "A", 1100.0, 10, 8)]
        )
    )

    await client.fetch_bubble_window("2330", today.isoformat(), days=2)
    assert client.fetch_chip_bubble.await_count == 2
    await client.fetch_bubble_window("2330", today.isoformat(), days=2)
    assert client.fetch_chip_bubble.await_count == 2  # 新鮮 → 不重抓


async def test_fetch_bubble_window_today_stale_cache_refetches(monkeypatch):
    """[BACKEND-EDGE-TEST-GAPS b-2] lock test:date = 今日且 cache 已逾 30 min
    → 重新 fan-out(盤中資料會變;沒有這條分支今日圖表會凍在早盤)。"""
    from services import clock
    from services.finmind import FinMindClient, _CACHE_VERSION_BUBBLE_W
    import services.trading_calendar as tc

    today = clock.today()
    prev = today - timedelta(days=1)
    monkeypatch.setattr(
        tc, "get_trading_days", _mock_trading_calendar([prev.isoformat(), today.isoformat()])
    )

    client = FinMindClient()
    client.fetch_chip_bubble = AsyncMock(
        side_effect=lambda symbol, d, refresh: _bubble(
            d, [_trade("甲", "A", 1100.0, 10, 8)]
        )
    )

    await client.fetch_bubble_window("2330", today.isoformat(), days=2)
    assert client.fetch_chip_bubble.await_count == 2

    cache_key = f"2330_{today.isoformat()}_w2_bubblew"
    cached = client._read_cache_v(cache_key, _CACHE_VERSION_BUBBLE_W)
    assert cached is not None
    cached["fetched_at"] = (
        clock.now() - timedelta(minutes=31)
    ).isoformat(timespec="seconds")
    client._write_cache_v(cache_key, cached, _CACHE_VERSION_BUBBLE_W)

    await client.fetch_bubble_window("2330", today.isoformat(), days=2)
    assert client.fetch_chip_bubble.await_count == 4  # stale → 重抓


# ---------------------------------------------------------------------------
# 7-8:route 層
# ---------------------------------------------------------------------------


WINDOW_PAYLOAD = {
    "symbol": "2330",
    "date": "2026-06-26",
    "window_days": 5,
    "trading_dates": ["2026-06-26"],
    "actual_days": 1,
    "fetched_at": "2026-06-26T20:00:00",
    "trades": [],
}


def test_route_bubble_window_default_days_is_5():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_bubble_window = mock
        r = TestClient(app).get("/api/chip/2330/bubble_window?date=2026-06-26")
    assert r.status_code == 200
    mock.assert_awaited_once_with("2330", "2026-06-26", 5, False)


def test_route_bubble_window_with_refresh():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_bubble_window = mock
        r = TestClient(app).get(
            "/api/chip/2330/bubble_window?date=2026-06-26&days=10&refresh=true"
        )
    assert r.status_code == 200
    mock.assert_awaited_once_with("2330", "2026-06-26", 10, True)


def test_route_bubble_window_days_out_of_range_422():
    """測試 7:days=1 → 422(單日走既有 /bubble 端點);days=21 → 422(payload 上限)。"""
    with patch("routes.chip.get_finmind"):
        r1 = TestClient(app).get("/api/chip/2330/bubble_window?date=2026-06-26&days=1")
        r21 = TestClient(app).get("/api/chip/2330/bubble_window?date=2026-06-26&days=21")
    assert r1.status_code == 422
    assert r21.status_code == 422


def test_route_bubble_window_days_boundaries_ok():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_bubble_window = mock
        r2 = TestClient(app).get("/api/chip/2330/bubble_window?date=2026-06-26&days=2")
        r20 = TestClient(app).get("/api/chip/2330/bubble_window?date=2026-06-26&days=20")
    assert r2.status_code == 200
    assert r20.status_code == 200


def test_route_bubble_window_default_date_is_today():
    mock = AsyncMock(return_value=WINDOW_PAYLOAD)
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_bubble_window = mock
        r = TestClient(app).get("/api/chip/2330/bubble_window")
    assert r.status_code == 200
    assert mock.await_args.args[1] != ""


def test_route_bubble_window_503_when_unavailable():
    """測試 8:service ValueError → 503 + detail.error 契約(main.py 全域 handler)。"""
    mock = AsyncMock(side_effect=ValueError("bubble_window_unavailable"))
    with patch("routes.chip.get_finmind") as gf:
        gf.return_value.fetch_bubble_window = mock
        r = TestClient(app).get("/api/chip/2330/bubble_window?date=2026-06-26")
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "bubble_window_unavailable"
