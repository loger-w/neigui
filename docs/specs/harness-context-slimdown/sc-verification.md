# SC-1..SC-8 驗收(遷移步驟 11)

- 驗收日期:2026-07-25
- 對照基準:`baseline.md`(步驟 0a / 1d 記錄,任何 harness 改動前)
- 結論:**SC-1 / SC-3 / SC-4 / SC-5 / SC-7 通過;SC-8 FAIL(已走備案);SC-2 未達標;
  SC-6 未執行。** SC-2 依 §1 停下回報,交 user 三選一。

---

## 逐條結果

| SC | 門檻 | 實測 | 判定 |
|---|---|---|---|
| SC-1 | 六個 command 檔總和降幅 ≥ 25% | 41,224 → **29,891**(**−27.5%**)| **PASS** |
| SC-2 | feat-L 主 agent 窗口降幅 ≥ 5%(SC-8 FAIL 後的備案門檻)| 123,885 → **129,332**(**+4.4%,載入量不降反增**)| **FAIL** |
| SC-2b | subagent context,無門檻,只要求有數字 | 4,689 → **6,282**(+33.9%)| 已呈報 |
| SC-3 | `dispositions.json` 所有檢查通過 | `VIOLATIONS n=0`,exit 0(122 列 / 51 absent / 131 present)| **PASS** |
| SC-4 | hook 測試不退步:passed ≥ 89 且 failed = 0 | **130 passed / 0 failed** | **PASS** |
| SC-5 | `/code-review` 在 commands / skills / agents / harness/refs 的 `*.md` 命中數 = 0 | **0** | **PASS** |
| SC-6 | 真實 `/mod` 或 `/bug` 小案子跑完整流程 | **未執行** | **未達成** |
| SC-7 | 鏡像同步器涵蓋新路徑且非假綠 | `--check` exit 0;反向驗證 (a) DRIFT / (b) ORPHAN 分打兩側皆 exit 1 | **PASS** |
| SC-8 | `skillOverrides` 對 plugin skill 生效 | 五種 key×值組合全數無效(陽性對照排除管道不敏感)| **FAIL**(已走 §4.1 備案)|

量法指令與原始輸出見各節。

---

## SC-2 未達標 — 完整明細與根因

### 量測缺陷先講:`-before` profile 在改版後已失效

`--before feat-L-before --after feat-L` 在**改版後**跑會得到 `-23.17%` —— 那是**錯的**。
`-before` profile 列的是同一批實體檔路徑,command 檔一旦改寫,它量到的就是改寫**後**的
大小,不再是改版前狀態。

**正確做法**:分子用當下量測,分母用 `baseline.md` 在步驟 1d(所有原始檔未動時)記錄的
**123,885**。這是 spec 沒寫清楚的一個量法缺陷,已記入下輪待辦。

### 實測(spec 的計帳模型:同 path 多筆不去重)

| | before | after | 差 |
|---|---|---|---|
| feat-L main | 123,885 | **129,332** | **+5,447(+4.4%)** |
| feat-L subagent | 4,689 | 6,282 | +1,593 |

after 明細中最大的三筆:`subagent-driven-development` 28,077(佔 21.7%)、
`receiving-code-review` 6,203×3 = 18,609、`review-protocol.md` 4,019×3 = 12,057。

### 換另一種計帳模型,結論不變

擔心是「重複讀取不去重」這個模型放大了成本,所以另算一次**每個 path 只計一次**:

| 模型 | before | after | 差 |
|---|---|---|---|
| 不去重(spec 指定)| 123,885 | 129,332 | +4.4% |
| 去重(每檔只計一次)| 98,156 | 98,864 | +0.7% |

**兩種模型都是「沒有下降」。** 結論對計帳選擇不敏感,這比單一數字更有說服力。
(去重模型的 before 98,156 恰好與 design v11 changelog 推算的分母吻合。)

### 根因

1. **最大槓桿被封死**:SDD 的 28,077 bytes 佔 before 的 22.7%。§4.1 主線本要用
   `skillOverrides` 把它移出載入路徑,SC-8 實測該機制碰不到 plugin skill。改用負向指示
   後,依 F2「靠 prompt 自律的規則實測失守」,**誠實計入 after 側**,不當作已省下。
2. **搬進 refs 是換位置不是刪掉**(§2.1 明載)。feat.md 少掉的 9,744 bytes 幾乎原封不動
   出現在 refs;而 refs 依 phase 讀取,跨 phase 重複讀的部分反而讓總量微增。
3. 真正的淨刪只有 rationale 敘事與重疊條,量級遠小於 SDD。

### 沒有被 SC 捕捉到、但確實改善的部分

spec §1 已預告「真正的改善在**峰值**不在總量」,並刻意不另立 SC。實測峰值:

| phase | before | after | 差 |
|---|---|---|---|
| Phase 3(feat.md + TDD skill + SDD)| 58,030 | 51,248 | **−11.7%** |
| Phase 8(feat.md + branch-lifecycle)| 28,402 | 17,862 | **−37.1%** |

亦即:**Phase 4 時不必再扛著 Phase 8.5 的規則**這件事是真的,只是總量指標捕捉不到。

### 依 §1 的處置(不自行決定)

反作弊規則明文禁止兩條歪路(回頭砍 §5 判為核心的規則、縮 `-before` 分母),且
**不准自行調門檻或調量法**。因此停下回報,由 user 三選一:

1. **接受實際降幅**,記入 `feat-improvements.md`(SC-1 與峰值的改善是真的,總量不降也是真的)
2. **擴大 scope 納入常駐層**(本輪 Out of Scope 的下一輪:專案 / user CLAUDE.md、
   MEMORY.md、以及「superpowers 整支停用 + 把真正依賴的四支複製成專案 skill」這條)
3. **縮小 scope 重新設計**

---

## SC-6 未執行

需要一個真實 `/mod` 或 `/bug` 小案子跑完整流程並附 commit 清單 + 驗證輸出。
本輪改版本身雖然是在 `mod/harness-context-slimdown` 分支上、依 design 逐步執行,但
**並非透過改寫後的 `/mod` command 驅動**,拿它當 SC-6 證據是循環論證。列為未達成。

---

## 通過項的指令輸出

```
# SC-1
Get-ChildItem ~/.claude/commands -Filter *.md |
  Where-Object { $_.Name -ne 'chore.md' } | Measure-Object Length -Sum
→ Count = 6 / Sum = 29,891     (baseline: 6 / 41,224)

# SC-3
python ~/.claude/hooks/harness_load_estimate.py --verify-dispositions
→ VIOLATIONS n=0 ; exit 0

# SC-4
cd ~/.claude/hooks && python -m pytest tests -q
→ 130 passed          (門檻 passed ≥ B−G = 109−20 = 89,failed = 0)

# SC-5
grep -rn -- "/code-review" ~/.claude/{commands,skills,agents} --include='*.md' \
  ~/.claude/harness/refs/*.md
→ 0 命中
(RATIONALE.md 依 spec 不在掃描路徑內;cache/ backups/ feat-improvements.md 亦不在範圍)

# SC-7
python scripts/sync-harness-mirror.py --check       → exit 0「全部一致」
python -m pytest scripts/test_sync_harness_mirror_refs.py -k sc7   → 2 passed
  (a) 改壞來源 harness/refs/*.md      → build_pairs 的 DRIFT,exit 1
  (b) 鏡像側放無來源檔                → find_orphans 的 ORPHAN,exit 1
```
