"""SC-7 / D2:/api/chip/{symbol} 系列 endpoints。

痛點:
- chip 邏輯走 services/finmind.py 18 個 fetch_*,任一 dataset 沒被 fake 接
  到 → silent [] → institutional 全 0 → 看 UI 以為「無資料」實際是 fixture
  漂移。本 test assert institutional foreign net != 0 強制 fake data 流通。
- broker_history 系列有 400 error contract(ids_required / too_many_ids)
  — frontend lib/api.ts 依賴解析 detail.error 字串,改契約直接破前端。
"""


async def test_chip_summary_returns_institutional_with_non_zero_net(client):
    """痛點:fixture 寫了 foreign_buy=5M / foreign_sell=4M,net 應是 1M。
    若 fake 接不到 dataset,net = 0 — 本 assert 抓 silent MISS。"""
    r = await client.get("/api/chip/2330?date=2026-06-26")
    assert r.status_code == 200
    body = r.json()
    inst = body.get("institutional", {})
    assert "foreign" in inst, f"institutional shape drift: {inst}"
    foreign_net = inst["foreign"]["net"]
    assert foreign_net == 1000, (
        f"expected foreign net == 5000 - 4000 = 1000 from fixture, got {foreign_net} — "
        "可能是 fake fixture 沒接到 InstitutionalInvestorsBuySellWide 路徑"
    )


async def test_chip_broker_history_ids_required_400(client):
    """R3-F11 鎖契約 — broker_history 缺 ids 必回 400 ids_required。
    Query param 名 `ids`(comma-separated),routes/chip.py:96 簽名鎖死。"""
    r = await client.get("/api/chip/2330/broker_history")
    assert r.status_code == 400
    assert r.json() == {"detail": {"error": "ids_required"}}


async def test_chip_broker_history_too_many_ids_400(client):
    """R3-F11 鎖契約 — broker_history > 20 ids 必回 400 too_many_ids。
    痛點:前端 ChipBrokersPanel 限制 selection ≤ 20,後端是 server-side
    guard;改 limit 必雙改,本 test 鎖 backend limit(routes/chip.py:103)。"""
    too_many = ",".join([f"B{i:03d}" for i in range(25)])
    r = await client.get(f"/api/chip/2330/broker_history?ids={too_many}")
    assert r.status_code == 400
    assert r.json() == {"detail": {"error": "too_many_ids"}}


async def test_chip_history_shape(client):
    """痛點:K 線 history endpoint 是 ChipKlineChart dep,空 array 直接造成
    UI 空白。fixture 寫了 127 weekday rows,assert 至少 50 確保接通。"""
    r = await client.get("/api/chip/2330/history")
    assert r.status_code == 200
    body = r.json()
    candles = body.get("candles", [])
    assert len(candles) >= 50, f"K-line history too short: {len(candles)} rows"
