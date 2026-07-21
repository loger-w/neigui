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
        "sector_rotation",
    ):
        assert k in body, f"market snapshot missing v2 key {k}: {list(body.keys())}"
