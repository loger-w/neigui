# -*- coding: utf-8 -*-
"""populated market e2e fixture 生成器(chore/populated-market-e2e-fixture,2026-07-20)。

用途:重生 `backend/tests_e2e/fixtures/TaiwanStockPrice_universe_*.json`、
`TaiwanStockPrice_TAIEX_*.json` 與 tick snapshot 的加料欄位。
**fixture rotation(換 FAKE_TODAY)時必須連動重跑本腳本**:窗口 =
FAKE_TODAY − 198 天((lookback 60 + slow EMA 39) × 2,對齊
`sector_aggregation._derive_window`),改 `END` 後執行、舊窗口檔手動刪除。

手算基準(e2e M9 spec 的 assertion 依據,改任何常數要同步 spec):
- 前段:2330/2454 反相交錯 ±1(每日 1 up 1 down → rana 恆 0),其餘三檔恆值
- 末日:2330 +10 / 2454 +5 / 2412 +1(3 up)、2317 −10 / 3008 −20(2 down)
  → rana = 1000×(3−2)/5 = 200;前段 EMA 全 0 → McClellan = 200×(2/20 − 2/40) = 10.0
- ma20:2330/2454/2412 above、2317/3008 below
- 量:前段各 1,000,000 股;末日半導體 5M/2M = 2.50 hot、其他電子 1.3M/2M = 0.65 cold
- 額:末日 10e9 總額 → 半導體 60% / 其他電子 30% / 通信網路 10%
  (sector 歸屬含 finmind_realtime._PRIMARY_INDUSTRY_OVERRIDE:2317→其他電子、
  2412→通信網路)
- TAIEX 全窗恆值 17000 → divergence 嚴格新高不觸發、known_gaps 無 taiex_unavailable

執行:python scripts/gen-market-e2e-fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

FIX = Path(__file__).resolve().parent.parent / "backend" / "tests_e2e" / "fixtures"
START, END = "2025-12-10", "2026-06-26"  # END = FAKE_TODAY;START = END − 198d

BASE = {"2330": 1000.0, "2454": 1001.0, "2317": 900.0, "2412": 100.0, "3008": 500.0}
FINAL_DELTA = {"2330": +10.0, "2454": +5.0, "2317": -10.0, "2412": +1.0, "3008": -20.0}
FINAL_VOL = {
    "2330": 3_000_000,
    "2454": 2_000_000,
    "2317": 300_000,
    "2412": 1_000_000,
    "3008": 1_000_000,
}
FINAL_MONEY = {"2330": 4e9, "2454": 2e9, "2317": 1e9, "2412": 1e9, "3008": 2e9}
TICK_ENRICH = {
    "2330": {"change_rate": 0.009, "total_amount": 25_000_000_000, "volume_ratio": 2.5},
    "2454": {"change_rate": 0.005, "total_amount": 8_000_000_000, "volume_ratio": 1.8},
    "2317": {"change_rate": -0.012, "total_amount": 5_000_000_000, "volume_ratio": 0.3},
    "2412": {"change_rate": 0.003, "total_amount": 3_000_000_000, "volume_ratio": 1.0},
    "3008": {"change_rate": -0.02, "total_amount": 2_000_000_000, "volume_ratio": 0.6},
}


def main() -> None:
    cal_raw = json.loads(
        (FIX / "TaiwanFuturesDaily_TX_calendar.json").read_text(encoding="utf-8")
    )
    cal_rows = (
        cal_raw["data"] if isinstance(cal_raw, dict) and "data" in cal_raw else cal_raw
    )
    days = sorted({r["date"] for r in cal_rows if START <= r["date"] <= END})
    assert days and days[-1] == END, f"calendar 未涵蓋 END={END}: {days[-3:]}"
    print("trading days in window:", len(days))

    rows: list[dict] = []
    prev_close: dict[str, float] = {}
    for i, d in enumerate(days):
        is_final = i == len(days) - 1
        for sid, base in BASE.items():
            if is_final:
                close = prev_close[sid] + FINAL_DELTA[sid]
                vol = FINAL_VOL[sid]
                money = FINAL_MONEY[sid]
            else:
                if sid == "2330":
                    close = 1000.0 + (i % 2)  # 1000,1001,1000...
                elif sid == "2454":
                    close = 1001.0 - (i % 2)  # 反相:1001,1000,1001...
                else:
                    close = base
                vol = 1_000_000
                money = 1e9
            prev_close[sid] = close
            rows.append(
                {
                    "stock_id": sid,
                    "date": d,
                    "close": close,
                    "Trading_Volume": vol,
                    "Trading_money": money,
                }
            )
    (FIX / f"TaiwanStockPrice_universe_{START}_{END}.json").write_text(
        json.dumps({"data": rows}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("universe rows:", len(rows))

    taiex = [{"stock_id": "TAIEX", "date": d, "close": 17000.0} for d in days]
    (FIX / f"TaiwanStockPrice_TAIEX_{START}_{END}.json").write_text(
        json.dumps({"data": taiex}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("taiex rows:", len(taiex))

    tick_path = FIX / f"taiwan_stock_tick_snapshot_{END}.json"
    tick_raw = json.loads(tick_path.read_text(encoding="utf-8"))
    tick_rows = (
        tick_raw["data"]
        if isinstance(tick_raw, dict) and "data" in tick_raw
        else tick_raw
    )
    for r in tick_rows:
        r.update(TICK_ENRICH[r["stock_id"]])
    tick_path.write_text(
        json.dumps(tick_rows, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("tick enriched:", [(r["stock_id"], r["change_rate"]) for r in tick_rows])


if __name__ == "__main__":
    main()
