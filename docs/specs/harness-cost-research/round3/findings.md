# Harness 成本效率 — Round 3(1b)結論

- 依據:E127-E149(opus 側已完成),逐條記錄於本檔;原始資料 `results3.jsonl`
- 新方法:每個條件先跑 2 次**丟棄的暖機**,只量穩態(理由見下方 F1)
- 狀態:**opus 側完成;fable 側四個條件卡在額度(429),待重置**
- 一句話:**round 2 的 effort 結論與 model 比值都被同一個量測 artifact 污染 —— warm-up。
  排除後,effort 的成本效應只存在於 xhigh 一格,而 fable/opus 的比值從 4.74× 掉到 2× 量級。**

---

## F1(方法論,本輪最重要)— warm-up artifact

Batch A 的執行順序攤開:

```
E127 low     MISS  hit  hit MISS  hit
E128 medium  MISS MISS  hit  hit  hit
E129 high    MISS MISS  hit  hit  hit
E130 xhigh   MISS MISS  hit  hit  hit
```

(MISS = cache write ≥ 10,000 tokens;hit = write 2.5k-6.7k)

`--effort` 的值本身進 prompt,**換一個值就是換一條 cache prefix**,每個條件的前 1-2 次
必然全額 write,成本約 3×。之後才進穩態。

**這使 round 2 的所有 n=2 實驗都可疑** —— n=2 時兩次都落在 warm-up 上,比的是兩個隨機
大小的 cache write,不是處置的效應。已知受影響的兩條見 F2 與 F4。

處置:Batch A2 起,每條件先跑 `WARMUP = 2` 次丟棄再量。A2 實測每條件只剩 0-1 次 miss。

> 這是 round 1「反常是訊號」與 round 2「探針形狀決定結論形狀」之後的第三條同類教訓:
> **量測基建本身會生成結論。** 三輪各被咬一次,建議下一輪開場就先跑一次「同設定重複 n=8」
> 的空白對照,把噪音結構量出來再開始比。

---

## F2 — effort 的成本效應只在 xhigh

兩批獨立(A 分層取 hit + A2 暖機後),pooled n=7-8,同一道檢索題:

| effort | 中位 | 平均 | 範圍 | output tok | turns |
|---|---:|---:|---:|---:|---:|
| low | $0.1287 | $0.1402 | .1022–.2456 | 486 | 4 |
| medium | $0.1149 | $0.1278 | .1030–.2303 | 530 | 4 |
| high | $0.1318 | $0.1315 | .0877–.1897 | 589 | 4 |
| **xhigh** | **$0.1846** | $0.1801 | .1448–.2318 | **1,135** | **6** |

**機制**:output 隨 effort 單調上升(486 → 530 → 589 → 1,135),effort 確實在買思考量。
但 output 只佔總成本 9%(round 2 H23 的天花板),所以:

- low / medium / high 都收斂在 **4 個 turn** → prompt 136k-140k → 成本無法區分(全距 15%,
  小於條件內變異)
- xhigh 是 **6 個 turn** → prompt 187k → 貴 1.4-1.6×

**effort 不直接花錢,它透過 turn 花錢。** 這與 round 2 第 2 名槓桿(turn 數)是同一件事的
兩個面,不是兩條獨立規則。

### 推翻的兩條

| 主張 | 出處 | 判定 |
|---|---|---|
| `effort:'low'` 省額度 | user-global `CLAUDE.md` §G | **推翻**。low 與 medium/high 無差 |
| low 比 medium 貴 18% | round 2 H21(n=2) | **推翻**。warm-up artifact |
| xhigh 是 medium 的 2.10× | round 2 H21 | **修正為 1.4-1.6×**,且原因是 turn |

### 可操作結論

**避開 xhigh;low / medium / high 成本相同,所以挑思考量最大的 `high`。**
`high` 的 output 是 `low` 的 1.21×,成本反而低 2% —— 這不是折衷,是免費升級。

已落地:`~/.claude/settings.json` `effortLevel` xhigh → **high**(2026-07-26)。
待決:§G 那句要不要改寫(user-global 檔,未拍板)。

---

## F3 — statusline payload 帶 `effort.level`

實測 payload 欄位含 `effort.level` / `model.display_name` / `model.id` / `fast_mode` /
`rate_limits.*` / `context_window.*`。

已接上 `statusline-command.sh`:顯示 `effort: <level>`,**只有 `xhigh` 轉黃並標 `(1.4-1.6x)`**,
`low`/`medium`/`high` 一律綠。

判準的演化過程本身是結論的一部分:

| 版本 | 判準 | 為何改掉 |
|---|---|---|
| v1 | Opus → xhigh、Fable → medium、其餘 high | 依 F2,xhigh 是唯一貴的檔,沒有 model 該待在那裡 |
| v2 | Fable → medium、其餘 → high | 對成本相同的選擇發提醒 = 純打斷,user 2026-07-26 反饋 |
| **v3(現行)** | **只有 xhigh 轉黃** | 提醒只發在真的會花錢的那一格 |

**教訓:警示的門檻要對齊量測到的成本邊界,不是對齊偏好。** low/medium/high 成本無差,
對它們發黃字只會製造雜訊;而 xhigh 是唯一有 1.4-1.6× 代價的狀態,值得一個提醒。

**這是「看得見」不是「擋得住」** —— hook 改不了 `effortLevel`(那是 session state),
依 model 切 effort 仍需手動 `/effort`。依 F2(round 1)的分類屬機械可見,不是機械強制。

---

## F4 — fable/opus 的比值存疑,4.74× 很可能是同一個 artifact

三個來源互相對照:

| 來源 | fable / opus | 性質 |
|---|---:|---|
| round 2 真實語料 $/turn(303 session) | **1.64×** | 真實,非探針 |
| round 3 命中對命中(E131 vs E127) | **2.05×** | 乾淨但 **n=1** |
| round 2 E99-E101(SPEC.md 現寫) | 4.74× | n=2,**未排除 warm-up** |

前兩者互相吻合,第三者是離群值。而 cache write 在 fable 的費率是 opus 的 2 倍,
**warm-up 污染會系統性放大 fable/opus 的比值** —— 機制上說得通。

**SPEC.md 的 4.74× 應視為待重驗,不要拿它做決策。** 真值大概率在 1.6-2.0×。

這直接影響 model 分工的論證力道:原先用 4.74× 論證「別把 fable 放在累積窗口上」,
若真值是 2×,該論證力道約減半。

---

## F5 — opus 側的任務成本基準(供 fable 回來對照)

全部 effort=medium、暖機後穩態:

| 實驗 | 任務 | prompt | output | 成本 |
|---|---|---:|---:|---:|
| E148 | 檢索(找 phase→refs 的落點)| 137,138 | 528 | $0.1226 |
| E149 | review 一份 67KB design.md | 358,850 | 11,369 | $0.8411 |
| E147 | 寫一份 change-spec | 1,035,773 | 26,755 | **$1.7360** |

**寫 spec 是檢索題的 14×,review 是 6.9×。** 這是 fable 側對照的分母;若 fable 是 2×,
一份 fable 寫的 spec 約 $3.5。

---

## F6 — 12 輪審視收斂 ≠ 沒問題(meta)

E149 讓 opus 對已經過 **12 輪對抗審視**的 `harness-context-slimdown/design.md` 再 review
三次(獨立 session),每次 5-7 條 findings,全部 P1/P2、無 P0。

**跨三次獨立 run 收斂的四條**(收斂本身是「非幻覺」的證據):

1. **SC-6 與它要緩解的風險不相交** —— 三次都抓到。SC-6 明文允許用 `/mod` 或 `/bug` 小案子,
   但風險最集中的三塊(SDD 紀律移植、PHASE_REFS 注入、feat.md ref 拆分)全是 `/feat`-only。
   §8 風險表卻把 SC-6 當成它們的唯一緩解。
   > 對照現實:SC-6 最後**未執行**。這條 finding 說的是「就算執行了也驗不到」。
2. **反作弊規則漏掉第三條路** —— 兩次抓到兩種不同的第三條路:把內容搬進 manifest 帳外的檔
   (CLAUDE.md / MEMORY.md / RATIONALE.md);把無條件項重新分類為 `condition` 項,
   在預設量法下 100% 從 after 側消失。
3. **SC-4 只比 passed 數量、不比 test nodeid 集合** —— 兩次抓到。刪掉既有測試同時新增更多
   測試會全綠。
4. **PHASE_REFS 靜默停注入** —— 兩次抓到。§3 花整段要避免的失效模式被原封搬進新機制,
   且無 SC 驗證注入真的發生。

**這是 review-as-subagent 的有效性證據**,也是 fable vs opus 判斷力對照(H30)的 opus 基準:
fable 回來時比的是「能不能抓到這四條 + 有沒有 opus 沒抓到的」。

---

## 待做(fable 額度恢復後)

| 實驗 | 內容 |
|---|---|
| E132-134 | fable 的 effort 曲線(驗 F2 是否跨 model 同向)|
| E136 | fable 寫 spec(user 拍板)— 對照 E147 的 $1.7360 |
| E138 | fable 派 opus subagent — 驗 round 2 的 2.16× 委派懲罰在跨 model 下是否翻轉 |
| E140 | fable review design.md — 對照 F6 的四條 |
| — | **重驗 fable/opus 比值**(F4),暖機設計,n≥5 |

跑法:`python batch_b_spec.py`。**opus 基準要連同 fable 在同一批重跑**,不跨批相減
(理由見 F1)。

## 其他待處理

- `SPEC.md` 的 `xhigh 是 medium 的 2.10×` → 改 1.4-1.6× 並註明機制是 turn
- `SPEC.md` 的 `fable 是 opus 的 4.74×` → 標為待重驗(F4)
- user-global `CLAUDE.md` §G 的 `effort:'low' 省額度` → 待 user 拍板改寫
- `outputs/E147_*.md` 三份 change-spec 草稿可直接用於 review-protocol 去重那個改動
