# market-page-v2-frontend — Phase 0 Brainstorm

Date: 2026-07-02
Scope: **L**(≥5 檔 + UI 跨 layout;Phase 1/2 各 max 3 輪 review)
規格來源:`docs/specs/market-monitor-v2/prompts-next-sessions.md` ④(2026-07-02 audit 51 findings 落地版,user 已拍板)— 本檔為其 /feat Phase 0 具體化。/goal 自動模式下,prompt ④ 視為 user 對設計方向的預先核准;Phase 0 只裁決其明示留給 Phase 0 的 3 個 open decisions。

## 目的

MarketPage V2 重組:接上 backend market-monitor-v2 P1~P4 已 ship 的 4 個新 payload 欄位(breadth / sector_breadth / sector_volume_ratio / sector_amount_share)+ universe filter 資訊,新 5 panel 佔三欄主視圖,舊 heatmap/leaderboard 收「經典檢視」折疊區雙軌保留。

## Open decisions 裁決(prompt ④ 留給 Phase 0)

| # | 問題 | 裁決 | 理由 |
|---|------|------|------|
| D-1 | Universe banner 措辭「注意處置股」vs「處置股」 | **「處置股」** | 實作只排處置股(P1 遞延注意股/全額交割),精確措辭零 overclaim;禁分項數字(CLAUDE.md §9),顯示排除總數(三類加總)+「以本次掃描範圍為準」註記,滿足 plan Phase 6 gate「顯示排除數」 |
| D-2 | 經典檢視折疊預設展開 or 改 M1 spec | **預設展開** | e2e M1 依賴 market-heatmap / market-leaderboard visible,預設展開則 M1 零改動;收合用 `hidden` attribute 保留 mount(§3 慣例) |
| D-3 | e2e populated fixture 入 scope? | **不入,列 next-time** | FAKE_FINMIND 缺全市場 TaiwanStockPrice window + TAIEX fixture,量大;本輪 M4+ assert 空狀態正確渲染不 crash |

## 成功條件(SC-N,每條附驗證方式)

- **SC-1 契約型別補全 + fixture lock**:`lib/market-types.ts` 照 payload 契約事實 0~12 補全(eod_as_of / universe_size / excluded_count / breadth(known_gaps 含)/ 三 sector list,全 `| null`,sector 用 plain string)。
  驗證:`cd frontend && npm test`(新 `market-types.test.ts` 把 `snapshot_full_2026-07-02_post-fixes.json` 當 fixture 跑 runtime contract 驗證:欄位存在 + 型別 + enum 值域,drift 立紅)+ `npm run build`。cycle-count: [see state.json]
  [amendment 2026-07-02: 原「tsc 層 lock(fixture 指派給 MarketSnapshot 型別)」不可行 — TS 對 JSON import 把 literal 欄位 widen 成 string,`centerline_cross: "above"` 無法指派給 union literal 型別;改 vitest runtime contract test 達成同等 drift 偵測]
- **SC-2 useMarketSnapshot backward-compat 零邏輯改動**:hook 邏輯不動,data 整包透傳,型別補齊後既有 caller 不 break。
  驗證:`git diff main -- frontend/src/hooks/useMarketSnapshot.ts` 無邏輯行改動 + 既有 hook 測試綠(`npm test useMarketSnapshot`)。cycle-count: [see state.json]
- **SC-3 breadth-svg 純渲染函式**:`lib/breadth-svg.tsx` 無 React 依賴;polyline 座標計算、null 值段落斷線(分段 polyline)、最後 bar signal dot 定位、slice 最後 60 交易日。
  驗證:`npm test breadth-svg`(含 null 斷線 case、全 null case、60-slice case)。cycle-count: [see state.json]
- **SC-4 MarketBreadthPanel 三態 + 降級**:McClellan + AD Line 趨勢圖 + 3 signal dot(thrust/centerline/divergence,只標不寫字);known_gaps 含 `taiex_unavailable` → divergence 區「TAIEX 資料缺」;breadth=null →「資料暫缺」;「資料至 {eod_as_of}」標示。
  驗證:`npm test MarketBreadthPanel`(資料態 / null 態 / taiex_unavailable / 無方向性文案 assertion)。cycle-count: [see state.json]
- **SC-5 MarketSectorBreadthHeatmap**:~44-45 cells 彈性(不 hardcode 數量);`onSectorClick(sector: string)` 中文名字串;ink 色階四檔(>70%/50-70%/30-50%/<30%),不用 bull/bear;三態(資料 / null / `[]`)。
  驗證:`npm test sector-breadth-svg` + `npm test MarketSectorBreadthHeatmap`(click emit callback、44 cells render、空態)。cycle-count: [see state.json]
- **SC-6 MarketSectorAmountShare**:降序表照後端序不重排;`share_delta_20ma` 正 = accent / 負 = ink-muted / null = "—" neutral;不寫「占大盤」絕對語意;三態。
  驗證:`npm test MarketSectorAmountShare`(順序 lock、Δ 顏色、null Δ、空態)。cycle-count: [see state.json]
- **SC-7 MarketSectorVolRatio**:`flag` 直接渲染 hot/cold dot,前端不重算 1.5/0.7;`today_vol_lots` 張 → 萬張(/10000)顯示;vol_ratio null → "—" 無 dot;三態。
  驗證:`npm test MarketSectorVolRatio`(flag 渲染、萬張換算、null ratio、空態)。cycle-count: [see state.json]
- **SC-8 MarketUniverseBanner**:文案「已過濾 ETF / 權證 / 處置股」+ 排除總數(不分項)+「以本次掃描範圍為準」;stale=true 顯示降級提示;universe_size/excluded_count 缺(null/undefined)→ banner 不顯示數字或整條隱藏(Phase 1 定)。
  驗證:`npm test MarketUniverseBanner`(文案精確 assert、禁分項數字 assert、stale 態)。cycle-count: [see state.json]
- **SC-9 MarketPage layout 重組**:header 下順序 = error banner(既有 last-good)→ universe banner → 新 5 panel 三欄主視圖 → 經典檢視折疊區(預設展開、`hidden` attribute 收合、普通 button 非 Radix);1440x900 新主視圖無 scroll(只量新視圖);頁級 error 處理不 key 在四個新欄位。
  驗證:`npm test MarketPage`(順序 / 折疊 / 舊 panel 保留 mount)+ Phase 6 chrome-devtools 1440x900 截圖量測 scrollHeight ≤ viewport。cycle-count: [see state.json]
- **SC-10 呈現紀律 lock**:全部新元件 (a) `expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull()`;(b) 日期標示用 payload `eod_as_of`,null 時文案「最近交易日」不寫「今日」;(c) skeleton/empty 判斷用 data 欄位存在與否,不用 loading。
  驗證:各 component test 內對應 assertion(grep 檢查每個新元件 test 檔含方向性文案 lock)。cycle-count: [see state.json]
- **SC-11 e2e 判準表落地**:(a) `backend/tests_e2e/test_api_market.py` 補 4 新 key 存在性 assert(允許 null);(b) `e2e/specs/market.spec.ts` M4+ 新 panel 空狀態不 crash specs(FAKE fixture 下四欄必 null/空);(c) `live-contract.spec.ts` L# 四欄 schema(@live,本機跑);(d) `visual.spec.ts` V3 baseline 更新;(e) M1 既有 testid 不破。
  驗證:`cd backend && python -m pytest -q tests_e2e/test_api_market.py`(FAKE mode)+ `cd e2e && npm test` + baseline 更新 workflow。cycle-count: [see state.json]
- **SC-12 changelog + 收尾證據**:`changelog.ts` 0.18.2 → **0.19.0** VersionEntry(ChangeItem 無 date 欄,照現行型別);chrome-devtools 截圖 ≥ 5(整頁 / heatmap hover / 訊號 dot / Δ 顏色 / banner)→ `docs/specs/market-monitor-v2/screenshots/`;verification.md 更新;CLAUDE.md §9 ≥ 2 lesson。
  [amendment 2026-07-02: 原「thrust dot(historical fetch 找觸發日)」不可行 — `/api/market/snapshot` 無 date 參數且 backend 在本輪白名單不動;prompt ④ 該句假設的能力不存在。改為「任一 signal dot 真實觸發截圖」— 2026-07-02 真實 payload centerline_cross="above" 觸發,截圖含 active dot;thrust 專屬渲染路徑由 MarketBreadthPanel component test(三 signal 全 active / 全 null)lock]
  驗證:`npm test changelog` + 截圖檔案存在 + verification.md diff。cycle-count: [see state.json]

## Edge cases(≥3,全入測試)

1. `breadth = null`(EOD 獨立降級,payload 仍 200)→ panel「資料暫缺」,頁級 error 不觸發
2. 三個 sector list = `[]`(fetcher 空 prices)→「無符合資料」空態,與 null 態區分,不 crash
3. `mcclellan_series` 前 ~38 筆 value=null(EMA 暖機)→ slice 60 後 polyline 斷線處理(分段),不畫 0 值假線
4. `known_gaps` 含 `"taiex_unavailable"` → divergence 區降級「TAIEX 資料缺」,其餘 breadth 正常
5. `eod_as_of = null` → 日期標示 fallback「最近交易日」
6. 三表 sector 集合不等長(drop rule 不同)→ 跨表 join 用 sector 名,絕不用 index
7. `vol_ratio = null` / `flag = null`(新 sector 無 20MA)→ "—" 無 dot
8. `share_delta_20ma = null` → "—" neutral 色
9. thrust/centerline/divergence 是最後一根 bar 的 scalar → dot 只畫在序列最後一點
10. 近似重複 sector 名(運動休閒/運動休閒類等)→ 照實渲染,不 merge

## Out of scope

- 全市場 %>20MA hero metric(V2.5 一行加)
- KY / 興櫃 universe 擴充
- concept-drill(只留 `onSectorClick` 接點,click 後本輪 no-op 或僅 console 級接點)
- populated e2e fixture(next-time;見 D-3)
- sector 近似重複名 display-level merge map(V2.5)
- 舊 MarketHeatmap / MarketLeaderboard 刪除(1 release 雙軌)
- backend 任何改動(契約 bug → 停下回報)

## 不要動(白名單)

backend 全部 / MarketHeatmap / MarketLeaderboard / useOptionsXxx / useChipXxx / `_CACHE_VERSION` 系列

## 色票對應(Phase 1 定案表,spec 的 ink-accent token 不存在)

spec 寫的 `ink-accent` 不在 index.css @theme;既有 token:`ink / ink-muted / ink-dim / accent / line / line-strong / bg / bg-deep / warn / danger`。Phase 1 design 定四檔 breadth 色階與 Δ 正負色的實際 token 對應(方向:accent 系 + ink 系,嚴禁 bull/bear)。
