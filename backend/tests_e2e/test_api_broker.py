"""/api/broker/* contract(feat/broker-daily-flows SC-7;FAKE_TODAY=2026-06-26 Fri)。

痛點:
- 反查走專用 path(taiwan_stock_trading_daily_report + securities_trader_id),
  FAKE _get 靠 path-tail fallback + trader 過濾接通 — 任一環漂移 → silent []
  → 503,本檔資料級 assertion 抓 silent MISS。
- detail.error 字串是前端 __apiGet 契約;422 validation list 是「不在 error
  contract 內」的既有全站行為(design R4),兩者都要鎖。
"""

from __future__ import annotations


async def test_daily_flows_shape_and_aggregation(client):
    """痛點:fixture 手算基準 — 2330 買500張/賣100張 @1000/1005 →
    net_lots 400、net_amount 400,500,000;2412 獨特值 7777 張賣超(design R5
    防汙染:data_id fallback 若讓 chip 鏈吃到會以明確數字炸出)。"""
    r = await client.get("/api/broker/daily-flows", params={"broker_id": "9600"})
    assert r.status_code == 200
    body = r.json()
    for key in ("broker_id", "broker_name", "requested_date", "as_of_date",
                "no_trading_day", "stock_count", "fetched_at", "buy_top", "sell_top"):
        assert key in body, f"payload 缺 {key}"
    assert body["broker_id"] == "9600"
    assert body["broker_name"] == "富邦"
    assert body["as_of_date"] == "2026-06-26"
    assert body["no_trading_day"] is False
    assert body["stock_count"] == 3

    top = body["buy_top"][0]
    assert top["stock_id"] == "2330"
    assert top["buy_lots"] == 500 and top["sell_lots"] == 100
    assert top["net_lots"] == 400
    assert top["net_amount"] == 400_500_000

    sell = body["sell_top"][0]
    assert sell["stock_id"] == "2412"
    assert sell["net_lots"] == -7777


async def test_daily_flows_stock_name_joined_from_symbols(client):
    """痛點:名稱 join 走 routes.symbols(FAKE 下 TaiwanStockInfo env-gate 載入)
    — join 斷線時全空也能過 shape 測試,這裡鎖 2330 必須有名字。"""
    r = await client.get("/api/broker/daily-flows", params={"broker_id": "9600"})
    top = r.json()["buy_top"][0]
    assert top["stock_id"] == "2330"
    assert top["stock_name"] == "台積電"


async def test_daily_flows_unknown_broker_404(client):
    r = await client.get("/api/broker/daily-flows", params={"broker_id": "0000"})
    assert r.status_code == 404
    assert r.json() == {"detail": {"error": "broker_not_found"}}


async def test_daily_flows_invalid_date_400(client):
    """痛點:regex 擋不住 2026-02-31(design R2)— service 層 fromisoformat 收口。"""
    r = await client.get(
        "/api/broker/daily-flows", params={"broker_id": "9600", "date": "2026-02-31"},
    )
    assert r.status_code == 400
    assert r.json() == {"detail": {"error": "invalid_date"}}


async def test_daily_flows_missing_broker_id_422_validation_list(client):
    """痛點:缺必填參數走 FastAPI 422 validation list,不在 {"error": code}
    contract 內(design R4 既有全站行為)— 鎖住避免誤改成自訂 handler。"""
    r = await client.get("/api/broker/daily-flows")
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)


async def test_traders_search_by_name(client):
    """F-2:shape = {hits, total}(截斷可感知,前端以 total > hits 判定)。"""
    r = await client.get("/api/broker/traders", params={"search": "富邦"})
    assert r.status_code == 200
    body = r.json()
    assert {"broker_id": "9600", "broker_name": "富邦"} in body["hits"]
    assert body["total"] >= 3  # 9600 / 9604 / 9608
    assert body["total"] == len(body["hits"])  # fixture 目錄 < 50,不觸截斷


async def test_traders_missing_search_422(client):
    r = await client.get("/api/broker/traders")
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)
