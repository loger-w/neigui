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
    import services.warrant_iv_history as ivh

    monkeypatch.setattr(ivh, "_drift_mem", None)
    monkeypatch.setattr(ivh, "_rebuild_bg_task", None)
    ivh._series_lru.clear()
    ivh._inflight.clear()
    import services.warrant_flow as wfl

    wfl._inflight.clear()


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


async def test_warrants_rows_carry_iv_drift(client):
    # SC-4 contract:iv_drift 欄走 fixture → loader → drift 真計算路徑
    r = await client.get("/api/warrants/2330")
    assert r.status_code == 200
    by_id = {w["warrant_id"]: w for w in r.json()["warrants"]}
    assert by_id["030012"]["iv_drift"] == "declining"
    assert by_id["030013"]["iv_drift"] == "stable"
    assert by_id["030011"]["iv_drift"] == "insufficient"  # fixture 僅 5 日


async def test_iv_history_contract(client):
    # SC-5 contract:series 升冪 + drift 攤平 shape(前端 lib/api.ts 依賴)
    r = await client.get("/api/warrants/030012/iv-history")
    assert r.status_code == 200
    body = r.json()
    assert body["warrant_id"] == "030012"
    assert len(body["series"]) == 25
    dates = [p["date"] for p in body["series"]]
    assert dates == sorted(dates)
    assert body["series"][-1]["date"] == "2026-06-26"  # FAKE_TODAY
    assert body["series"][-1]["iv_bid"] == pytest.approx(0.35, abs=0.01)
    # 標的收盤序列(warrant-iv-redesign):FAKE fixture 的 s 直通 payload
    assert body["series"][-1]["underlying_close"] == pytest.approx(1000.0)
    assert body["drift"]["label"] == "declining"
    assert set(body["drift"]) == {"label", "slope_bid", "slope_ask", "n_valid"}
    assert body["terms_approx_dates"] == []


async def test_iv_history_unknown_warrant_404(client):
    r = await client.get("/api/warrants/039999/iv-history")
    assert r.status_code == 404
    assert r.json()["detail"]["error"] == "not_found"


async def test_flow_happy_path_shape_and_values(client):
    # SC-8 contract:FAKE 候選日 06-26(dump 空)→ 回退 06-25;probe + fan-out
    # 走 MANIFEST fixtures 真日期過濾路徑(資料級 assertion,防 visibility 假綠)
    r = await client.get("/api/warrants/2330/flow")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {
        "as_of_date", "truncated", "total_traded", "analyzed", "unmapped_count",
        "empty_reason", "summary", "top_buy_branches", "top_sell_branches", "warrants",
    }
    assert body["as_of_date"] == "2026-06-25"  # FAKE_TODAY−1(06-26 dump 空回退)
    assert "no_trading_day" not in body  # 預設查詢無 flag(design §2.4)
    assert body["total_traded"] == 3 and body["analyzed"] == 3
    assert body["truncated"] is False
    assert body["unmapped_count"] == 1  # 03998B 牛熊形狀
    assert body["empty_reason"] is None
    # 聚合數值(fixtures 手算:凱基 4080−120、元大 144−2268)
    assert body["summary"]["call"] == {"buy_value": 5046.0, "sell_value": 3003.0}
    assert body["summary"]["put"] == {"buy_value": 400.0, "sell_value": 100.0}
    top_buy = body["top_buy_branches"]
    assert top_buy[0]["broker_name"] == "凱基-台北"
    assert top_buy[0]["net_value"] == 3960.0
    assert [w["warrant_id"] for w in top_buy[0]["warrants"]] == ["030011", "030012"]
    assert body["top_sell_branches"][0]["broker_name"] == "元大-總公司"
    assert body["top_sell_branches"][0]["net_value"] == -2124.0
    assert [w["warrant_id"] for w in body["warrants"]] == ["030011", "030012", "03001P"]
    assert body["warrants"][0]["trading_money"] == 5000000
    assert body["warrants"][0]["kind"] == "call"


async def test_flow_explicit_date_no_trading_day(client):
    # 顯式 date 落週六 → 回退 + flag(NTD# e2e 同口徑;SC-8)
    r = await client.get("/api/warrants/2330/flow", params={"date": "2026-06-27"})
    assert r.status_code == 200
    body = r.json()
    assert body["as_of_date"] == "2026-06-25"
    assert body["no_trading_day"] is True


async def test_flow_no_warrants_empty(client):
    r = await client.get("/api/warrants/2412/flow")
    assert r.status_code == 200
    body = r.json()
    assert body["empty_reason"] == "no_warrants"
    assert body["as_of_date"] is None
    assert body["warrants"] == [] and body["top_buy_branches"] == []


async def test_flow_bad_date_400(client):
    for bad in ("2026/06/25", "2026-13-99"):
        r = await client.get("/api/warrants/2330/flow", params={"date": bad})
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "bad_date"


async def test_bad_symbol_400_all_paths(client):
    r = await client.get("/api/warrants/abc!!")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_symbol"
    # review P2 補鎖:/flow 原缺專屬 bad_symbol 契約證據(共用 _validate_id)
    r = await client.get("/api/warrants/abc!!/flow")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_symbol"
