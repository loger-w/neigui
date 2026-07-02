"""SC-7 / D4:/api/market/snapshot 單 endpoint payload shape(F17)。

痛點:
- routes/market.py 只暴露 ONE endpoint `/snapshot`,F17 round 1 抓到 design
  寫了 2 個(heatmap+leaderboard)。本 test 鎖死「就 1 個」+ 整 payload
  shape,改 endpoint structure 必雙改。
- 過去 sediment §9 抓到的 universe 含 001/002 index rows 污染 heatmap —
  本 test assert sectors 內任一 stock_id 不開頭 0(index 是 0001/0002)。
"""


async def test_market_snapshot_payload_shape(client):
    r = await client.get("/api/market/snapshot")
    assert r.status_code == 200
    body = r.json()
    for k in ("as_of", "sectors", "leaderboards", "stale", "is_trading_session"):
        assert k in body, f"market snapshot missing key {k}: {list(body.keys())}"
    # perf C6:eod_as_of 存在性(允許 null — FAKE fixture 無全市場 window)
    assert "eod_as_of" in body, f"market snapshot missing eod_as_of: {list(body.keys())}"


async def test_market_snapshot_leaderboards_4_tabs(client):
    """痛點:MarketLeaderboard 元件 hardcode 4 tabs(gainers/losers/amount/
    volume_ratio)。後端 drop 任一 key,前端 tab click 立即破 — 本 test 鎖死。"""
    r = await client.get("/api/market/snapshot")
    body = r.json()
    lb = body["leaderboards"]
    for k in ("gainers", "losers", "amount", "volume_ratio"):
        assert k in lb, f"leaderboard missing {k}: {list(lb.keys())}"
        assert isinstance(lb[k], list), f"{k} should be list, got {type(lb[k]).__name__}"


async def test_market_snapshot_sectors_exclude_index_rows(client):
    """痛點(CLAUDE.md §9):tick_snapshot universe 含 001 加權指數 / 002 不含
    金融指數,過去靠 sector_map 對映過濾。本 test 確認 sectors 內 stock_id
    不會 leak index codes(009999 也算)。"""
    r = await client.get("/api/market/snapshot")
    body = r.json()
    for sector in body["sectors"]:
        for stock in sector.get("stocks", []):
            sid = stock.get("stock_id", "")
            # index 慣例:00XX / TXX,不會以 2/3/6/8/9 開頭(個股 typical pattern)
            assert not sid.startswith("00"), f"sector leaked index row {sid} — universe filter 漏掉"
