# SC-1 / edge 7 — API 真實環境證據(2026-08-13,dev :8000,真 FinMind)

## Happy path(SC-1)

- `GET /api/chip/2330/bubble_window?date=2026-08-12&days=5` → 200
  keys = actual_days, date, fetched_at, symbol, trades, trading_dates, window_days
  trades = 9,503;actual_days = 5(單日 /bubble 同日 4,095 rows → 5 日聚合 9,503,
  dedupe 生效:< 5×4,095)。

## Edge cases

- `days=1` → **422**(ge=2 下界)
- `days=21` → **422**(le=20 上界)
- 部分日失敗 / 全失敗 503 路徑:pytest 覆蓋(test_bubble_window.py),真實環境不可控
  觸發,不硬撞。

## Regression 抽查

- `GET /api/chip/2330/bubble?date=2026-08-12` → 200,keys = date, fetched_at,
  symbol, trades(**無** window 欄位)— 既有端點 payload 零改動(白名單 2)。

## Payload 量測(edge 7;高量股 3481,anchor 2026-08-12;門檻 = UTF-8 未壓縮 ≤ 10MB)

| days | UTF-8 bytes | trades rows | actual_days | 冷載耗時 |
|---|---|---|---|---|
| 20 | **18,139,504(18.1MB)超標** | 206,802 | 20 | 20.7s(冷 fan-out) |
| 10 | **12,807,409(12.8MB)超標** | 146,190 | 10 | warm |
| 5 | 5,476,222(5.5MB) | 62,601 | 5 | warm |

判定:**超標**(gzip middleware 另在,wire 實際 ~2MB 級,但門檻口徑是未壓縮)。
依 design §6.3 拍板路徑:**preset 降檔救不了 payload(10 日仍 12.8MB)→ 記
next-time slim 化**(候選:trades 改 columnar array / 截 top-N per price);
是否降 preset 由 §6.4 long task 門檻獨立裁決(見 real-env round JSON)。
量法:`[System.Text.Encoding]::UTF8.GetByteCount($r.Content)`(design R16,
Content.Length 是 UTF-16 char 數禁用)。
