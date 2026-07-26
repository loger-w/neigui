# Harness 成本效率 — Round 3(1b)結論

- 依據:E127-E151(**已完成**),逐條記錄於本檔;原始資料 `results3.jsonl`
- 新方法:每個條件先跑 2 次**丟棄的暖機**,只量穩態(理由見下方 F1)
- 一句話:**round 2 的 effort 與 model 兩條結論都被同一個量測 artifact 污染 —— warm-up。
  排除後:effort 的成本門檻分 model(opus 在 xhigh、fable 在 medium);而「fable 是 opus 的
  4.74×」這個問題本身問錯了 —— 比值在 1.14×(寫 spec)到 3.17×(review)之間,取決於任務是
  收斂型還是發散型。**

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

### F2b — 但曲線形狀**不跨 model 通用**(E141/E142/E150/E151)

同一道題,fable 的 effort 曲線與 opus **形狀不同**:

| effort | opus 中位 | fable 中位 | fable/opus | fable 逐次 |
|---|---:|---:|---:|---|
| low | $0.1287 | **$0.2857** | 2.22× | 0.2230 / 0.2857 / 0.3370 |
| medium | $0.1149 | $0.3713 | 3.23× | 0.3698 / 0.3713 / 0.4233 |
| high | $0.1318 | $0.4124 | 3.13× | 0.3928 / 0.4124 / 0.8983 |
| xhigh | $0.1846 | $0.4506 | 2.44× | 0.4506(僅 1 次命中)|

- **opus**:low ≈ medium ≈ high,只有 xhigh 跳(4 turn → 5-6 turn)。
- **fable**:`low` 與 `medium` **完全不重疊**(low 最大 0.3370 < medium 最小 0.3698),
  low → medium 就漲 30%;turn 數 4 → 6。medium / high / xhigh 之間 n=3 分不開。

**機制一致、門檻不同**:effort 仍然是「透過 turn 花錢」,但 fable 在 `medium` 就開始多跑 turn,
opus 要到 `xhigh` 才會。所以「effort 該設多少」**必須分 model 回答**,沒有通用答案。

### 可操作結論

| model | 設定 | 理由 |
|---|---|---|
| **opus** | `high` | low/medium/high 成本相同,high 的 output 是 low 的 1.21× —— 免費升級,不是折衷 |
| **fable** | `medium` | low→medium 漲 30% 但買到 2× output(509 → 998);medium 以上分不開,再往上是純花錢 |
| 一律 | 避開 `xhigh` | 兩個 model 都是最貴的一格 |

已落地:`~/.claude/settings.json` `effortLevel` xhigh → **high**(2026-07-26);
user-global `CLAUDE.md` §G 已改寫(commit 5cf7f3d)。

> §G 現行寫「一律 high,只避開 xhigh」—— 依 F2b 這句對 fable 不精確(fable 的 medium
> 比 high 便宜 10%)。**但 user 已拍板 fable → medium**,兩者結論一致,規則文字待下次順手補上
> model 維度即可,不是錯誤。

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

## F4 — 「fable 是 opus 的 N 倍」這個問題問錯了(定案)

opus 與 fable **同批**跑同一組任務(暖機後,effort=medium),比值從 1.14× 到 3.17×:

| 任務 | opus 中位 | fable 中位 | 比值 | 分佈是否分離 |
|---|---:|---:|---:|---|
| **寫 change-spec** | $1.7360 | $1.9828 | **1.14×** | **重疊**(opus 上界 2.149 > fable 下界 1.704)→ 分不出差異 |
| 檢索 | $0.1226 | $0.2580 | 2.10× | 無重疊 |
| effort 探針(low)| $0.1287 | $0.2857 | 2.22× | 無重疊 |
| **review design.md** | $1.0291 | $3.2649 | **3.17×** | 無重疊 |

**同一組 model,比值差了 2.8 倍,取決於任務。不存在一個「model 比值」。**

### 機制:fable 貴一倍,但在生成型任務上做得更省

| 任務 | opus prompt / out / turn | fable prompt / out / turn |
|---|---|---|
| 寫 spec | 920,432 / 26,053 / **19** | **365,602 / 13,799 / 10** |
| review | 454,807 / 14,480 / 9 | **747,933** / 19,553 / 10 |

寫 spec:fable 用 **0.40× 的 prompt、0.53× 的 output、一半的 turn** 交出同一份東西,
把牌價的 2× 抵銷掉。
review:反過來,fable 用 **1.64× 的 prompt** 探索更多 —— 所以貴 3 倍。

**判準不是「fable 貴不貴」,是「這個任務是收斂型還是發散型」。**
收斂型(產出一份文件)fable 幾乎免費;發散型(掃一份文件找問題)fable 貴 3 倍。

### 對三個既有數字的處置

| 數字 | 出處 | 處置 |
|---|---|---|
| 4.74× | round 2 E99-E101,SPEC.md | **作廢**。n=2 未排除 warm-up,且它把單一任務的比值當成 model 屬性 |
| 1.64× | round 2 真實語料 $/turn | 保留為**語料平均**,不是任一任務的比值 |
| 2.05× | round 3 E131,n=1 | 併入本節,與檢索 2.10× 一致 |

---

## F5 — 任務成本基準(opus / fable 同批)

全部 effort=medium、暖機後穩態:

| 任務 | opus | fable |
|---|---:|---:|
| 檢索(找 phase→refs 的落點)| $0.1226 | $0.2580 |
| review 一份 67KB design.md | $1.0291 | $3.2649 |
| 寫一份 change-spec | $1.7360 | $1.9828 |

**寫 spec 是檢索題的 14×(opus)/ 7.7×(fable);review 是 8.4×(opus)/ 12.7×(fable)。**

### F5b — 跨 model 委派沒有翻轉 2.16× 懲罰(E137/E138)

round 2 的委派懲罰是 opus→opus 量的,本輪換成 **fable coordinator → opus subagent**
(把工作從貴窗口搬到便宜窗口),原本預期可能翻轉:

| | prompt | 成本(命中)|
|---|---:|---:|
| fable 自己做 | 142,805 | $0.2580 |
| fable 派 opus subagent | **89,072** | $0.4504 |

**coordinator 自己的 prompt 確實少了 38%,總成本仍是 1.75×。** 與 round 2 的 2.16× 同向。

**「把活丟給便宜的 model 來省錢」不成立** —— 委派的成本是 subagent 要重新建立 context,
換 model 換不掉這一項。委派買的仍然只有平行與 context 隔離。

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

**這是 review-as-subagent 的有效性證據。**

### F6b — fable review 抓得比 opus 多,而且抓到一條可驗證的實錯(E140)

同一份 design.md、同樣三次獨立 run:

| | findings / run | 三次收斂條數 |
|---|---:|---:|
| opus(E139 + E149,6 run)| 5-7 | 4 |
| **fable**(E140,3 run)| **6-8** | 3 |

fable 抓到 opus 的四條裡的兩條(SC-6 不相交、PHASE_REFS 未定義 profile/scope/condition),
但另外貢獻了 opus 完全沒有的三類:

1. **反作弊規則字面上禁掉了 spec 自己的最大槓桿**(三次都抓到)——「清單差異只能來自本次
   實際搬動的檔」,而 SDD 是被 `skillOverrides` **關閉**、不是搬動,照字面它不能從 after
   側移除。opus 抓到的是同一條規則的另一個漏洞(漏掉第三條作弊路),fable 抓到的是**規則
   與主線自相矛盾**,更尖銳。
2. **步驟 1「剪下」與 1d「原始檔未改動」前提直接矛盾**(三次都抓到)。opus 六次只抓到一次。
3. **SC-5 的量法指令本身跑不起來** —— design.md §1 寫 `Grep -rn ... --glob '*.md'`,
   混用了 ripgrep 的 `--glob` 與 shell `grep`。**已實地驗證**:

   ```
   $ grep -rn --glob '*.md' "test" README.md
   grep: unknown option -- glob
   ```

   而 `sc-verification.md` 實際執行時用的是 `--include='*.md'` —— 量法在執行時被默默改掉,
   spec 白紙黑字的指令從來沒被跑過。**12 輪對抗審視 + opus 六次 review 都沒抓到。**

**代價**:fable review $3.2649 vs opus $1.0291 = **3.17×**(F4)。

**判讀**:多 30% findings + 一條可驗證實錯,換 3.17× 價格。這是 user 的取捨,不是我能替你決的;
但「fable 判斷力較強」這個假設在本例**有了證據**,不再只是假設 —— 雖然 n=3,且只在一份文件上測過。

---

## 定案的可操作結論

1. **寫 spec 用 fable ≈ 免費**(1.14×,分佈重疊)。user 2026-07-26 拍板要 fable 寫 spec,
   代價實測遠低於決策當時的預期(當時引用的是 4.74×)。
2. **review 用 fable 貴 3.17×**,但抓得更多更尖。值不值得看你對「漏掉一條 P1 的代價」的評價。
3. **檢索 / 機械性任務用 opus**(fable 2.1-2.2× 且沒有品質優勢證據)。
4. **委派不省錢**,跨 model 也不省(1.75×)。要平行或 context 隔離才委派。
5. **effort 分 model 設**:opus `high`、fable `medium`,兩者都避開 `xhigh`。

## 其他待處理

- `outputs/E136_*.md` 三份 fable 寫的 change-spec、`E147_*.md` 三份 opus 寫的 —— 同一題六份,
  可直接讀比品質(本輪只量了成本,**沒有評 spec 品質**)
- `outputs/E147_*.md` / `E136_*.md` 可直接用於 review-protocol 去重那個改動
- §G 的規則文字可補上 model 維度(見 F2b 註記,非錯誤)
- **未測**:fable 在累積窗口(真實 main loop)上的成本。本輪全部是 fresh context,
  是下界不是實際值
