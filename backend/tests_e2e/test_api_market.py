"""SC-7 / D4:/api/market/snapshot 單 endpoint payload shape(F17)。

痛點:
- routes/market.py 只暴露 ONE endpoint `/snapshot`,F17 round 1 抓到 design
  寫了 2 個(heatmap+leaderboard)。本 test 鎖死「就 1 個」+ 整 payload
  shape,改 endpoint structure 必雙改。
- MK-4(mod/batch-ui-update):經典檢視退役 — sectors / leaderboards 鍵不得
  殘留(舊 4-tab / index-row 過濾測試隨之移除;index 過濾改由
  tests/test_finmind_realtime.py 的 universe_size 斷言覆蓋)。
"""


async def test_market_snapshot_payload_shape(client):
    r = await client.get("/api/market/snapshot")
    assert r.status_code == 200
    body = r.json()
    for k in ("as_of", "stale", "is_trading_session"):
        assert k in body, f"market snapshot missing key {k}: {list(body.keys())}"
    # MK-4:經典檢視鍵不得殘留
    assert "sectors" not in body
    assert "leaderboards" not in body


async def test_market_snapshot_v2_keys(client):
    """痛點:前端 panel 依賴 universe meta + market-today 三欄位;後端 drop
    任一 key 前端 panel 全滅。三新鍵(index_strength / cap_tiers /
    sector_rotation)已接線出真值,但降級語意允許 null(SC-5),此測試只鎖
    存在性(值 shape 由 frontend market-types.test.ts contract lock,FAKE
    資料級由 e2e M9 lock)。"""
    r = await client.get("/api/market/snapshot")
    assert r.status_code == 200
    body = r.json()
    for k in (
        "universe_size",
        "excluded_count",
        "index_strength",
        "cap_tiers",
        "breadth",
        "sector_rotation",
    ):
        assert k in body, f"market snapshot missing v2 key {k}: {list(body.keys())}"


async def test_market_snapshot_breadth_counts(client):
    """MK-5/7 資料級:populated tick fixture 5 檔(2330 +0.90 / 2454 +0.50 /
    2412 +0.30 上漲;2317 −1.20 / 3008 −2.00 下跌,皆 twse、無漲跌停)。
    ex_tsmc(MK-1):2330 貢獻與指數漲跌同源可算 → 兩欄非 null。"""
    r = await client.get("/api/market/snapshot")
    body = r.json()
    breadth = body["breadth"]
    assert breadth is not None
    assert breadth["twse"]["up"] == 3
    assert breadth["twse"]["down"] == 2
    assert breadth["twse"]["limit_up"] == 0
    assert breadth["tpex"] == {"limit_up": 0, "up": 0, "flat": 0, "down": 0, "limit_down": 0}
    by_id = {row["stock_id"]: row for row in breadth["rows"]}
    assert by_id["2330"]["change_rate"] == 0.90
    assert by_id["2330"]["limit_up"] is False
    # MK-1:扣除台積電欄位存在且可算
    ex = body["index_strength"]["ex_tsmc"]
    assert ex["change_points"] is not None
    assert ex["change_rate"] is not None
