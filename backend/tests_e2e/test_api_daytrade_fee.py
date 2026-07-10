"""FAKE mode contract test — /api/daytrade-fee(/feat daytrade-borrow-fee Wave 2)。

痛點:券差資料源是 TWSE/TPEx(非 FinMind),FAKE_FINMIND 三層架構管不到 —
service 自帶 fixtures/borrow_fee/ fake 分支,本檔鎖「fixture 驅動的整條
route 路徑」contract(shape + 排序 + 月次數),防 e2e (playwright BF#) 之下
的資料層 silent 空(options-page-v2 fixture 事故的教訓:資料級 assertion)。
Fixture 日期對齊 FAKE_TODAY=2026-06-26。
"""

from __future__ import annotations


async def test_daytrade_fee_shape_and_data(client):
    r = await client.get("/api/daytrade-fee")
    assert r.status_code == 200
    body = r.json()
    for k in ("as_of_date", "rows", "month_counts"):
        assert k in body, f"missing key {k}: {list(body.keys())}"
    # FAKE_TODAY=2026-06-26 當日 fixture 有料 → 無 no_trading_day
    assert body["as_of_date"] == "2026-06-26"
    assert "no_trading_day" not in body
    assert len(body["rows"]) >= 4  # twse 3 檔 + tpex 2 檔(資料級,防空表假綠)
    markets = {row["market"] for row in body["rows"]}
    assert markets == {"twse", "tpex"}, f"兩市場合併缺一: {markets}"


async def test_daytrade_fee_sorted_desc_and_month_counts(client):
    r = await client.get("/api/daytrade-fee")
    body = r.json()
    fees = [row["fee_rate"] for row in body["rows"]]
    assert fees == sorted(fees, reverse=True), f"預設費率降序破功: {fees}"
    # 8046 在 fixture 中出現於 06/24(兩筆)與 06/26 → distinct date = 2
    assert body["month_counts"]["8046"] == 2
