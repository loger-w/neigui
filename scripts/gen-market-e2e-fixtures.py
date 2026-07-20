# -*- coding: utf-8 -*-
"""market-today-only e2e fixture 生成器(mod/market-today-only,2026-07-20)。

用途:重生 `backend/tests_e2e/fixtures/taiwan_stock_tick_snapshot_*.json` 的
加料欄位(個股 change_rate/total_volume/yesterday_volume + 001/101 指數 row)。

**EOD 窗口生成段(TaiwanStockPrice universe / TAIEX)已隨 market-today-only
移除**:market_breadth.py / sector_aggregation.py 整檔刪除,唯一 consumer
(_fetch_daily_prices_window per-day loop)不再存在。舊窗口 fixture 檔
(`TaiwanStockPrice_universe_*.json` / `TaiwanStockPrice_TAIEX_*.json`)與
MANIFEST 對應條目已同 commit 一併刪除。

手算基準(e2e M9 spec 的 assertion 依據,改任何常數要同步
`e2e/specs/market.spec.ts` M9):

- 001(加權)close=19820.0 change_price=-180.0 → prev_close=20000.0 →
  change_rate=-0.90%;101(櫃買)close=392.0 change_price=-8.0 →
  prev_close=400.0 → change_rate=-2.00%(皆自洽,spec R7 單位契約)。
- 個股 change_rate(百分比語意,R7):2330 +0.90 / 2454 +0.50 / 2317 -1.20 /
  2412 +0.30 / 3008 -2.00 — median(twse)=0.30 → twse spread=-0.90-0.30=-1.20
  (中小強於指數)。
- 貢獻點數(prev_close × Σ mv_i×chg_i/100 ÷ Σmv,twse Σmv=33.63e12):
  2330 +149.9 點(mv 最大 + chg 最大)/ 2454 +5.4 / 2412 +1.7 上漲側;
  2317 -17.8 / 3008 -4.5 下跌側。tpex 無 tpex-type 個股(fixture 5 檔皆
  TaiwanStockInfo type=twse)→ tpex 側 median/spread=null、contrib 側
  up/down 皆空陣列(非 null — 見 change-spec 執行報告「無法資料級的
  欄位」)。
- cap_tiers:mv 全 5 檔覆蓋 → 全落 top50(<50 檔門檻),avg_change_rate=
  (0.9+0.5-1.2+0.3-2.0)/5=-0.30、up_ratio=3/5=60%。mid100/rest 無樣本
  (fixture 僅 5 檔,非 boundary bug — 分桶邊界另有 test_market_today.py
  unit test 覆蓋 201 檔案例)。
- sector_rotation(taiwan_stock_industry_chain.json 3 產業 × 2 子產業):
  半導體業 avg=(0.5+0.9)/2=0.70(desc 最高,vol_ratio=(20M+30M)/(10M+20M)
  =1.67x hot)、電子零組件業 avg=(0.3-1.2)/2=-0.45(vol_ratio=0.44x cold)、
  光電業 avg=(-2.0+0.9)/2=-0.55(vol_ratio=1.07x)。

執行:python scripts/gen-market-e2e-fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

FIX = Path(__file__).resolve().parent.parent / "backend" / "tests_e2e" / "fixtures"
END = "2026-06-26"  # FAKE_TODAY / fixture 基準日

TICK_ENRICH = {
    "2330": {
        "change_rate": 0.9,
        "total_amount": 25_000_000_000,
        "volume_ratio": 2.5,
        "total_volume": 30_000_000,
        "yesterday_volume": 20_000_000,
    },
    "2454": {
        "change_rate": 0.5,
        "total_amount": 8_000_000_000,
        "volume_ratio": 1.8,
        "total_volume": 20_000_000,
        "yesterday_volume": 10_000_000,
    },
    "2317": {
        "change_rate": -1.2,
        "total_amount": 5_000_000_000,
        "volume_ratio": 0.3,
        "total_volume": 3_000_000,
        "yesterday_volume": 15_000_000,
    },
    "2412": {
        "change_rate": 0.3,
        "total_amount": 3_000_000_000,
        "volume_ratio": 1.0,
        "total_volume": 8_000_000,
        "yesterday_volume": 10_000_000,
    },
    "3008": {
        "change_rate": -2.0,
        "total_amount": 2_000_000_000,
        "volume_ratio": 0.6,
        "total_volume": 2_000_000,
        "yesterday_volume": 10_000_000,
    },
}

# SC-1(R12):001/101 指數 row — finmind_realtime 在 universe filter 之前從
# 原始 tick snapshot 抽取,不受 TaiwanStockInfo whitelist 約束。
INDEX_ROWS = {
    "001": {
        "stock_id": "001",
        "type": "INDEX",
        "date": END,
        "last_updated": f"{END} 13:30:00",
        "close": 19820.0,
        "change_price": -180.0,
        "change_rate": -0.9,
        "total_amount": 320_000_000_000,
    },
    "101": {
        "stock_id": "101",
        "type": "INDEX",
        "date": END,
        "last_updated": f"{END} 13:30:00",
        "close": 392.0,
        "change_price": -8.0,
        "change_rate": -2.0,
        "total_amount": 45_000_000_000,
    },
}


def main() -> None:
    tick_path = FIX / f"taiwan_stock_tick_snapshot_{END}.json"
    tick_raw = json.loads(tick_path.read_text(encoding="utf-8"))
    tick_rows = (
        tick_raw["data"]
        if isinstance(tick_raw, dict) and "data" in tick_raw
        else tick_raw
    )

    # 個股加料 — 就地更新既有 5 檔
    for r in tick_rows:
        enrich = TICK_ENRICH.get(r["stock_id"])
        if enrich:
            r.update(enrich)

    # 001/101 指數 row — 覆寫既有(若 rerun)或新增
    by_id = {r.get("stock_id"): r for r in tick_rows}
    for sid, row in INDEX_ROWS.items():
        if sid in by_id:
            by_id[sid].update(row)
        else:
            tick_rows.append(dict(row))

    tick_path.write_text(
        json.dumps(tick_rows, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("tick rows:", [(r["stock_id"], r.get("change_rate")) for r in tick_rows])


if __name__ == "__main__":
    main()
