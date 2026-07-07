"""SC-7 / D3:/api/options/* 五個 endpoints + error contracts(F11)。

痛點:
- TXO contract format(`<option_id><contract_date>` 串平)解析在
  routes/options.py::_resolve_contract — 過 7/15 timebomb 已由
  test_options_routes_clock anchor 鎖,本 test 鎖契約面。
- 5 個 endpoint 共享 contract_required / invalid_contract 錯誤 — 前端
  lib/api.ts 解析 detail.error,改命名直接破。
"""


async def test_max_pain_happy_path(client):
    r = await client.get("/api/options/max_pain?contract=TXO202607&date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert body["contract"] == "TXO202607"
    assert body["date"] == "2026-06-26"
    assert "current" in body
    assert "as_of_date" in body


async def test_max_pain_contract_required(client):
    """痛點:沒 contract param 必 400。"""
    r = await client.get("/api/options/max_pain")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "contract_required"


async def test_max_pain_invalid_contract(client):
    """痛點:傳不存在的 contract 必 400 invalid_contract;
    不可 silent 回 {}(會被 frontend 當成「無資料」)。"""
    r = await client.get("/api/options/max_pain?contract=TXO999999")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_contract"


async def test_oi_walls_happy(client):
    r = await client.get("/api/options/oi_walls?contract=TXO202607&date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert "current" in body


async def test_pcr_happy(client):
    """PCR 預設 all-scope happy path。"""
    r = await client.get("/api/options/pcr?date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert "current" in body or "scope" in body  # 鎖最小 shape


async def test_strike_volume_happy(client):
    r = await client.get("/api/options/strike_volume?contract=TXO202607&date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert "current" in body or "call" in body or "data" in body  # 最寬容 shape


async def test_oi_large_traders_happy(client):
    r = await client.get("/api/options/oi_large_traders?contract=TXO202607&date=2026-06-26")
    assert r.status_code == 200


async def test_retail_mtx_happy(client):
    """痛點:options-page-v2 SC-4 — 溫度計散戶格的資料通路;FAKE fixture
    (TaiwanFuturesDaily/法人 MTX)缺 MANIFEST 條目時這裡會 silent 空。"""
    r = await client.get("/api/options/retail_mtx?date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert body["current"] is not None
    assert -1.0 <= body["current"]["ratio"] <= 1.0
    assert len(body["series"]) > 0
    assert body["as_of_date"] == "2026-06-26"


async def test_foreign_futures_happy(client):
    """痛點:options-page-v2 SC-5 — 外資期貨對照行;net = long − short 契約。"""
    r = await client.get("/api/options/foreign_futures?date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    assert body["current"] is not None
    assert body["current"]["net_oi"] == (body["current"]["long_oi"] - body["current"]["short_oi"])
    assert len(body["series"]) > 0
