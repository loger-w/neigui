# perf/cold-start 驗證證據(2026-07-07)

## Phase 5|量測對照(同 Phase 1 方式:scripts/measure_startup.py)

| 量測 | Before | After | Δ |
|---|---|---|---|
| Local time-to-ready(real FinMind)median n=3 | 1.358s | **0.669s** | **-51%** |
| Local time-to-ready(FAKE_FINMIND)median n=3 | 0.661s | 0.669s | 無退化(±噪音) |

目標 <0.8s ✓。real ≈ fake = FinMind fetch 已完全脫離 startup critical path。

After 原始輸出:
```
[real] run 1/3: 0.705s / run 2/3: 0.669s / run 3/3: 0.657s → median 0.669s
[fake] run 1/3: 0.723s / run 2/3: 0.664s / run 3/3: 0.669s → median 0.669s
```

Prod 冷啟動 TTFB(baseline 4.88s,n=1)之對照:需 deploy 後量,
預期減去「US→TW TaiwanStockInfo fetch 序列在所有請求前」的段;
`/api/symbols/all` 第一發 e2e 時間 ≈ 不變(review P2 已限定宣稱範圍)。

## Phase 6|行為驗證

自動化(harness.json verify 全綠):
- backend pytest:484 passed, 1 skipped(479 → 484,+5 新測試)
- ruff:All checks passed
- frontend vitest:585 passed(changelog 條目加入後重跑仍綠)
- frontend build:成功
- e2e(fake mode 全套):23 passed, 2 skipped(M2/M3 既有 fixture 缺口,
  next-time.md 已列)— lifespan 屬基建層故全跑;API 契約零改動,
  依 e2e-conventions 豁免新增 spec

真實環境(real-mode uvicorn,scratchpad/realenv_edges.py):
```
ready=0.716s
[happy: search=2330]        GET /api/symbols?search=2330 -> 200, 1 row(台積電)
[edge: search absent]       GET /api/symbols            -> 422(既有 validation,route 簽名未動)
[edge: search=zzzz]         GET /api/symbols?search=zzzz -> 200, [](無匹配)
[all symbols non-empty]     GET /api/symbols/all        -> 200, 2741 rows
[regression: _meta/mode]    GET /api/_meta/mode         -> 200, {'fake': False, ...}
```
第一發 symbols 請求在 ready 後立刻打,正確等到共用背景載入完成回資料
(dedup + shield 路徑走真實環境)。

## TDD 紀錄

- RED:`test_lifespan_startup_not_blocked_by_symbols_load` 於舊 code 上
  TimeoutError 紅(hanging load 卡住 lifespan enter)→ 實作後綠。
- Mutation 驗證(證明測試會咬):
  1. 拿掉 `asyncio.shield` → `test_awaiter_cancel_does_not_cancel_shared_task` 紅 ✓
  2. 拿掉 loop-identity 判準 → `test_ensure_load_task_rebuilds_cross_loop_residue` 紅 ✓
  3. 改成永遠重建 task(無 dedup)→ `test_concurrent_ensure_loaded_shares_one_load` 紅(calls=2)✓
