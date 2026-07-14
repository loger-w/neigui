# change-spec — mod/warrant-selector-enhance(2026-07-14)

依據:docs/research/warrant-selection.md + .claude/mod/warrant-selector-enhance/current-state.md。
Auto 模式:`/auto`(2026-07-14)— 退出條件 = /mod Done(SC 全綠 + auto-verify 全綠 + 白名單全保留),merge 確認必停。設計已於對話中經 user 逐項核可(範圍五項 + 分點欄手動載入 + 排行「列內欄位+收合面板」)。

## 1. 成功條件(SC;全部量化 + 量法)

| SC | 內容 | 量法 |
|---|---|---|
| SC-1 | 發行商對照:`get_issuer_map()` 合併 TWSE `t187ap36_L` + TPEx `mopsfin_t187ap36_O` → `{wid: {issuer_id, issuer_name}}`,**7 天級**檔 cache(權證每週掛牌,月級太久;R7)(`_CACHE_VERSION` 帶版本);**合併規則(R7)**:`issuer_id` 為 join key,名稱 TPEx 簡稱優先、否則 TWSE 全稱規則裁剪(去「證券股份有限公司」「綜合證券」等字尾,裁不動保留原字串);rank build 時 log archive wid 對映命中率(覆蓋率可觀測) | pytest:FAKE fixture 斷言 known wid 對映 + 簡稱裁剪 cases + **archive 有、對照無的 wid null 安全** |
| SC-2 | 排行純函式 `compute_issuer_rank(archives, drift_map, terms, issuer_map)`:per-warrant 兩週(≤10 檔 archive)`ivb` std → per-issuer 三指標(iv_std_median / spread_median / declining_share)→ min-max 正規化加權 composite(**權重 3/7、2/7、2/7,總和 1**;對齊 TWSE 30/20/20 相對比例 — 官方第四項「週轉率 30%」係成交活躍度非造市品質,刻意捨棄,「買一金額 20%」以 declining_share 替代,archive 無掛單金額;低者佳)→ rank + tier(前/中/後段三分位)。**正規化退化防護(R2-2)**:某指標全體同值(max==min)→ 該指標正規化值一律 0;n_scored≥5 集合為空 → 全體 rank/tier=null、endpoint 仍 200(graceful,非 503)。**terms 來源 = `warrants.get_snapshot()` flatten**(import 方向 warrant_issuers→warrants,無循環);**基準日 = 最新 archive 日**(與計分窗一致)。**spread 日值規則(R5)**:b 或 a 為 null、b≤0、a<b(倒掛)之日跳過;權證有效 spread 日 <8 → 該權證不入發行商 spread 中位。**計分排除**:剩餘 ≤21 日曆日(基準日起算)、兩週窗有效 ivb 點 <8、drift insufficient 不入 declining 分母。**邊界(R4)**:樣本數判準一律用 `n_scored`;`n_scored=0` 的發行商三指標/composite/rank/tier 皆 null;min-max 正規化與三分位切點**只在 n_scored≥5 的發行商集合上計算**,n_scored<5 者照公式算 composite 但 rank/tier=null | pytest 純函式:known-answer fixture(兩發行商一穩一波動斷排序)+ 排除規則逐條 + spread 日值三防護 + n_scored 邊界 + 空 archive |
| SC-3 | Route `GET /api/warrants/issuers/rank` → `{as_of_date, built_from_days, issuers:[{issuer_id, issuer_name, n_warrants, n_scored, iv_std_median, spread_median, declining_share, composite, rank, tier}]}`;`as_of_date` = 最新 archive 日。**503 `{"error":"issuer_rank_not_ready"}` 的三種情境(R3/R4)**:無 archive / `get_snapshot()` 不可得 / 全市場 n_scored 總和 = 0 | pytest route contract + 503 三情境 |
| SC-4 | `get_underlying_warrants` 每列 +`issuer_name` +`issuer_tier`(對照/排行缺 → null;不烙快照)。**熱路徑防護(R1,P0)**:`warrant_quotes.py:290` 於 15s 輪詢鏈 await `get_underlying_warrants` — issuer 資料 accessor 必須複製 `get_drift_map` 完整語義:mem/檔 miss → **回空 map + 背景 fetch task**,絕不在 merge 路徑 await 36_L/36_O fetch;fetch 失敗只 `logger.exception`,不外洩至 endpoint | pytest:merge 斷言 + null 安全 + **36_L fetch raise 時 `get_underlying_warrants` 正常回(issuer 欄 null)** |
| SC-5 | `IssuerRankPanel` 收合面板:預設收合,展開列 rank/簡稱/三指標/n_scored,面板內固定標注「收盤報價 proxy,非官方盤中口徑」 | vitest RTL:開合 + 內容 + 標注文字 |
| SC-6 | 波段 preset:按鈕套 `{minDaysLeft:60, moneynessMin:-0.30, moneynessMax:0.05, spreadRatioMax:0.025, slrMax:0.3, minAskPrice:0.6, requireBidVol:true}`;`WARRANT_PRESETS` 常數含 `source`+`asOf`(元大 2026-07 live + 權證小哥 2022);套用後可再手動調整(純套值不鎖) | vitest:點擊後 filters state 逐鍵斷言 + UI 標注 |
| SC-7 | 新篩選鍵 `spreadRatioMax` / `slrMax` / `minAskPrice`(語義沿現制:啟用中 filter 對 null 欄位剔除) | vitest warrant-utils:filterWarrants 新分支 × null 語義 |
| SC-8 | 懸崖 badge:`days_left ≤ 21`(日曆日,≈法規 15 交易日)顯示「近到期」;tooltip/title 含「15 個交易日」口徑說明 | vitest:≤21 顯示 / >21 不顯示 / 文案 |
| SC-9 | 近售罄 badge:`best_ask` null 或 0 且 `best_bid > 0` → 顯示;`days_left ≤ 21` 時抑制(confounder);ask 正常在 → 不顯示 | vitest:三分支 |
| SC-10 | 分點欄手動載入:selector 掛 `useWarrantFlow(symbol, flowEnabled)`,`flowEnabled` 預設 false(**斷言未觸發 fetch**);欄頭「載入分點」按鈕 → true → fetch 後顯示 per-warrant `net_value`。**cache 語義(R4-2,採 (a))**:共 queryKey `["warrant-flow", stockId]`,TanStack cache 命中(分點 tab 已抓過)即直接顯示,不另 gate;按鈕僅在無 cache 時需要 | vitest 兩路徑:無 cache(預設不 fetch + 按鈕後顯示)/ 有 cache(未按鈕即顯示,且不觸發新 fetch) |
| SC-11 | e2e 增量:fixtures `t187ap36_L.json` + `mopsfin_t187ap36_O.json`(FAKE 層)+ equity.spec 新 E#:發行商欄可見、preset 一鍵套值(以 input value 斷言)、排行面板展開 | playwright 綠 |
| SC-12 | 白名單全保留:既有 backend 702 + frontend 755 測試零紅;**e2e 逐項不該紅(R2):E8(row 資料級斷言)/ E9(認售 toggle)/ E10(空狀態)/ E11(row 展開分點 — 新欄/badge 不得改動既有 expand button 的 accessible name 與 testid)/ E12 / E13 / E14 / 6 檔 count / NTD2** | pytest + vitest + playwright |

## 2. 既有行為白名單(比新行為優先)

1. 既有六篩選鍵(kind/minDaysLeft/moneyness×2/mispricing×2/ivPctlMax/requireBidVol)語義與 null-剔除行為不變
2. 排序預設 `spread_lev_ratio` asc 不變
3. `/api/warrants/{stock_id}` 既有欄位名與值不變(只加欄)
4. quotes 15s 輪詢 / iv_drift label 顯示 / mispricing_label 不變
5. flow tab(WarrantFlowPanel)行為不變;selector 的手動載入不改變 flow tab 的抓取時機
6. **selector 不自動觸發 FinMind fan-out**(分點欄未點載入前,零 FinMind 呼叫)
7. iv_history archive 格式與 drift(Theil-Sen)演算法不動
8. e2e 既有斷言(6 檔 count、E8/E9/E10/E11/E12/E13/E14、NTD2)不動;E11 的 row 展開鈕 accessible name / testid 不變
9. `warrant_quotes.py:290`(quotes 15s 輪詢熱路徑)await `get_underlying_warrants` 的延遲特性不變:issuer merge 不得引入同步上游 fetch 或新故障面

## 3. Backward compat / migration

- 全部「加欄位 / 加分支 / 新檔」;無 signature 變更、無 DB、無 cache migration(新 cache 檔自帶 `_CACHE_VERSION`)。
- `WarrantTerm` / `WarrantRow` 前端型別加 optional 欄位;舊 payload(無 issuer 欄)在前端 null 安全。
- 回滾 = revert commits,無資料殘留問題(新 cache 檔孤立無害)。

## 4. Out of scope

流通比雙端篩選、分點×發行商品質交叉、backend 篩選參數化、drift 口徑變更、獨立發行商 tab、發行商簡稱人工對照表。

## 5. Diff 級規格(全部 🟢 新功能;零 🔴 行為改動;零 🔵 重構)

### Backend
| 檔 | 動作 | 類 |
|---|---|---|
| `services/warrant_issuers.py`(新) | 對照 fetch(36_L/36_O,httpx + FAKE 層同 warrants.py 模式)+ **7 天級 cache(同 SC-1)**;`compute_issuer_rank` 純函式;`get_issuer_rank` lazy + 檔 cache + `_run_once` dedup;簡稱裁剪 `_short_issuer_name`;**issuer map accessor 走 get_drift_map 語義(miss → 空 map + 背景 fetch,SC-4)** | 🟢 |
| `services/warrants.py` | `get_underlying_warrants` merge issuer 欄(lazy import warrant_issuers,同 iv_history 防循環模式,~+12 行) | 🟢 |
| `routes/warrants.py` | `GET /api/warrants/issuers/rank`(**置於 `/{stock_id}` route 之前**,雖兩段 path 不衝突,防未來歧義)| 🟢 |
| `tests/test_warrant_issuers.py`(新) | SC-1/SC-2/SC-3 全部 | 🟢 |
| `tests/test_warrants_service.py` | 新增 issuer merge 測試(既有測試零改動) | 🟢 |
| `tests/test_warrants_routes.py` | 新增 rank route 測試(既有零改動) | 🟢 |
| `tests_e2e/fixtures/warrants/t187ap36_L.json`、`mopsfin_t187ap36_O.json`(新) | FAKE fixtures(與既有 fixture 權證代號一致,元大+第二發行商) | 🟢 |
| `tests_e2e/test_api_warrants.py` | +issuers/rank contract test | 🟢 |

### Frontend
| 檔 | 動作 | 類 |
|---|---|---|
| `lib/warrant-data.ts` | `WarrantTerm` +`issuer_name?` +`issuer_tier?`;`IssuerRankRow` / `IssuerRankPayload` 型別 | 🟢 |
| `lib/warrant-utils.ts` | `WarrantFilters` +3 鍵;`filterWarrants` +3 分支;`WARRANT_PRESETS`;`isExitCliff(daysLeft)`、`isNearSoldOut(row)` 純函式 | 🟢 |
| `lib/api.ts` | `api.issuerRank(options)` | 🟢 |
| `hooks/useIssuerRank.ts`(新) | useQuery,`{data, loading, error, refresh}` shape | 🟢 |
| `components/IssuerRankPanel.tsx`(新) | 收合面板 + 排行表 + proxy 標注 | 🟢 |
| `components/WarrantSelector.tsx` | preset 按鈕、3 新 filter input、發行商欄、懸崖/近售罄 badge、分點欄+載入按鈕、掛 IssuerRankPanel | 🟢 |
| `lib/changelog.ts` | VersionEntry 0.29.0(MINOR:新 panel+新指標;寫 entry 前讀 changelog-conventions) | 🟢 |
| tests:`warrant-utils.test.ts` 增、`WarrantSelector.test.tsx` 增、`IssuerRankPanel.test.tsx` 新、`useIssuerRank.test.ts` 新 | 對應 SC-5~SC-10 | 🟢 |

### E2E
| 檔 | 動作 | 類 |
|---|---|---|
| `e2e/helpers/selectors.ts` | +`issuer-rank-panel`、`issuer-cell`、`preset-swing`、`flow-load-btn`、`cliff-badge`、`soldout-badge` testid | 🟢 |
| `e2e/specs/equity.spec.ts` | +E15 發行商欄、+E16 preset 套值、+E17 排行面板展開(編號接現有) | 🟢 |

### 既有測試預期
- 該紅的:**無**(零 🔴)。
- 不該紅的:全部(=白名單)。任何既有測試紅 = 打到無關東西,停下查。

## 5.1 Review 輪次記錄

- Round 1(2026-07-14):P0×1(R1 quotes 熱路徑 caller 漏列)、P1×3(R2 e2e 白名單不全 / R3 terms 來源與基準日未定 / R4 計分邊界三缺口)、P2×3(R5 spread 防護 / R6 分點欄豁免未記 / R7 對照 cache 與合併規則)— 全數 accepted 並修入 §1/§2/§7。
- Round 2(2026-07-14):P1×2(cache TTL §1/§5 矛盾 / min-max 退化 NaN→500)、P2×2(權重未歸一 / SC-10 cache 命中語義)— 全數 accepted 並修入;權重歸一 3/7·2/7·2/7,SC-10 採 cache 命中即顯示。**退出條件成立:無殘留 P0/P1。**

## 6. [auto-default] 決策記錄

- composite 權重 0.3/0.2/0.2 + min-max 正規化 | reason: 對齊 TWSE 評等權重方向(30/20/20),module 常數可調
- 兩週窗有效點門檻 8(≥8/10)| reason: 官方「兩週」未明文定義天數,10 檔 archive 取 8 容忍 2 洞
- tier 三分位(前/中/後段)且樣本 <5 檔 tier=null | reason: 中性文案 + 小樣本不評級
- 無 archive → 503 issuer_rank_not_ready | reason: 對齊現有 503 = 服務尚未就緒契約
- 懸崖閾值 21 日曆日 proxy | reason: 15 交易日無交易日曆基建,21 日曆日近似,tooltip 標注口徑
- E# 編號接現有序 | reason: 慣例
- changelog 0.28.0 → 0.29.0 MINOR | reason: user-visible 新 panel/指標(§7 規則)

## 6.1 Phase 5 自評記錄

- /code-review medium:3 finder agents(8 角度打包)→ 11 candidates → dedup 9 行動項。
- P1×3 全修(flow race / controlled input / 測試斷網),P2×6 全修(tier IO / stale-serve+backoff / clamp / 繁中 fallback / TIER dedup / map 重複讀併入 stale-serve)。
- 全部經紅測試或既有測試鎖定;無 rejected findings。

## 6.2 Phase 7 真實環境記錄(2026-07-14)

實測發現並修復(各自紅測試先行,commit [real-env] 標記):
1. TPEx 36_O 發行人名稱回全稱(台新/群益)→ 兩源一律過簡稱裁剪(203800d)
2. 權證代號跨年回收 ×1,967 + 現行權證未入年度表 → 舊發行商張冠李戴(051372 兆豐誤標元大)→ 申請日最新 + underlying 比對 guard(d427f71)
3. 36_L 對 2330 覆蓋率僅 23.3% → 名稱解析 fallback(lexicon 動態導出;覆蓋率 → 100%,全市場 attributed 30,490 檔)(9f28831)
4. cooldown 誤擋進行中建置 → 冷啟動 rank 503(631d298)
5. rank build 漏接 lexicon → 排行樣本缺口(83dfce7)

**Known Risk(據實標注,不阻擋出貨)**:元大 positive control 未過(back tier)。
成因可名狀:composite 未按價內外/天期分層,大書商(元大 6,028 檔、深價外 penny
權證占比高)iv_std/spread 中位數被產品組合結構墊高 — 臺大論文「分層比較」警告命中。
v1 排行反映「書商組合結構 × 造市品質」混合訊號;UI 已標注「未分層,跨規模比較請
保留」+「僅供排序參考」。v2 分層方向記 docs/next-time.md。
附帶:元大公布造市委買波動率逐檔抽樣比對未重跑(IV 反解 pipeline 沿 warrant-iv-drift
已驗證線,理由記 next-time)。

驗證證據:覆蓋率 100%(1117/1117)、rank attributed 30,490、負號輸入 -10 完整鍵入、
preset 六鍵套用(截圖)、分點欄手動載入 200 檔 join(T+1 未上料日 net 全 0 與分點 tab
一致)、console 零 error/warn。截圖 docs/specs/warrant-selector-enhance/screenshots/。

## 7. E2E 判準結論(e2e-conventions)

新使用者可感功能(新欄位/面板/preset)→ **需要 e2e**,歸 equity.spec.ts(E# 系列);fixtures 補 36_L/36_O。豁免記錄(commit 註明同此):
- 近售罄/懸崖 badge:vitest 覆蓋為主,e2e 豁免(fixture 需特製 ask 缺格局,成本高)。
- 分點欄手動載入(R6):vitest 覆蓋(預設不 fetch + 按鈕後 join),e2e 豁免 — flow 資料鏈全程已由 E14 覆蓋,selector 欄是同 payload 的 join 顯示,無新後端路徑。

self_review_head: 6d4c4fb09b2139d4426c2cef2787d42e8c06b963

## 8. Phase 8 回頭核(2026-07-14)

### 目標行為證據
- SC-1~SC-4:backend 752 passed(test_warrant_issuers 42 項)+ e2e contract(test_api_warrants 15 項)
- SC-5~SC-10:frontend 788 passed(IssuerRankPanel 6 / WarrantSelector 25 / warrant-utils 27 / useIssuerRank 4)
- SC-11:playwright E15/E16/E17 綠(38 passed 全套)
- 真實環境:覆蓋率 1117/1117、rank attributed 30,490、截圖 ×4(docs/specs/warrant-selector-enhance/screenshots/)

### 白名單逐條
1. 既有六篩選鍵語義 ✓(既有 vitest 全綠)
2. 排序預設 slr asc ✓(E8 綠)
3. /api/warrants/{id} 既有欄位不變 ✓(routes 既有測試零改零紅;只加欄)
4. quotes 輪詢 / iv_drift / mispricing ✓(E12 + 既有測試綠)
5. flow tab 行為不變 ✓(E14 + WarrantFlowPanel 測試綠)
6. selector 不自動 fan-out ✓(vitest:預設不 fetch + flowSymbol 換標的 race 測試)
7. iv_history 格式 / drift 演算法不動 ✓(diff 僅 +load_recent_archives 公開 accessor;test_warrant_iv_drift 零改)
8. e2e 既有斷言不動 ✓(E8-E14 + NTD2 全綠,spec 既有行零改)
9. quotes 熱路徑零新同步上游 ✓(sync accessor ×3 + conftest 斷網 + tier 零重複 IO 測試)

### Migration 可逆性
無 migration;revert commits 即回滾,新 cache 檔(map v2 / rank)孤立無害、自帶版本。
