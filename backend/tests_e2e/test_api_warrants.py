"""/api/warrants/* contract(FAKE fixtures 走完整 normalize/join/計算路徑)。

痛點:
- 快照 fixtures(fixtures/warrants/ 子目錄)是原始 upstream shape 縮樣,
  normalize 髒點(千分位/空字串/leading-space key/西元民國混用)在此實跑;
  假 payload 直塞 normalized shape 會讓 parser regression silent green。
- 前端 lib/api.ts 解析 detail.error 字串 — error code 改名直接破。
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_warrants_state(monkeypatch):
    """warrants/_quotes module-level state reset(mem 快照跨測試殘留會
    讓 CHIP_DATA_DIR=tmp_path 的隔離失效)。"""
    import services.warrant_quotes as wq
    import services.warrants as ws

    monkeypatch.setattr(ws, "_client", None)
    monkeypatch.setattr(ws, "_snapshot_mem", None)
    monkeypatch.setattr(ws, "_last_build_attempt", None)
    ws._inflight.clear()
    monkeypatch.setattr(wq, "_client", None)
    wq._inflight.clear()
    wq._cooldown.clear()


async def test_warrants_snapshot_happy_path(client):
    r = await client.get("/api/warrants/2330")
    assert r.status_code == 200
    body = r.json()
    assert body["as_of_date"] == "2026-06-26"  # FAKE_TODAY(fixture 對齊)
    ids = {w["warrant_id"] for w in body["warrants"]}
    # 5 calls + 1 put;已到期 030099 被 universe 過濾
    assert ids == {"030011", "030012", "030013", "030014", "030015", "03001P"}
    w12 = next(w for w in body["warrants"] if w["warrant_id"] == "030012")
    assert w12["kind"] == "call"
    assert w12["exercise_ratio"] == pytest.approx(0.05)  # 每仟 50.00 / 1000
    assert w12["iv_prev"] is not None  # EOD 反解真的跑
    assert "no_trading_day" not in body  # R1:快照不發 flag


async def test_warrants_empty_underlying(client):
    r = await client.get("/api/warrants/2412")
    assert r.status_code == 200
    assert r.json()["warrants"] == []  # SC-7 空狀態資料面


async def test_quotes_happy_path_computed_fields(client):
    r = await client.get("/api/warrants/2330/quotes")
    assert r.status_code == 200
    body = r.json()
    assert body["underlying_price"] == pytest.approx(1000.0)
    assert body["quote_date"] == "2026-06-26"
    assert body["quote_time"] == "13:30"
    q12 = body["quotes"]["030012"]
    # 資料級 assertion(2026-07-07 教訓:visibility-only 假綠)
    assert q12["price"] == pytest.approx(3.50)
    assert q12["iv"] is not None and q12["iv"] > 0
    assert q12["leverage"] is not None and q12["leverage"] > 0
    assert q12["spread_lev_ratio"] is not None
    assert q12["theo_price"] is not None
    assert q12["mispricing_label"] in ("cheap", "fair", "expensive")
    # 零成交檔(030015)走 mid,仍有計算欄
    q15 = body["quotes"]["030015"]
    assert q15["price"] == pytest.approx((1.05 + 1.15) / 2)


async def test_brokers_happy_path(client):
    r = await client.get("/api/warrants/030012/brokers")
    assert r.status_code == 200
    body = r.json()
    assert body["data_date"] == "2026-06-25"  # FAKE_TODAY-1(impl-R4)
    assert body["rows"][0]["broker_name"] == "凱基-台北"
    assert body["rows"][0]["net"] == 800


async def test_bad_symbol_400_both_paths(client):
    r = await client.get("/api/warrants/abc!!")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_symbol"
    r = await client.get("/api/warrants/0300123456789/brokers")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_symbol"
