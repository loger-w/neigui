# change-spec — mod/issuer-rank-strata(2026-07-14)

依據:`.claude/mod/issuer-rank-strata/current-state.md` + 上輪 `.claude/mod/warrant-selector-enhance/change-spec.md` §6.2 Known Risk + `docs/research/warrant-selection.md`(臺大論文分層方法論)+ `docs/next-time.md` v2 條目。
設計決策經 user 對話核可(2026-07-14):層內機制 = midrank percentile、payload/UI = 加三個層內分數欄、e2e = 擴充 fixture 至一層 ≥5 檔;其餘採 recommended 選項(下方 §6 決策記錄)。

## 0. 目標一句話

`compute_issuer_rank` 的 per-warrant 指標改在「(moneyness band × 天期 band)分層」內取 midrank percentile 後聚合成發行商分數,讓「同品質、不同產品組合」的發行商得到相近排名 — 修正 v1 全市場 min-max 的未分層偏差(元大 positive control 未過)。

## 1. v2 演算法規格(核心)

輸入簽名不變:`compute_issuer_rank(archives, drift_map, terms_by_wid, issuer_map)`(純函式零 IO)。

### 1.1 分層歸屬(per warrant,新增)

- **s_ref**:window 內**由新到舊**第一個該 wid entry 的 `s` 非 null 日之值;全窗無 s → unclassifiable。
- **條款**:`terms_by_wid[wid]` 需有 `strike > 0`、`kind`、合法 `last_trading_date`;缺任一 → unclassifiable。
  (v1 中無 terms 的 wid 若在對照表仍可計分;v2 起 unclassifiable 一律不計分 — 行為變化,影響僅限「window 內出現但已從快照消失」的殘留 wid,據實標注。)
- **moneyness**(對齊 `warrant_quotes.py:187` 分向公式,正 = 價內):
  `m = (s_ref - strike)/strike` if call else `(strike - s_ref)/strike`
- **moneyness band(5 檔)**:`m ≤ -0.20` deep_otm / `-0.20 < m ≤ -0.05` otm / `-0.05 < m < 0.05` atm / `0.05 ≤ m ≤ 0.20` itm / `m > 0.20` deep_itm
- **天期 band(3 檔)**:`t = (ltd - as_of).days`;`t < 60` near / `60 ≤ t ≤ 180` mid / `t > 180` far(≤21 已在前段排除,near 帶實際範圍 22-59)
- stratum key = `(m_band, t_band)`,最多 15 層。

### 1.2 計分資格(沿用 + 新增)

沿用 v1:resolve_issuer 三層解析不中 → 不入;近到期(`ltd - as_of ≤ 21` 日曆日)→ 不計分;兩週窗有效 ivb 點 `< 8` → 不計分(iv_std 不可算)。
新增:unclassifiable(§1.1)→ 不計分;**所屬層全市場計分檔數 `< MIN_STRATUM_SAMPLE(=5)` → 該層整層不計分**(層內全部 wid 不入 n_scored)。

### 1.3 層內 midrank percentile(新)

對每個有效層(計分檔數 ≥5),per metric:

- **iv pctl**:層內全部計分檔按 `iv_std` 升冪,midrank(同值取平均名次),`pctl = (midrank - 0.5) / n`(∈(0,1),低 = 佳)。
- **spread pctl**:層內 `spread ≠ None` 的檔上同法(子集可小於層;子集 n=1 → pctl 0.5,中性,midrank 天然給出)。
- **declining pctl**:層內 `label ≠ None 且 ≠ "insufficient"` 的檔上,以 binary(declining=1 / 其他=0)同法 — midrank 對 tie 的處理讓它退化為「相對層基率的線性分數」(如層 30% declining:非降波檔 0.35、降波檔 0.85)。

三指標同一套機制;v1 的 `_normalize`(min-max + clamp)刪除,無退化(max==min)分支需求 — 全同值層 midrank 全 0.5,無 NaN。

### 1.4 發行商聚合(改)

- `iv_score` = mean(旗下計分檔 iv pctl);`spread_score` = mean(旗下有 spread pctl 的檔);`declining_score` = mean(旗下有 declining pctl 的檔);各自無樣本 → null。天然按層內檔數加權(user 核可的 midrank 選項語義)。
- **composite = 3/7·iv_score + 2/7·spread_score + 2/7·declining_score**(權重沿用;三分數已在 [0,1],**不再做跨發行商 min-max**);三分數任一 null → composite null(沿 v1 `_complete` 語義)。
- `rank`/`tier`:沿用 — `n_scored ≥ MIN_SAMPLE_FOR_TIER(=5)` 且 composite 非 null 者入榜,composite 升冪(tie 以 issuer_id),ceil 三分位 front/mid/back;其餘 rank/tier null。
- 原始中位數欄**保留**(`iv_std_median`/`spread_median`/`declining_share`,在計分檔集合上算,語義同 v1;計分集合定義變窄 = 有效層內檔)。
- `n_scored` 語義:計分且落在有效層的檔數(§1.2)。
- 新增 per-issuer `n_strata`:旗下計分檔覆蓋的有效層數。

### 1.5 Payload(只增不減)

```
{ _cache_version: 3(_RANK_CACHE_VERSION,與 MAP 拆分), as_of_date, built_from_days,
  n_strata_total: <全市場有效層數>,      # 新,頂層(R5:與 per-issuer 欄名區隔)
  issuers: [{ issuer_id, issuer_name, n_warrants, n_scored,
              iv_std_median, spread_median, declining_share,   # 既有,保留
              iv_score, spread_score, declining_score, n_strata,  # 新,0-1 低者佳 / 該商覆蓋層數
              composite, rank, tier }] }
```

## 2. 成功條件(SC;全部量化 + 量法)

| SC | 內容 | 量法 |
|---|---|---|
| SC-1 | known-answer 純函式:(a) 兩發行商層內品質相同、組合不同(一家全 deep_otm、一家全 atm)→ composite 差 < 0.02 且互不因組合分高下;(b) 同組合、一家層內較差 → composite 較高(排後);(c) midrank pctl 手算值逐檔斷言(含 tie);(d) binary declining midrank 手算;(e) 層 <5 檔整層不計分(n_scored 不含);(f) unclassifiable(無 s / 無 terms / strike 0)不計分;(g) composite ∈ [0,1] 且三分數任一 null → composite null;(h) spread 子集 n=1 → 0.5 | pytest 純函式 known-answer fixture(層 ≥5 檔手造) |
| SC-2 | payload 契約:既有欄位全保留、新欄位齊(§1.5)、`_RANK_CACHE_VERSION=3`(RANK_FILE 舊 cache 失效重建;MAP_FILE 版本值不變)| pytest payload shape + 版本斷言;route 測試零改仍綠 |
| SC-3 | 元大 positive control(真實資料):重跑後元大 rank 顯著上移(合理預期 front/mid;研究依據 = 元大隱波不降承諾)。仍後段 → 必須從層內數字(元大各層 pctl 分布)說出為什麼,**不許調權重湊答案** | 離線腳本直呼 `compute_issuer_rank`(真實 cache dir),對照 v1/v2 元大 rank + 各層 pctl 摘要 |
| SC-4 | UI:標注拿掉「未分層…跨規模比較請保留」,改為分層口徑一句(含「樣本 <5 檔的層不計分」);**「收盤報價推算」字樣保留**(E17/RTL 斷言依賴);三指標欄改顯示層內分數(低 = 佳),cell `title` 帶原始中位數;計分欄 tooltip 帶「覆蓋 N 層」 | vitest RTL:標注文字 + 分數欄值 + title 屬性 |
| SC-5 | e2e:fixture 擴充 — 2317 掛 7 檔(元大 ×5 穩定 ivb+窄價差、凱基 ×2 波動+寬價差),**層 key 固定 otm×far,與既有計分檔的層不相交(R1,§7.2 對照表)**;每檔 b/a 序列 ≥8 有效日過三防護(R2,spread pctl 可手算);E17 改寫為資料級(元大 rank 1 / tier front + 手算分數欄值 + 凱基分數欄有值但 rank null);tests_e2e contract 同步 + `test_warrants_rows_carry_issuer_name` 改為 order-independent(先 GET rank 再斷言 030012 列 tier="front",R4);**2330 側 fixture 六檔與 iv_history 既有序列全不動(E8 6 檔 count / E12 drift 斷言不受影響)**;跑前清 `e2e/.cache` | playwright E17 綠 + 既有 E8-E16/NTD2 全綠;tests_e2e 綠(含單測 -x 獨跑綠) |
| SC-6 | changelog `0.30.0` MINOR entry(排行分層口徑 + 新分數欄,user 可感;寫 entry 前讀 changelog-conventions) | build 過 + entry 落檔 |

## 3. 既有行為白名單(比新行為優先)

1. **對照層全部不動**:`get_issuer_map` / `get_issuer_map_cached` / `get_issuer_lexicon_cached` / `resolve_issuer` 三層解析(官方對映 + 標的 guard + 名稱 fallback)/ MAP_FILE 7 天 cache(**版本值 2 不變,不因 RANK bump 連坐失效**)/ cooldown / stale-serve / `_spawn_map_bg`。
2. **sync accessor 熱路徑鐵則**:`get_issuer_tier_cached` 讀 shape 不變(issuers[].issuer_id/tier);`get_underlying_warrants` merge 路徑(warrants.py:508-531)零改動、零新同步上游 — quotes 15s 輪詢鏈不受影響。
3. `/api/warrants/issuers/rank` route 層不動(503 `issuer_rank_not_ready` 三情境 / 502 契約);payload 既有欄位不減。
4. selector 列 `issuer_name` / `issuer_tier` 契約不變。
5. 計分排除規則沿用:近到期 ≤21 日曆日 / ivb <8 點 / spread 日值三防護(b-a 缺、b≤0、倒掛)/ insufficient 不入 declining 分母。
6. iv_history archive 格式與 drift(Theil-Sen)演算法不動;`load_recent_archives` 介面不動。
7. e2e 既有斷言:E8(6 檔 count)/ E9-E16 / NTD2 全不動;**E17 與 tests_e2e rank 斷言為聲明過的「該變」例外**。
8. IssuerRankPanel 開合行為 / enabled gate(展開才 fetch)/ 錯誤與重試文案不變;「收盤報價推算」字樣保留。
9. `get_issuer_rank` 的 lazy/cache/_run_once/not-ready 判準(全市場 n_scored 總和 = 0 → None → 503)不動。**據實標注(R6)**:v2 計分門檻變嚴(全部層 <5 檔亦歸 0)→ 503 觸發集合語義上擴大;前端 not-ready 文案(「需累積 IV 歷史」)在「archive 滿兩週但全層樣本不足」情境歸因不準 — 真實市場(3 萬檔)幾乎不可能發生,文案沿用,風險接受。

## 4. Backward compat / migration

- **API**:欄位只增不減;前端型別新欄位為 `number | null`,舊 payload(理論上不存在 — 版本 bump 後 backend 必回新 shape)亦 null 安全。
- **Cache**:`_RANK_CACHE_VERSION` 自 `_CACHE_VERSION` 拆分(🔵,值先維持 2)再 bump 3(🔴)。舊 RANK_FILE 版本不符 → 視同無 cache 重建,無 migration;MAP_FILE 不受影響。回滾 = revert commits,新 cache 檔孤立無害。
- **前端**:UI 欄位換顯示來源(score),資料缺(null)顯示 「—」;無需 feature flag。

## 5. Out of scope

權重再校準(3/7·2/7·2/7 不動)、引入週轉率/買一金額新指標、分層帶邊界的資料驅動優化(帶起點寫死常數,可調)、strata 明細 drill-down API、selector 篩選邏輯、對照層(map/resolve)任何改動、`docs/research/warrant-selection.md` 改寫。

## 6. [recommended-default] 決策記錄(user 授權採建議選項)

- 層內機制 = midrank percentile(per-warrant,`pctl=(midrank-0.5)/n`)| reason: 小層樣本對 outlier 穩健;binary declining 同機制退化為層基率線性分數,三指標一套機制 — user 顯式核可
- 分層帶起點 = 任務書建議(5 moneyness × 3 天期)寫死 module 常數 | reason: 起點夠用,資料驅動優化 out of scope
- s_ref = 窗內最新非 null s | reason: 與「基準日 = 最新 archive 日」一致;單日 TPEx 落後不會整檔 unclassifiable
- MIN_STRATUM_SAMPLE = 5(全市場層內計分檔數)| reason: 任務書建議值
- 發行商分數 = 旗下檔 pctl 平均(= 各層分數按層內檔數加權的等價形式)| reason: user 核可選項的語義
- composite 不再 min-max | reason: pctl 天然 [0,1];v1 `_normalize` 及退化分支刪除
- `_RANK_CACHE_VERSION` 拆分 | reason: 白名單 1 要求 MAP cache 不連坐;拆分本身 🔵 值不變
- payload + UI 加三個 score 欄 + n_strata | reason: user 顯式核可(消表面矛盾;正控驗證可直讀)
- e2e 新 fixture 掛 2317 | reason: 2330 側 6 檔 count 是白名單斷言,不動它
- changelog 0.29.0 → 0.30.0 MINOR | reason: user 可感排行口徑改良 + 新欄位(§7 規則)
- Phase 4 前端 UI 動工前呼叫 frontend-design + bencium-controlled-ux-designer | reason: user 既定偏好(memory)

## 7. Diff 級規格(三類分開標記)

### 7.1 🔵 純重構(先行,測試不該變)

| 檔 | 動作 |
|---|---|
| `backend/services/warrant_issuers.py` | 新常數 `_RANK_CACHE_VERSION = 2`(暫同值);rank 讀寫點(`compute_issuer_rank` 輸出、`get_issuer_rank` 檔驗證、`get_issuer_tier_cached` 檔驗證)改用之;MAP 繼續用 `_CACHE_VERSION` |
| `backend/tests/test_warrant_issuers.py` | rank payload 相關測試引用常數同步 rename(值同 → 全綠);map 測試零改 |
| `backend/tests_e2e/conftest.py` | 若既有 autouse reset fixture 未涵蓋 `warrant_issuers` 的 `_rank_mem`/`_rank_disk_checked` → 補進 reset(R4;測試基建,行為不變,既有測試仍綠)|

### 7.2 🔴 行為改動(先改測試紅 → 改實作綠)

| 檔 | 動作 |
|---|---|
| `backend/services/warrant_issuers.py` | §1 演算法:新增 band 常數 + `_stratum_of(term, s_ref, as_of)` + `_midrank_pctls(values)` helper;`compute_issuer_rank` 重排(分層 → 層門檻 → pctl → 聚合);`_normalize` 刪除;`_RANK_CACHE_VERSION` bump 3;module docstring 更新口徑 |
| `backend/tests/test_warrant_issuers.py` | **該紅(改 assertion/fixture,聲明「該變」)**:`test_rank_stable_issuer_wins` / `test_rank_payload_shape` / `test_rank_declining_share_counts_labels` / `test_rank_insufficient_excluded_from_declining_denominator` / `test_rank_excludes_near_expiry` / `test_rank_excludes_sparse_ivb` / `test_rank_spread_day_guards` / `test_rank_small_sample_no_tier` / `test_rank_degenerate_minmax_no_nan`(改寫:全同值層 → 全 0.5 無 NaN)/ `test_rank_unmapped_wid_null_safe` / `test_rank_tier_terciles` / `test_rank_small_sample_composite_clamped`(改寫:composite 天然 [0,1])/ `test_rank_skips_underlying_mismatch` / `test_rank_uses_name_fallback_for_unmapped` / `test_get_issuer_rank_wires_lexicon`(fixture 需過層門檻)— 共同調整:fixture 補 terms(strike/kind/ltd)+ archive s + 湊層 ≥5 檔 |
| `backend/tests_e2e/fixtures/warrants/*.json` | **既有層歸屬對照(as_of=2026-06-26,全檔 ltd=2026-09-15 → t=81 mid 帶)**:030012(strike 950,s 全序列釘死 1000 → m=+0.0526)itm×mid、030013(strike 1000)atm×mid、030011 sparse 不計分、030014/030015/03001P/030099 無 iv_history 不計分 → 兩既有層各 1 檔 <5,維持整層不計分。**新 7 檔(2317,認購)一律 otm×far**:s 釘 200、strike 225(m=−0.111,otm)、ltd ≥ 2027-01-15(t>180,far)— 與 {itm×mid, atm×mid} 不相交(R1)。**新 7 檔 fixture 配方(Round 2 R1/R2 定版,可執行規格)**:wid = 040001-040005(元大)/ 040006-040007(凱基),簡稱「鴻海元大71購01」…「鴻海凱基71購07」(名稱 fallback regex 可中,但官方對映須命中 — 36_L 新列**標的代號=2317**,防 resolve 標的 guard 誤判舊代號殘留走 fallback);`t187ap37_L.json` +7 檔 terms(strike 225、配發數量 50.00 → ratio 0.05、最後交易日 1160226 → 2027-02-26,t=245 far);`mi_index_0999.json` +7 列(**row[17]="2317"、row[18]=鴻海、row[19]=200**);`iv_history.json` **全部 25 個日檔** +7 wid entries(drift MIN_VALID_POINTS=20 需 ≥20 日;iv_std 排序在最近 10 日窗內成立):**ivb = c_i + δ_i·(−1)^t 零趨勢交錯震盪**(Theil-Sen slope≈0 → 全 7 檔 label=stable → declining 全 tie → pctl 0.5;std≈δ_i×1.054,7 檔 δ 互異防 tie:元大 δ=0.002/0.003/0.004/0.005/0.006 < 凱基 δ=0.010/0.012 → iv pctl = (rank−0.5)/7,元大 mean=0.357、凱基 mean=0.857),c_i=0.40..0.46;**b/a 每檔常數**(25 日全有效,過三防護):元大 spread=(a−b)/b=0.010/0.012/0.014/0.016/0.018 < 凱基 0.05/0.06 → spread_score 元大 0.357、凱基 0.857;s 全序列釘 200;`t187ap36_L.json` +7 列官方對映(元大/凱基既有 issuer_id,標的代號 2317)|
| `backend/tests_e2e/test_api_warrants.py` | rank contract 改寫:元大 n_warrants=6 / n_scored=5 / rank=1 / tier="front" / iv_score≈0.357 / spread_score≈0.357 / declining_score=0.5;凱基 n_scored=2 → rank/tier null 但三分數有值;富邦 n_scored=0 全 null;頂層 n_strata_total=1;`test_warrants_rows_carry_issuer_name` **先 GET /issuers/rank 再斷言**(order-independent,R4)030012 列 issuer_tier=="front" |
| `e2e/specs/equity.spec.ts` | E17 改寫(資料級):元大 rank 1、分數欄手算 pctl 值、凱基分數偏差、「收盤報價推算」保留、分層口徑標注文字;痛點註解更新 |
| `frontend/src/components/IssuerRankPanel.tsx` | 標注改寫(SC-4);三指標欄改顯示 score(低=佳)+ cell title 原始中位數;計分欄 title「覆蓋 N 層」 |
| `frontend/src/components/IssuerRankPanel.test.tsx` | 對應斷言調整(該紅):欄值來源改 score、標注文字;「收盤報價推算」斷言保留 |

### 7.3 🟢 新功能(紅測試先行)

| 檔 | 動作 |
|---|---|
| `frontend/src/lib/changelog.ts` | VersionEntry 0.30.0(寫前讀 changelog-conventions)|

（歸類修正:SC-1 known-answer 測試群是鎖 🔴 新演算法的紅測試,併入 🔴 backend commit;
`warrant-data.ts` 型別 + `useIssuerRank.test.ts` mock 與 Panel 欄位互鎖(tsc -b),併入 🔴 frontend commit。）

### 7.4 Commit 切分(Phase 4 執行順序)

1. 🔵 `refactor(warrants)`:`_RANK_CACHE_VERSION` 拆分(值 2)+ 測試常數引用 rename + tests_e2e conftest reset 補 warrant_issuers state — 全測試不變綠
2. 🔴 `fix(warrants)` backend:紅測試先行(既有 rank 測試群改寫 + known-answer 新增 + tests_e2e contract)→ v2 演算法 + bump 3 + fixtures 擴充 → 綠
3. 🔴 `fix(frontend)`:RTL 斷言先改紅 → Panel 標注/分數欄 + 型別 + mock → 綠;E17 改寫同 commit(斷 UI 全鏈)
4. 🟢 `feat(frontend)`:changelog 0.30.0

### 既有測試預期總表

- **該紅(🔴 聲明)**:§7.2 列出的 rank 純函式測試群 + `test_issuer_rank_contract` + `test_warrants_rows_carry_issuer_name`(030012 列 issuer_tier null → "front";改寫需 order-independent,R4)+ E17 + `IssuerRankPanel.test.tsx` 欄值/標注斷言 + `useIssuerRank.test.ts` mock 型別(R3,tsc 紅非測試紅)。
- **不該紅**:map/resolve/accessor/short-name 全部測試群(`test_short_name_*` / `test_issuer_map_*` / `test_cached_accessor_*` / `test_resolve_*` / `test_map_*` / `test_tier_cached_*`)、`test_rank_empty_archives`、`test_warrants_service/routes` 既有、前端其餘全部、e2e E8-E16 / NTD2 / market / options / navigation。

## 7.9 Review 輪次記錄

- Round 1(2026-07-14):P1×4(R1 fixture 層歸屬未定會撞既有層 / R2 新檔 b/a 未規格 → spread null 傳播毀 composite / R3 前端型別必填欄位使 useIssuerRank.test.ts build 紅但總表聲明不該紅 / R4 tests_e2e tier 斷言 test-order dependent)、P2×2(R5 n_strata 一名二義 / R6 503 觸發面擴大未標注)— 全數 accepted 並修入 §1.5/§2/§3/§7。
- Round 2(2026-07-14):P1×1(fixture ivb 配方「走平」與「std 互異」矛盾 + drift 門檻約束未寫 → 定版為零趨勢交錯震盪配方,std 與 slope 解耦)、P2×1(fixture 欄位欠定:36_L 標的代號 / mi_index row[17-19] / wid 與簡稱格式 → 補入配方)— 全數 accepted 並修入 §7.2。**退出條件成立:findings 全數修入,無殘留 P0/P1。**

## 7.10 Phase 5 自評記錄(2026-07-14)

- /code-review medium:8 finder angles(haiku 快篩紀律)→ ~33 candidates → 快篩 dedup。
- P0/P1:0。REFUTED 大宗:spec 已聲明的行為變更(composite null 傳播 = _complete 語義、
  ±5% 邊界含等號 = §1.1 明文、版本不符重建 = 設計 migration)、慣例許可 local 複製、
  pre-existing 測試風格、per-test event loop 使孤兒 task 論點不成立。
- P2 採納 ×3(91eaa9c / 5fd026a):by_stratum 單趟分組、log 補 scored 數、
  spread 路徑 composite null 傳播測試補鎖。P2 skip 彙總 ×12(風格/慣例類)。

## 8. E2E 判準結論(e2e-conventions)

改既有 user-facing 行為(排行語義 + 面板欄位)→ **需要 e2e**,動作 = 改既有 E17 斷言(equity.spec.ts)+ tests_e2e contract;fixture 走 `fixtures/warrants/` 子目錄 distilled 層注入(iv_history.json)+ 原始 shape 縮樣(t187ap37_L / mi_index / 36_L),與上輪同構;無新 spec 檔、無 @live 需求;改 fixture 後清 `e2e/.cache` 再跑。豁免:無。

self_review_head: 5fd026a4e26edbc870b0ae8af43159cee3439e1c

## 9. Phase 7 真實環境記錄(2026-07-14)

### SC-3 元大 positive control — 結果:仍 back(rank 10/12),走 SC-3「可名狀解釋」分支

真實資料(as_of 2026-07-13,10 日窗,n_strata_total=15,scored 16,645 檔,12 家入榜):
元大 v2 rank=10 tier=back(v1 亦 rank=10)。層內下鑽(evidence/SC-3_yuanta-stratum-diag.txt):

1. **組合結構混淆已被 v2 移除且非成因**:deep_otm 各層內元大平均 moneyness −0.34~−0.35,
   同層對手 −0.40~−0.41 — 元大在層內反而較「淺」,band 粒度殘差對元大有利,不能解釋後段。
2. **層內品質確實中後段**:15/15 層全覆蓋(n_scored 3,568),iv pctl 逐層 0.49-0.62
   (僅 deep_itm 三層 0.34-0.44 偏好);同層 bid-IV std 中位數為層中位的 1.4-2.5 倍
   (deep_otm|far 0.0214 vs 0.0085、otm|mid 0.0309 vs 0.0153)。spread pctl 同樣中後(0.45-0.72)。
3. **「元大應前段」的研究預期對應維度無鑑別度**:隱波不降承諾 ↔ declining 維度;10 日
   EOD 窗全市場 declining 僅 126/16,645(0.76%)→ 全體 declining_score ≈0.5,元大 0.497
   (中性,無違諾證據,但拉不動 composite);composite 3/7 權重在 iv_std(日間報價 IV
   穩定度)— 是另一個品質維度,元大在該維度層內就是中後段。
4. **Known residual(記 next-time)**:分層未控制標的波動度 — 發行組合偏熱門高波動
   標的會結構性墊高 bid-IV std;是否為元大後段主因需 per-underlying 控制才能分辨。

結論:未調權重;v2 排行語義成立(混淆已移除,剩餘訊號可歸因於層內實測品質 + 一個已
命名的 residual)。台新/國泰/國票/凱基前段、元大/統一/群益/新光後段。

### SC-4 UI(截圖 docs/specs/issuer-rank-strata/screenshots/SC-4_issuer-rank-panel-v2.png)

分層口徑標注 + IV分位/價差分位/降波分位欄 + 計分/總檔數如 spec 渲染;v0.30.0 badge。
元大列「後段 53.1%/53.5%/49.7% 3568/6028」與離線計算一致(全鏈打通)。

### 白名單抽查(真實環境)

- /api/warrants/2330 + /quotes + chip 系列全 200;selector 列發行商欄 merge 正常
  (「兆豐 後段」badge 顯示,tier 來自 v3 rank)— 白名單 2/4。
- Console:零本次引入 error(favicon 404 + form-field a11y issue 皆 pre-existing)。
- rank endpoint 冷 build(v3 cache 重建)200 — migration 實跑成功,白名單 9。

### 附:auto-verify 全綠(HEAD 5fd026a)

pytest 760 passed(test_finmind_realtime 一輪負載型 flake,單檔重跑綠,記 next-time)、
ruff 0、vitest 788 passed、build 過、tests_e2e 43 passed、playwright 38 passed(e2e/.cache 已清)。
