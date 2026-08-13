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


async def test_chip_bubble_window_shape(client):
    """SC-1 contract:bubble_window payload = ChipBubbleData 超集。
    痛點:前端 ChipBubbleWindowData extends ChipBubbleData —— 少任一欄
    (trades 元素的 broker_id / price)前端泡泡圖直接空白。"""
    r = await client.get("/api/chip/2330/bubble_window?date=2026-06-26&days=5")
    assert r.status_code == 200
    body = r.json()
    for key in ("symbol", "date", "fetched_at", "trades",
                "window_days", "trading_dates", "actual_days"):
        assert key in body, f"bubble_window payload missing {key}: {sorted(body)}"
    assert body["window_days"] == 5
    assert body["trades"], "fixture 應有 3 個分點,空 trades = fake fixture 沒接到"
    for key in ("broker", "broker_id", "price", "buy", "sell"):
        assert key in body["trades"][0], f"trade row missing {key}: {body['trades'][0]}"


async def test_chip_bubble_window_aggregates_five_days(client):
    """[R1] 聚合倍數 —— fixture 11 個交易日每日同值(BROKER00x / 1100.0 /
    買 100 張 / 賣 80 張),5 日窗口全落在覆蓋內 → 同 (broker_id, price) 列
    的 buy 必為單日 ×5。

    痛點:badge 出現 + 有泡泡在「沒真的切端點」「聚合寫成覆寫而非加總」兩種
    壞法下都會偽綠;倍數關係是唯一能分辨「真的加總了」的訊號。"""
    single = await client.get("/api/chip/2330/bubble?date=2026-06-26")
    assert single.status_code == 200
    day_row = single.json()["trades"][0]

    r = await client.get("/api/chip/2330/bubble_window?date=2026-06-26&days=5")
    assert r.status_code == 200
    body = r.json()
    win_row = next(
        t for t in body["trades"]
        if t["broker_id"] == day_row["broker_id"] and t["price"] == day_row["price"]
    )
    assert win_row["buy"] == day_row["buy"] * 5
    assert win_row["sell"] == day_row["sell"] * 5


async def test_chip_bubble_window_trading_dates_and_days_are_honoured(client):
    """[R21] 同質 fixture 下 ×5 分不出「取錯窗口日」「days 被寫死」——
    釘 trading_dates 實際日期 + 換 days=3 驗倍數同步變。"""
    r5 = await client.get("/api/chip/2330/bubble_window?date=2026-06-26&days=5")
    assert r5.status_code == 200
    body5 = r5.json()
    assert body5["trading_dates"] == [
        "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26",
    ]
    assert body5["actual_days"] == 5

    single = (await client.get("/api/chip/2330/bubble?date=2026-06-26")).json()["trades"][0]
    r3 = await client.get("/api/chip/2330/bubble_window?date=2026-06-26&days=3")
    assert r3.status_code == 200
    body3 = r3.json()
    assert body3["window_days"] == 3
    assert body3["trading_dates"] == ["2026-06-24", "2026-06-25", "2026-06-26"]
    row3 = next(
        t for t in body3["trades"]
        if t["broker_id"] == single["broker_id"] and t["price"] == single["price"]
    )
    assert row3["buy"] == single["buy"] * 3
