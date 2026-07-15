# change-spec — mod/warrant-ux-feedback

日期:2026-07-15。基準:current-state.md(同目錄)。規模:**L**(≥5 檔、跨前後端、多 caller)→ Phase 3 max 2 輪 review。
來源:user 實際使用回饋 7 items + spec-vs-impl review 三條測試補鎖(user 拍板全納入)。

## 0. 拍板決策記錄(brainstorm 結論)

| 問題 | 拍板 |
|---|---|
| 發行商刪除範圍 | **前後端全刪**(service/route/tests/fixtures/e2e 一次清乾淨) |
| 權證分點 tab | **不動**(user:先專注權證篩選;tab 僅補既有行為測試鎖,不改功能) |
| 欄位拖曳範圍 | **拖曳調順序 + 顯示/隱藏 + 恢復預設**,localStorage 持久化 |
| 欄位說明形式 | **整合進欄位選單**(每欄勾選 + 一行說明)+ 表頭 hover title |
| 價量呈現 | **價主量副兩行**(價格主體、`×N張` 小字淡色第二行) |
| 拖曳實作 | **欄位選單內拖曳**(原生 HTML5 dnd + 上/下移按鈕),零新依賴 |
| review 三條測試補鎖 | **全納入**(獨立 🟢 commit) |
| API 效能(item 7) | **本次不做**,後續獨立 /perf(刪除批落地後再 profile 才準) |

## 1. 成功條件(SC)

| SC | 內容 | 量法 |
|---|---|---|
| SC-1 | 發行商功能全移除:UI 無排行面板與發行商欄;`GET /api/warrants/issuers/rank` → 404;backend 無 `warrant_issuers.py`;`get_underlying_warrants` payload 不含 `issuer_name`/`issuer_tier` | `grep -ri issuer frontend/src backend/{services,routes,tests,tests_e2e}` 僅剩 changelog 歷史條目;pytest/vitest/e2e 全綠 |
| SC-2 | 波段 preset 移除:UI 無按鈕、`WARRANT_PRESETS` 不存在、E16 刪除 | grep WARRANT_PRESETS 零 hit(RangeSelector 的日期 preset chips 不受影響) |
| SC-3 | 市場欄自表格移除;payload `market` 欄位保留 | vitest th 斷言;`test_warrants_service` 現有 market 欄位斷言仍綠 |
| SC-4 | selector「載入分點」欄移除(表頭按鈕 + flow-net-cell + flowSymbol state);權證分點 tab 行為不變 | vitest;e2e E14/NTD2 綠;`useWarrantFlow` 僅剩 WarrantFlowPanel 一個 caller |
| SC-5 | 重製篩選按鈕:調整多個篩選鍵 + 排序後按下 → filters=DEFAULT_FILTERS、sort=差槓比 asc、輸入框顯示同步清空(epoch remount)、rows 回全量 | vitest 元件測試;e2e E19 |
| SC-6 | 欄位選單:(a) 勾選隱藏即時生效 (b) 拖曳或上/下移調順序即時生效 (c) reload 後保留(localStorage)(d) 恢復預設 (e) 每欄一行繁中說明 (f) 「代號」欄不可隱藏 | vitest(prefs 純函式 + 選單元件);e2e E18(資料級:隱藏欄 th 消失 + 調序後欄序改變 + reload 持久) |
| SC-7 | 價量兩行:欄名改「現價 / 委買 / 委賣」,cell 兩行結構(第二行 `×N張` 淡色小字;null 顯示 `—` 單行),近售罄 badge 掛委賣欄 | vitest 結構斷言;E8 斷言擴充(`×\d+張` 出現);DevTools 截圖 |
| SC-8 | 篩選列美化:原生 number spinner 隱藏、自製 −/+ stepper 可用、checkbox 統一 `ui/checkbox` 樣式、篩選項分組排列;**行為不變**(八鍵語意、打字中間態機制) | 既有 filterWarrants/中間態測試綠;新 stepper 單元測試;截圖 + V# baseline |
| SC-9 | 三條測試補鎖落地:(a) WarrantFlowPanel width<640 疊直分支 (b) TPEx 到期權證過濾 (c) `/flow` bad_symbol 400 契約 | 三條新測試綠;(a) 斷言 grid-cols-1 |
| SC-10 | changelog `0.31.0`(MINOR,UX 大改)entry;白名單(§2)全數保留 | changelog.ts;白名單逐條證據(Phase 8) |

## 2. 不能破壞的既有行為白名單

1. terms + quotes merge → filter → sort 核心鏈;八篩選鍵語意;預設排序差槓比升序
2. 盤中 15s 輪詢 / 收盤停輪詢 / 快照基準日與最後更新顯示 / 重新整理按鈕
3. row 展開:IV 時序圖 + T-1 分點明細(E11/E12/E13)
4. 中性色紀律:認購/認售 badge 零色相、估價標籤、IV 趨勢中性文案(SC-5/SC-6 舊鎖不動)
5. 換標的 reset:篩選歸零 + 展開收合 + epoch remount;**欄位偏好為全域設定,不隨標的 reset**
6. 篩選輸入打字中間態機制(defaultValue + epoch remount),美化不得退回 controlled value
7. 權證分點 tab 全行為(E14/NTD2)
8. no_trading_day / refresh=true / cache 版本慣例
9. 空狀態文案「此標的無掛牌權證」;quotes error 顯示
10. 近到期 / 近售罄 badge 行為與 title 文案

## 3. Backward compat / migration

- payload 縮欄(`issuer_name`/`issuer_tier` 移除)前後端同 PR 同步,無外部 consumer,無 compat 議題
- localStorage 新 key `neigui.warrant-columns.v1`:`{order: string[], hidden: string[]}`;reconcile 規則(R6 補齊):未知 id 忽略、registry 新欄按預設位置插入、**shape 驗證失敗(非僅 parse throw)一律 fallback 預設**、**hidden 過濾掉 lockVisible id(防「代號」被舊資料/手改永久隱藏)**、**order 去重**;各規則一條純函式測試
- 孤兒 cache 檔 `warrant_issuer_map_latest.json` / `warrant_issuer_rank_latest.json` 順手刪(檔案系統,非 code)
- 可逆性:全部刪除可由 git revert 還原;localStorage key 廢棄時無需清理(讀不到就用預設)

## 4. E2E 歸屬(e2e-conventions 判準表結論)

| 動作 | 明細 |
|---|---|
| 刪 | E15(發行商欄)、E16(preset)、E17(排行面板);selectors.ts `issuerCell`/`issuerRankPanel`/`presetSwing`;fixtures 只刪 `t187ap36_L.json`/`mopsfin_t187ap36_O.json`(在 `tests_e2e/fixtures/warrants/` 與主表同目錄,`t187ap37_L.json` 是主表**必留**;皆 service 直讀不在 MANIFEST);兩個 conftest 的 issuer import/monkeypatch 區塊;tests_e2e issuer 契約測項 |
| 改 | E8 斷言擴充(價量兩行 `×N張`);E8-E13 受欄位結構影響的 selector 適配(以 testid 為主,預期影響小) |
| 新 | E18 欄位選單(隱藏 + 調序 + reload 持久,資料級斷言);E19 重製篩選 |
| V# | 權證表視覺 baseline(篩選列 + 表格兩行 cell)— `e2e-update-snapshots` workflow 產生,diff 進 PR |
| 契約 | tests_e2e 補 `/flow` bad_symbol 400(SC-9c) |
| Rotation | 現行基準日 2026-06-26,距今 19 天 < 90,不需 rotate |
| 注意 | fixture 刪除後跑 e2e 前清 `e2e/.cache`;E18/E19 selector 對 page snapshot 校齊,不憑記憶;每個新 test 帶 `// 痛點:` 註解 |

## 5. Out of scope

- 權證分點 tab 任何功能改動(含明細表淨買賣超欄替代口徑 — 已在 docs/next-time.md)
- API 載入效能(後續 /perf,刪除批落地後 profile)
- MISPRICE_FAIR_BAND 校準、IV drift rising 側 de-mean(next-time)
- 發行商信任排行的口徑改良(已整組移除;歷史在 git)

---

# Diff 級 spec(Phase 3)

## 逐檔改動(🔴 行為 / 🟢 新功能 / 🔵 純重構)

### Commit 1 🔵 refactor(frontend): HEADERS → column registry(行為不變)

- `frontend/src/lib/warrant-columns.tsx`(新檔):`WARRANT_COLUMNS: WarrantColumnDef[]` — `{id, label, desc, sortKey?, defaultVisible: true, lockVisible?, cell(row, ctx)}`。把 `WarrantSelector.tsx` RowPair 對應 HEADERS 的 20 個 td 搬進 registry(含市場/發行商欄 — 本 commit 不刪任何欄);`ctx = {slrClass}`。desc 先填占位一句(Commit 6 定稿全部文案)。
- **registry 邊界(R5)**:展開按鈕 td(:462-472)與 flow-net-cell td(:588-590)**留在 registry 外**(前者常駐首欄,後者 Commit 3 刪);展開列 `colSpan={HEADERS.length + 2}`(:594)改由 registry 長度推導(本 commit = `WARRANT_COLUMNS.length + 2`,Commit 3 刪 flow td 後 `+1`)。
- `WarrantSelector.tsx`:HEADERS 移除,th/td 迭代 `WARRANT_COLUMNS`;順序寫死 = 現狀順序。**無選單、無 localStorage**(本 commit 零行為差)。
- 測試:既有 `WarrantSelector.test.tsx` **零改動**,改完全綠(重構鐵則)。`warrant-columns` 純函式部分(cell 對 null 的 `—` 行為)沿用既有測試覆蓋。
- 既有測試預期:全綠不動。

### Commit 2 🔴 fix(warrants): 發行商功能前後端全刪

Backend:
- 刪 `backend/services/warrant_issuers.py`、`backend/tests/test_warrant_issuers.py`
- **`backend/tests/conftest.py`:刪 `_reset_warrant_issuers` autouse fixture(:53-68,`import services.warrant_issuers`)— 漏刪 = 全套 pytest ImportError 全紅**(R1)
- `backend/routes/warrants.py`:刪 `GET /issuers/rank` route 與 import
- `backend/services/warrants.py`:`get_underlying_warrants` 刪 issuer merge(issuer_name/issuer_tier 兩鍵與 accessor import)
- `backend/tests/test_warrants_routes.py`:刪 `test_issuer_rank_*` 3 條、`test_warrants_rows_carry_issuer_*` 2 條
- `backend/tests_e2e/test_api_warrants.py`:刪 `test_issuer_rank_contract`、`test_warrants_rows_carry_issuer_name`
- `backend/tests_e2e/conftest.py`:刪 `import services.warrant_issuers` 與 `_map_mem`/`_rank_mem` monkeypatch 區塊(:33-39);FAKE issuer fixture 讀取邏輯在 warrant_issuers.py 內部,隨模組刪除,conftest 無獨立 FAKE 分支(R3)
- 刪 fixtures(位於 `tests_e2e/fixtures/warrants/`,與主表 fixture **同目錄**,勿刪錯):**只刪** `t187ap36_L.json`、`mopsfin_t187ap36_O.json`(issuer 專屬,warrant_issuers.py:147/155/325 讀)。**`t187ap37_L.json` 保留** — 它是權證基本資料主表 fixture(warrants.py:240 讀,E8-E13 的 terms 資料源;strata mod 加的 2317 列留著無害)(R2)。`mi_index_0999.json` Phase 4 grep 確認共用情況,共用則留
- 刪孤兒 cache:`backend/data/cache/chip/warrant_issuer_*.json`
Frontend:
- 刪 `IssuerRankPanel.tsx`(+test)、`useIssuerRank.ts`(+test)
- `lib/api.ts`:刪 `getIssuerRank`;`lib/warrant-data.ts`:刪 IssuerRank/issuer 型別與 row 欄位;`lib/warrant-utils.ts`:刪 `TIER_CLASS`/`TIER_TEXT`
- `warrant-columns.tsx`:刪發行商欄 def;`WarrantSelector.tsx`:刪 `<IssuerRankPanel />` 掛載與 import
E2E:
- `e2e/specs/equity.spec.ts`:刪 E15、E17;`e2e/helpers/selectors.ts`:刪 `issuerCell`/`issuerRankPanel`
- 既有測試預期:**該紅(刪除形式)** = 上列被刪測項;其餘全綠。`WarrantSelector.test.tsx` 引用 issuer 的斷言同步刪。

### Commit 3 🔴 fix(frontend): 刪 preset / 市場欄 / 載入分點欄

- `lib/warrant-utils.ts`:刪 `WARRANT_PRESETS`(+ `warrant-utils.test.ts` preset 測項)
- `WarrantSelector.tsx`:刪 preset 按鈕;刪 flowSymbol/flowHook/flowNetByWid/flowLoaded/表頭載入按鈕/flow-net-cell/`useWarrantFlow`+`formatNet` import;`WarrantSelector.test.tsx` 刪「波段 preset」「分點欄手動載入(SC-10)」describe
- `warrant-columns.tsx`:刪市場欄 def
- e2e:刪 E16;selectors 刪 `presetSwing`
- 既有測試預期:該紅(刪除形式)= 上列;`useWarrantFlow.test.ts` 不動(hook 留給 tab)。

### Commit 4 🔴 fix(frontend): 價量兩行呈現

- `warrant-columns.tsx`:**委買/委賣兩欄** def 改兩行 cell(`fmtVol` 廢棄 → 新 `PriceVolCell` 結構:第一行價格、第二行 `×N張` `text-ink-dim text-[0.7rem]`;近售罄 badge 移入委賣 cell 第一行)。**現價欄無量資料恆單行**(R8),只統一 cell 結構、欄名不變
- **價量缺值拍板(R7)**:price null → `—` 單行(無第二行);price 有值但 vol null → 省略第二行;vol 0 → `×0張` 照列(委買量 0 與缺報價是不同事實)。vitest 三分支各一斷言
- `WarrantSelector.test.tsx`:🔴 先改斷言(兩行結構 + 欄名「委買」「委賣」)→ 紅 → 實作 → 綠
- e2e E8:斷言擴充 `×\d+張`,**鎖定 fixture 中已知有量的列**(對 snapshot 校齊目標列,不靠巧合;R7)
- 既有測試預期:該紅 = fmtVol 相關與欄名斷言;近售罄 badge 測試(斷言 badge 存在)應保持綠。

### Commit 5 🟢 feat(frontend): 重製篩選按鈕

- `WarrantSelector.tsx`:篩選列尾加「重製篩選」按鈕 → `setFilters(DEFAULT_FILTERS); setSortKey("spread_lev_ratio"); setSortDir("asc"); setFilterEpoch(+1)`
- 新測試:vitest(調多鍵+排序→按鈕→全回預設+rows 回全量);e2e E19
- 既有測試預期:全綠。

### Commit 6 🟢 feat(frontend): 欄位選單(順序/顯示/說明)

- `lib/warrant-column-prefs.ts`(新檔,純函式):`loadColumnPrefs`/`saveColumnPrefs`/`reconcilePrefs(prefs, registryIds)`/`moveColumn(order, id, dir|toIndex)`;localStorage key `neigui.warrant-columns.v1`;+ 單元測試六項(reconcile 未知 id / 新欄插入 / 壞 JSON fallback / shape 錯誤 fallback / hidden 剔除 lockVisible id / order 去重)(R9)
- `components/WarrantColumnMenu.tsx`(新檔):Radix Popover(沿 `BrokerFilterPopover` pattern);每列 = 拖曳把手(HTML5 draggable)+ `ui/checkbox`(顯示)+ 欄名 + desc 小字 + 上/下移按鈕(aria-label 繁中);「恢復預設」;「代號」欄 checkbox disabled(lockVisible)
- `warrant-columns.tsx`:20 欄 desc 文案定稿(繁中一行,含公式欄的口徑,如差槓比 = 價差比 ÷ 實質槓桿)
- `WarrantSelector.tsx`:接 prefs state;th 加 `title={desc}`;visibleColumns = reconcile 後 order 過濾 hidden;**展開列 colSpan = 可見欄數 + 1**(R5),vitest 補「隱藏欄位後展開列 colSpan 跟著縮」斷言
- e2e E18;selectors 加 `columnMenuBtn` 等 testid
- 既有測試預期:全綠(預設 prefs = 現狀順序全顯示)。

### Commit 7a 🟢 feat(frontend): ui/NumberField 元件(R4 拆分)

- `ui/number-field.tsx`(新檔):隱藏原生 spinner(沿 RangeSelector pattern)+ −/+ stepper 按鈕 + defaultValue/onChange 簽名與原生一致;+ 單元測試
- 本 commit 尚無 caller,零行為差。

### Commit 7b 🔴 fix(frontend): 篩選列換用 NumberField + 分組排列

- `WarrantSelector.tsx`:8 個 number input 換 `NumberField`;checkbox 換 `ui/checkbox`;篩選項分組(型別/報價門檻/風險門檻)排列
- 順收 next-time 觸發條目:篩選列 input 補 `name` 屬性(DevTools a11y 提示,2026-07-11 記錄「下次動篩選列時」— 已觸發)
- **實作前先讀 `frontend-design` + `bencium-controlled-ux-designer` + `frontend-conventions`**(user memory 指示;響應式與 token 慣例)
- 既有測試預期:中間態與 filter 語意測試**必須綠**(行為不變是本 commit 的鐵則);渲染結構斷言 hit 到的該紅則先改。

### Commit 8 🟢 test: 三條補鎖

- `WarrantFlowPanel.test.tsx`:mock width 500 case 斷言 `grid-cols-1`(P1)
- `backend/tests/test_warrants_service.py`:TPEx fixture 到期權證剔除測項
- `backend/tests_e2e/test_api_warrants.py`:`/flow` bad_symbol 400
- 既有測試預期:全綠。

### Commit 9 🟢 feat(frontend): changelog 0.31.0

- `lib/changelog.ts` 新 entry(寫前讀 `changelog-conventions`)

### Commit 10 chore: artifacts(change-spec/current-state/截圖/next-time)

- next-time.md 清理:刪「篩選列 name 屬性」(7b 已收)、「分點欄全 0 困惑」(欄已刪)、「發行商排行 v3 候選」與「declining 窗無鑑別度」(引擎已全刪,moot)

## 既有測試紅綠總表

| 測試 | 預期 |
|---|---|
| 被刪功能的測試(issuer 40+、preset、SC-10 分點欄、E15/E16/E17) | 該紅 → 隨 commit 刪除 |
| 兩個 conftest 的 issuer import(R1/R3) | **漏刪 = 全套 ImportError 全紅**;Commit 2 必同步刪 |
| fmtVol/欄名/價量渲染斷言 | 該紅 → Commit 4 🔴 先改 |
| 篩選語意 / 中間態 / 排序 / 輪詢 / row 展開 / badge / 空狀態 / tab(E14/NTD2)/ E8-E13 其餘 | **不該紅**;紅 = 打到白名單,停 |
| 新測試 | prefs 純函式、ColumnMenu、NumberField、重製、兩行結構、E18/E19、三條補鎖 |

## Known risks

- R1:HTML5 dnd 在 jsdom 不可測拖曳事件 → vitest 鎖上/下移按鈕與 reconcile 純函式,拖曳路徑由 E18 真瀏覽器鎖(判準表 grey zone 從嚴)
- R2:`mi_index_0999.json` 等 fixture 可能被非 issuer 測項共用 → Phase 4 刪除前逐檔 grep,共用則保留
- R3:registry 重構(Commit 1)是最大單一 diff;靠「既有測試零改動全綠」做行為不變證明
- R4:`radix-ui` Popover 在 jsdom 的 portal 行為 — 沿 BrokerFilterPopover 既有測試 pattern(該檔已有可跑先例)

## Phase 5 自評記錄(2026-07-15)

/code-review medium(8 finder angles,minimal-model dispatch):P0/P1 = 0;P2 候選 15 條 verify 後全數無需本次動作(5 refuted / 6 微優化量級可忽略 / 2 rule-of-three 第二份記 next-time / 2 YAGNI 推測)。

self_review_head: d1618f6

## Phase 6-8 驗證記錄(2026-07-15)

### 自動化(auto-verify,exit code 逐一驗)
- backend pytest 703 passed / 1 skipped;ruff 0 issues
- frontend tsc 0 errors;vitest 84 檔 800 passed;build 成功
- e2e 37 passed / 2 skipped(@live @visual);E18/E19 新增(修 3 處 selector 驅動問題:exact label、dispatchEvent dnd、reload 重搜)

### 真實環境(dev server + DevTools MCP,2330 真實 1107 檔)
| SC | 證據 |
|---|---|
| SC-1/2/3/4 刪除批 | headers 資料級核對:無市場/發行商/分點買賣超欄、無 preset 按鈕;grep issuer 全 repo 僅 changelog 歷史 |
| SC-5 重製篩選 | 1107 → 認售 184 → stepper 157 → 重製回 1107 + input 清空(資料級) |
| SC-6 欄位選單 | 截圖 SC-6_column-menu-open / SC-6_drag-reorder-hide-iv / SC-6_persist-after-reload;**真實滑鼠 HTML5 拖曳驗證成功**(類型↔名稱,E18 dispatchEvent 的補位驗證);隱藏 IV 不誤傷 IV百分位;reload + 重搜後順序與隱藏保留;恢復預設可用 |
| SC-7 價量兩行 | bid-cell「2.87 / ×3張」兩行結構(真實盤後報價);截圖 SC-7_SC-8_table-twoline-filterbar |
| SC-8 篩選列 | stepper 真實過濾生效(+10/+10 → 20);三群組 + NumberField + Checkbox 上線;截圖同上 |
| SC-9 三補鎖 | 疊直 grid-cols-1 vitest、TPEx 到期 pytest、/flow bad_symbol contract 皆綠 |
| SC-10 | changelog 0.31.0(v badge 真實顯示);白名單見下 |

### 白名單逐條
1. 核心鏈/八鍵語意/預設排序:E8/E9 綠 + 重製後排序回差槓比 asc 實測 ✓
2. 輪詢/快照基準日/重新整理:E8 綠 + 真實頁面顯示 ✓(盤後 refresh disabled 正常)
3. row 展開:IV 時序圖(60 日真實序列)+ T-1 分點明細(2026-07-14 富邦台南 +1000)實測 ✓;E11/E12/E13 綠
4. 中性色紀律:SC-5 舊測試綠 + conventions finder 零違規 ✓
5. 換標的 reset(欄位偏好不隨動):vitest 綠;localStorage 全域持久實測 ✓
6. 打字中間態:vitest epoch 測試綠(NumberField uncontrolled)✓
7. 權證分點 tab:E14/NTD2 綠,零改動(git diff 不含 WarrantFlowPanel.tsx)✓
8. no_trading_day/refresh/cache:backend 測試綠,未觸及 ✓
9. 空狀態/錯誤顯示:E10 綠 ✓
10. badge 行為:vitest 三分支綠 ✓
- Console:0 errors / 0 warnings(真實 session 全程)
- 展開列 colSpan 動態:隱藏 1 欄後 colSpan=18(17 可見 + 1)實測 ✓(R5 風險關閉)
