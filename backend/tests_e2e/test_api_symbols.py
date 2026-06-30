"""SC-7 / D5:/api/symbols + /api/symbols/all(F4 webServer probe path)。

痛點:
- playwright.config.ts webServer.url 走 /api/symbols?search=2,沒 200 → e2e
  suite 起不來。本 test 鎖死這條 probe 路徑。
- /api/symbols 應做 prefix match — 'search=2' 應該返 fixture 5 symbols 內 4
  個股號 (2330/2454/2317/2412)。0 結果 = symbol fixture 沒 wire 進來。
"""


async def test_symbols_query_prefix_match(client):
    r = await client.get("/api/symbols?search=2")
    assert r.status_code == 200
    results = r.json()
    sids = [s["symbol"] for s in results]
    # fixture 內 4 個 stock_id 開頭是 2(2330/2454/2317/2412)
    assert "2330" in sids, f"expected 2330 in results, got {sids}"
    assert "2317" in sids


async def test_symbols_all_returns_universe(client):
    r = await client.get("/api/symbols/all")
    assert r.status_code == 200
    results = r.json()
    # fixture 列了 5 個 twse symbols,全部 type=twse 應該都進
    sids = sorted(s["symbol"] for s in results)
    assert sids == ["2317", "2330", "2412", "2454", "3008"], f"universe drift: {sids}"


async def test_symbols_min_length_enforced(client):
    """痛點:min_length=1 contract — 0-length query 應 422 / 空 list,
    不可 leak 整 universe(隱私 + perf)"""
    r = await client.get("/api/symbols?search=")
    # FastAPI Query(min_length=1) raises 422
    assert r.status_code == 422
