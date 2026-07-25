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

## SC-2 before(2026-07-25 步驟 1d 結束時量,步驟 2 動 command 之前)

量法:
```
python ~/.claude/hooks/harness_load_estimate.py --profile <name> --scope main [--worst]
```

`<superpowers>` 解到:`C:\Users\USER\.claude\plugins\cache\claude-plugins-official\superpowers\6.2.0`
(user-scope 在役版本)。

> **v7 陷阱的實地驗證**:本次量測的 cwd = `~/.claude/hooks`,而 project-scope entry 的
> `projectPath` = `C:\Users\USER` **確實涵蓋該 cwd**。腳本仍解到 user-scope 的 6.2.0,
> 因為比對基準是 profile 宣告的 `project_root`(`C:/side-project/neigui`)而非 process cwd。
> 若當初照 v6 寫法用 cwd,這裡會解到非在役的 5.0.6,而兩版 SDD 的 SKILL.md 差距超過該檔
> 本身的一半 —— 降幅比值直接失真且不會被任何 gate 抓到。

| profile | scope | bytes |
|---|---|---|
| **feat-L-before** | main | **123,885** |
| feat-L-before | main `--worst` | 143,798 |
| feat-L-before | subagent(SC-2b)| 4,689 |
| mod-M-before | main | 48,111 |
| bug-before | main | 33,755 |
| refactor-before | main | 30,344 |
| perf-before | main | 43,916 |

**門檻**(SC-8 FAIL → §4.1 備案,SC-2 自 ≥30% 下修至 **≥ 5%**):
feat-L 的 main scope 改版後須 **≤ 117,690 bytes**。

> 把 SC-2 掛在 0a 是 v4 的順序矛盾,v5 已修正 —— 它的量法需要 1d 才建立的腳本。

### 量測過程中被 gate 擋下的一次真錯(留存為證據)

首次執行時 manifest 把 superpowers 路徑寫成 `<superpowers>/<name>/SKILL.md`,少了一層
`skills/`。腳本依「manifest 列了不存在的檔 → exit 非 0」拒絕輸出數字,五個 profile 中有四個
報錯。若當初設計成「找不到就跳過」,這四個 profile 會各自少算數萬 bytes 且**全部顯示為成功**,
而 before 側偏低會讓後續降幅百分比虛高。修正路徑後才得到上表數字。

---

## 反作弊聲明(§1)

本頁數字一經記錄**不得回頭修改**。SC-1 / SC-2 未達標時的唯一合法處置是停下回報 + user 三選一,**不准調門檻、不准調量法、不准縮 `-before` profile 的分母、不准回頭砍 §5 判為「核心」的規則**。
