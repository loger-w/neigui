# 基準量測(遷移步驟 0a)

- 量測時間:2026-07-25
- 量測條件:**任何 harness 檔案改動之前**(僅 `settings.json` 的 `protect-harness` 除役與 `skillOverrides` 設定已先行,兩者不影響本頁任何數字)
- 對應 spec:`design.md` v12 §7 步驟 0a

---

## SC-1 before — 六個 command 檔總和

量法:
```powershell
Get-ChildItem ~/.claude/commands -Filter *.md |
  Where-Object { $_.Name -ne 'chore.md' } |
  Measure-Object Length -Sum
```

輸出:**Count = 6 / Sum = 41,224 bytes**

| 檔案 | bytes |
|---|---|
| feat.md | 20,938 |
| mod.md | 5,215 |
| perf.md | 4,159 |
| auto.md | 3,711 |
| refactor.md | 3,698 |
| bug.md | 3,503 |

**門檻**:降幅 ≥ 25% → 改版後 **≤ 30,918 bytes**。

---

## SC-4 before — hook 測試基準

量法(`cwd = ~/.claude/hooks`):
```
python -m pytest tests -q                                    → B
python -m pytest tests/test_harness_push_gate.py --collect-only -q → G
```

輸出:
- **B = 109 passed**(8 個測試檔)
- **G = 20 tests collected**

**門檻**:步驟 8 退役 `harness-push-gate.py` 與其測試檔後,步驟 11 要求 **passed ≥ 89 且 failed = 0**(不等式 —— 步驟 5、6 都紅先行會新增 case,等式必不成立)。

---

## SC-2 before — 尚未量測(依 spec 設計,非遺漏)

SC-2 的量法需要 `~/.claude/hooks/harness_load_estimate.py`,該腳本於**步驟 1d** 才建立。

依 v9 起的規定:**SC-2 的 before 在步驟 1d 結束、步驟 2 動 command 之前執行**,此時所有原始檔仍未改動,量到的就是改版前狀態,結果追加寫入本頁。

指令:
```
python ~/.claude/hooks/harness_load_estimate.py --profile feat-L-before --scope main
```

> 把 SC-2 掛在 0a 是 v4 的順序矛盾,v5 已修正。此處留白是刻意的,不是漏做。

---

## 反作弊聲明(§1)

本頁數字一經記錄**不得回頭修改**。SC-1 / SC-2 未達標時的唯一合法處置是停下回報 + user 三選一,**不准調門檻、不准調量法、不准縮 `-before` profile 的分母、不准回頭砍 §5 判為「核心」的規則**。
