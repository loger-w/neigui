# current-state — mod/warrant-ux-feedback

日期:2026-07-15。基準 HEAD:b2ad56d(main 與 origin 同步後開分支)。
來源:user 實際使用權證功能(selector + 權證分點)後的回饋批次。

## Baseline 測試(本 session 實跑,同一 tree)

- backend `python -m pytest -q -k "warrant or issuer"` → **204 passed**(3.23s)
- frontend `npm test`(vitest run)→ **83 檔 788 passed**(14.2s)
- 另有同 session 五個 spec-vs-impl reviewer 實跑記錄:backend 全套 760 passed / 1 skipped、e2e E17 單跑 passed、tsc -b 零錯誤

## 現況 vs 目標(逐 item)

### Item 1:刪除發行商排行面板

| | 現況 |
|---|---|
| UI | `WarrantSelector.tsx:357` 掛 `<IssuerRankPanel />`(`IssuerRankPanel.tsx`,預設收合) |
| Hook | `useIssuerRank.ts`(+ test);`lib/api.ts` getIssuerRank;`lib/warrant-data.ts` IssuerRank 型別 |
| Backend | `routes/warrants.py:51-62` GET `/api/warrants/issuers/rank`;`services/warrant_issuers.py` compute_issuer_rank + `_RANK_CACHE_VERSION=3` rank cache(`warrant_issuer_rank_latest.json`) |
| 測試 | `test_warrant_issuers.py`(rank 相關 40+ 條)、`test_warrants_routes.py` rank 3 條、`tests_e2e/test_api_warrants.py::test_issuer_rank_contract`、前端 `IssuerRankPanel.test.tsx`(6)+ `useIssuerRank.test.ts`、e2e `equity.spec.ts::E17` |
| 目標 | 面板刪除。**Backend 刪除範圍待 Phase 2 拍板**(見交叉依賴) |

### Item 6a-發行商欄(與 Item 1 交叉)

- `WarrantSelector.tsx:63` HEADERS「發行商」、`:499-517` issuer-cell(TIER_CLASS/TIER_TEXT 來自 warrant-utils)
- Backend merge:`services/warrants.py` get_underlying_warrants 對每列 merge `issuer_name`/`issuer_tier`(走 `warrant_issuers.py` 的 sync cached accessor:get_issuer_map_cached / get_issuer_lexicon_cached / get_issuer_tier_cached + map cache `_CACHE_VERSION=2`)
- 測試:`test_warrants_routes.py::test_warrants_rows_carry_issuer_*`、`tests_e2e::test_warrants_rows_carry_issuer_name`、e2e E15、36_L/36_O fixtures
- **交叉依賴**:面板(item 1)+ 發行商欄(6a)都刪後,`warrant_issuers.py` 全模組(map/lexicon/rank)零 consumer。`warrant_iv_history.py:160` 只有 docstring 提及(依賴方向是 issuers→iv_history 的 load_recent_archives,反向無依賴),iv-drift 不受影響。
- 孤兒 cache 檔:`warrant_issuer_map_latest.json` / `warrant_issuer_rank_latest.json`(檔案系統殘留,無害)

### Item 2:刪除波段 preset

- `lib/warrant-utils.ts:48-63` WARRANT_PRESETS(唯一 preset:swing)
- `WarrantSelector.tsx:193-204` preset 按鈕(data-testid="preset-swing")
- 測試:`WarrantSelector.test.tsx` describe「波段 preset」、e2e E16、`selectors.ts:58` presetSwing
- 注意:`ui/RangeSelector.tsx` 的 preset chips 是無關共用元件(日期範圍),**不動**

### Item 3:新增重製篩選按鈕(🟢 新功能)

- 現況無此按鈕;`DEFAULT_FILTERS` 已存在(warrant-utils.ts),換標的 reset 邏輯在 `WarrantSelector.tsx:117-121`(setFilters(DEFAULT_FILTERS) + filterEpoch+1)— 重製按鈕可直接復用同一機制
- 現況排序 state(sortKey/sortDir)不在 filters 內;重製是否含排序待 Phase 2

### Item 4:篩選列 UI 美化

- 現況:`WarrantSelector.tsx:205-349` — 原生 `<input type="number">`(瀏覽器預設 spinner)、原生 `<input type="checkbox">`(委買量>0)、7 組 label+input 直接 flex-wrap 平鋪
- 專案內既有 pattern:`ui/RangeSelector.tsx` 隱藏原生 spinner + chips;Radix UI primitives 已在依賴內
- 目標:好看的 checkbox 與數字調整按鈕(具體設計 Phase 2/實作期走 frontend-design + bencium-controlled-ux-designer,user memory 指示)

### Item 5:欄位介紹敘述(🟢 新功能)

- 現況:HEADERS(`WarrantSelector.tsx:58-79`)純文字 th,無任何說明;部分 badge 有 title(近到期 :526、近售罄 :545)
- 目標:每欄有介紹 — ? icon tooltip 或 guide 面板,形式待 Phase 2 拍板

### Item 6a:刪市場欄

- `WarrantSelector.tsx:62` HEADERS「市場」、`:496-498` cell(上市/上櫃)
- payload `market` 欄位保留(backend 不動;上市/上櫃資訊仍在 row data,只是不顯示)

### Item 6b:現價/買價/量/賣價/量 呈現改善

- 現況:三欄 — 現價(:535)、買價/量(:536-538,`fmtVol` = "12.34/56" 斜線串)、賣價/量(:539-552)。user 反映「看起來很不直覺」
- fmtVol 格式 `價格/量` 與欄名「買價/量」雙斜線疊加是主要混淆源;近售罄 badge 掛在賣價欄內
- 具體方案 Phase 2 提案(候選:價量分色/分行、bid-ask 合併一欄帶價差視覺、量退居 title)

### Item 6c:刪 selector「載入分點」欄

- **釐清:selector 內有兩個分點功能,勿混**:
  1. row 展開「展開分點」(`:463-471` + `:598-634`):單一權證 T-1 分點明細(warrant_brokers,per-branch 買賣超,**有意義**)— e2e E11
  2. 「載入分點」欄(`:398-414` 表頭按鈕 + `:588-590` flow-net-cell + `:110-111` flowSymbol/useWarrantFlow + `:123-128` flowNetByWid):flow 聚合的 per-warrant 淨買賣超 — **全分點守恆恆等式下幾乎恆為 0**(review P2 已證),user 說的「意義不大」即此
- 目標:刪 (2)。(1) 保留(user 未點名)
- 交叉:useWarrantFlow 另一 consumer 是 `WarrantFlowPanel`(權證分點 tab)。**tab 本身去留待 Phase 2 問**(user 開頭「直接包含權證分點」語意不明)。只刪 selector 欄 → useWarrantFlow/backend flow 全保留;連 tab 刪 → flow service/route/tests/E14/NTD2 全入 scope
- 測試:`WarrantSelector.test.tsx` describe「分點欄手動載入(SC-10)」、selectors.ts flow 系列(tab 用)

### Item 7:API 載入偏慢

- **本次 mod 不處理**,後續獨立 /perf(需先 profile 真實 bottleneck;items 1/6a 刪除本身會少掉 issuer merge 與 rank fetch,先改再量才不會白做)

## 不能破壞的既有行為(白名單草稿,Phase 2 定稿)

1. 權證表核心鏈:terms + quotes merge → filter → sort(既有 8 篩選鍵語意、預設差槓比升序)不變
2. 盤中 15s 輪詢 / 收盤停輪詢 / 快照基準日顯示不變
3. row 展開:IV 時序圖 + T-1 分點明細(E11/E12/E13)不變
4. 認購/認售 badge 零色相、估價標籤中性、IV 趨勢中性文案(SC-5/SC-6 鎖)不變
5. 換標的 reset(篩選歸零 + 展開收合 + epoch remount)不變
6. 打字中間態(defaultValue + epoch remount 機制)不變 — UI 美化不得退回 controlled value 沖掉「-」「0.」問題
7. 權證分點 tab(若拍板保留):E14/NTD2 行為不變
8. no_trading_day / refresh=true / cache 版本慣例不變

## Backward compat / migration

- 純內部專案,無外部 API consumer。刪 `/api/warrants/issuers/rank` 不需 deprecate window(唯一 caller 是同 repo 前端)
- get_underlying_warrants 移除 issuer_name/issuer_tier 欄位 = payload 縮欄,前端同 PR 同步改,無 compat 議題
- 孤兒 cache 檔兩枚可順手刪(檔案系統,非 code)
- e2e fixtures 36_L/36_O 與 FAKE issuer 分支若 backend 全刪則一併移除(conftest FAKE 層)
