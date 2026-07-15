# /perf warrant-api-load — Phase 1 baseline(2026-07-15)

## 量化目標(user 給定)

- 2330 權證 tab 首次開啟:冷(今日快照未 build)**≤ 5s**;熱(今日已有快照)**≤ 2s**
- 量測以 DevTools Network(`performance.getEntriesByType("resource")`)+ backend timing log 為準

## 量測環境(可重現步驟)

1. auto-verify 全綠後量測(pytest 703 passed / ruff clean / vitest 802 passed / build ✓)
2. Backend:`python -c "import logging,uvicorn; logging.basicConfig(level=logging.INFO); uvicorn.run('main:app', host='127.0.0.1', port=8000)"`(於 `backend/`;basicConfig 讓 service INFO timing log 可見 — uvicorn 預設吞 INFO)
3. Frontend:`npm run dev`(`frontend/`,:5173)
4. Chrome DevTools MCP:開 :5173 → 搜尋 2330 → 等 overview 載入 → 點「權證」tab
5. 時序:`performance.getEntriesByType("resource")` 取 `/api/*` 的 startTime/duration
6. 冷路徑重現:停 backend → `warrants_snapshot_latest.json` 改名 → 重啟 backend → 步驟 4
7. chip 主力冷路徑:挑無 `{sym}_*_major.json` cache 的標的(本次 2376),直 curl :8000 量 150d → 540d 序列

## Baseline 數字

### 權證 tab(2330,權證數 ~1,600;全市場快照 37,957 檔 / 838 標的)

| 情境 | /api/warrants/2330 | /quotes | tab 首開(wall) | 目標 | 判定 |
|---|---|---|---|---|---|
| 冷(今日快照未 build,17:17 量) | 43.5s | 46.2s | **≈ 46s** | ≤ 5s | ❌ 差 9 倍 |
| 熱(快照檔在、backend 冷啟,17:12 量) | 0.20s | 1.78s | **≈ 1.8s** | ≤ 2s | ⚠ 貼線 |
| 熱(backend mem 熱,17:15 量) | 0.02s | 0.35s | **≈ 0.4s** | ≤ 2s | ✓ |

### 冷 build 43.5s 的組成(backend log 17:17:35 → 17:18:19)

| 段 | 耗時 | 備註 |
|---|---|---|
| MI_INDEX 20260715 type=0999 | ~20s | **同時段 iv backfill 正在轟同一 TWSE host(節流嫌疑,Phase 2 驗)** |
| MI_INDEX 20260715 type=0999P | ~19s | 與上一個**序列**執行 |
| t187ap37_L + TPEx quts/close/issue | ~3.5s | 四個 fetch 全序列 |
| IV 反解 37,957 檔 + 組裝 | **0.5s** | 舊假設「63s = IV 反解」**證偽**(services.warrants INFO log:`in 0.5s`) |

### quotes 的組成

- 16 批 MIS 序列(MIS_BATCH_SIZE=100,S-6 保守序列)
- 盤中尾段(17:12)每批 ~70-200ms → 1.35s;盤後(17:15)每批 ~15ms → 0.35s
- 冷情境 quotes 46.2s = 等 snapshot build(inflight dedup 共用)+ 自身 ~2.7s

### chip 主力(分流併入量測)

| 情境 | major 150d | major 540d | 備註 |
|---|---|---|---|
| 熱(2330,370 個 day cache) | 0.64s | 0.35s | 只補今日 2-3 個 FinMind request |
| 冷(2376,0 個 day cache) | 2.4s | +6.5s | ~100 + ~260 個 FinMind requests(rate limiter 40/s);useChipData.ts 註解的 15/s → 24s 已過時 |

## 順帶觀察(Phase 2 線索)

1. **iv backfill 每次 backend 啟動都重掃**:對「永遠 empty」的日子(6/19、7/10 等週五都回 empty!)每次啟動重抓,單請求 5-25s,整條掃描持續數分鐘,佔 TWSE 節流窗
2. backfill 的 MI_INDEX 歷史請求疑似大量回空 — 要驗 MI_INDEX 歷史回溯是否真的可用(warrant_iv_history 註解宣稱 ≥3 年)
3. 主力 fan-out 每個新標的燒 ~360 FinMind requests(6% 時額)— latency OK 但配額成本高,540d 拖曳才抓的 /mod(已分流)會同時省配額
