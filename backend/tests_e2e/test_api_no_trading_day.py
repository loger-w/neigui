"""SC-8 / D9:no_trading_day 雙端契約(R3-P0-URL-SHAPE / F18 options-only)。

痛點(/goal — discriminative):
- 週六(2026-06-27)必 no_trading_day=True + as_of_date=T-1=2026-06-26
- 週五(2026-06-26)必 no_trading_day=False/None(不可為 True)
   ← 沒這條 anti-test,可能假料下 endpoint 永遠 True(silent green for
     wrong reason)

R3-P0-URL-SHAPE 修正:真實 URL 是 `/api/options/max_pain?contract=TXO202607`
                  (path query),非 `/api/options/TXO/202607/max-pain` 路徑。
"""


async def test_options_max_pain_sat_returns_no_trading_day(client):
    """痛點:Sat 2026-06-27 必 no_trading_day:True + as_of=Fri 06-26。"""
    r = await client.get("/api/options/max_pain?contract=TXO202607&date=2026-06-27")
    assert r.status_code == 200
    body = r.json()
    assert body.get("no_trading_day") is True, (
        f"Sat 2026-06-27 should be no_trading_day:True, got: {body.get('no_trading_day')}"
    )
    assert body.get("as_of_date") == "2026-06-26", (
        f"Sat fallback should target T-1 Fri 2026-06-26, got: {body.get('as_of_date')}"
    )


async def test_options_max_pain_fri_is_trading_day(client):
    """痛點(anti-test):Fri 必須 NOT no_trading_day,否則代表 Sat test
    為 wrong reason 過(整個 endpoint 永遠回 True)。"""
    r = await client.get("/api/options/max_pain?contract=TXO202607&date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert not body.get("no_trading_day"), (
        f"Fri 2026-06-26 must NOT be no_trading_day, got: {body.get('no_trading_day')}"
        " — 表示 endpoint 對所有日期都回 True,Sat test 是 tautology"
    )
