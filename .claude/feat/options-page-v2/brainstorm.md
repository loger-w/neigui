# options-page-v2 — Brainstorm (Phase 0)

> 前置:brainstorm 對話 + 設計已於本 session 完成並經 user 確認,design spec 落
> `docs/superpowers/specs/2026-07-07-options-page-v2-design.md`(commit 9da6d79)。
> 本檔為 /feat Phase 0 加值 gate 產物:SC 編號 + 驗證方式 + edge cases + e2e 歸屬 + 分流。
> 設計細節不重抄,以該 spec 為準。

## 定調(已確認)

- 受眾:知道 call/put 但不會判讀的初階者(術語保留 + 每指標配判讀句)
- 使用時刻:盤後複盤 + 隔天開盤前(EOD 資料即足,不接即時)
- 幅度:重排資訊架構(四層:結論列 / 區間地圖 / 溫度計列 / 進階統計)
- UI 實作階段呼叫 `frontend-design` + `bencium-controlled-ux-designer`

## 成功條件(SC gate)

### Backend 計算修正(行為改動 🔴)

- **SC-1 靜態牆限價外側**:Call Wall 候選 = `strike ≥ spot`、Put Wall 候選 = `strike ≤ spot`;該側無 OI>0 → `None` + warning `static_wall_no_otm_candidate`;`band_width_pct` 恆 ≥ 0(單位 %,由 pytest assertion 驗)。
  驗證:`cd backend && python -m pytest -q tests/test_finmind_options.py -k oi_walls`(新增 `test_parse_oi_walls_static_call_wall_otm_only` / `_put_wall_otm_only` / `_no_otm_candidate_returns_none` / `_band_width_non_negative`)
- **SC-2 動態牆改淨增倉**:`net_increase(K) = oi_end(K) − oi_start(K)` 每側取最大正值;全 ≤ 0 → `None` + warning `dynamic_wall_no_net_increase`;payload 欄位 `window_activity_oi` → `window_net_increase_oi`(前後端同步)。
  驗證:pytest `test_parse_oi_walls_dynamic_net_increase*` + frontend `npm test`(types + card 測試同步改)
- **SC-3 hit rate 同步側別限制**:`parse_oi_walls_hit_rate` 用 T-1 close 作 spot 套 SC-1 規則;缺 close 樣本剔除 + warning `hit_rate_samples_dropped_no_close`,不回退 anchor=0。
  驗證:pytest `test_parse_oi_walls_hit_rate_otm_restricted` / `_drops_samples_without_close`
- (SC-1/2/3 附帶:`_CACHE_VERSION_OPTIONS_CHIP` bump 2,驗證併入上列測試)

### Backend 新資料(新功能 🟢)

- **SC-4 散戶小台多空比 endpoint**:`GET /api/options/retail_mtx?date=&refresh=`;公式 = (散戶多 − 散戶空) / MTX 總 OI,散戶多/空 = 總 OI − 法人多/空方;payload 含 `retail_long` / `retail_short` / `ratio` / `as_of_date` / `no_trading_day` / `data_quality_warnings`。
  驗證:pytest `tests/test_options_routes.py::test_retail_mtx_*`(happy / 502 / no_trading_day / 法人資料缺)+ probe fixture 先驗欄位名
- **SC-5 外資台指期淨未平倉 endpoint**:`GET /api/options/foreign_futures?date=&refresh=`;payload 含 `foreign_net_oi` / `long_oi` / `short_oi` / 同上共通欄位。
  驗證:pytest `test_foreign_futures_*` + probe fixture

### Frontend 四層架構(新功能 🟢;移除舊平列結構屬行為改動 🔴)

- **SC-6 今日結論列**:規則模板句(位置句三等分 / 越過壓力 / 跌破支撐 / 單側無牆 fallback + Max Pain 距現價句);資料缺漏省句不硬湊;**禁方向性文案**。
  驗證:vitest 純函式測試(`conclusion.test.ts` 覆蓋全部落區分支 + null 分支)+ `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()`
- **SC-7 區間地圖**:per-strike OI 分布(call=bear 綠 / put=bull 紅)+ spot 垂線 + 雙牆標記 + Max Pain ▼ + OI/成交量 toggle;取代 `OptionsStrikeLadder`。
  驗證:vitest 純 SVG renderer 測試(含顏色 binding data-testid 正向 assertion)+ e2e O# 更新 + DevTools MCP 截圖 `evidence/SC-7_range-map.png`
- **SC-8 籌碼溫度計列**:四格(外資選擇權[+期貨對照行] / 前十大交易人 / PCR 分位 / 散戶小台)各含方向色塊 + 主數字 + 判讀句 + 20 日 sparkline。
  驗證:vitest 各格 component 測試(happy / loading / error / 資料缺)+ 截圖 `evidence/SC-8_thermometer.png`
- **SC-9 進階統計收合層**:現四卡統計(hit rate 表 / PCR 次日報酬 / Spearman / NET 四組對照 + 說明 / 日夜盤)全數保留於此;`hidden` attribute;首屏不出現診斷數字(賣方總賠付 / 履約價數 / call-only)。
  驗證:vitest(收合展開 + 內容存在)+ e2e O#(展開流程)+ 截圖 `evidence/SC-9_advanced.png`
- **SC-10 Max Pain 呈現調整**:主數字旁「距現價 ±x.x%」;術語 tooltip(繁中 ≤ 2 句)覆蓋 Max Pain / OI 牆 / PCR / delta 等效淨部位 4 詞。
  驗證:vitest + 截圖(併 SC-8/9 截圖可)

### 收尾

- **SC-11 changelog**:MINOR bump 新 VersionEntry(寫前讀 `changelog-conventions`)。
  驗證:`frontend/src/lib/changelog.ts` diff + vitest changelog 既有測試綠

## Edge cases(≥3)

1. **單側無價外 OI**(大漲後上方無 call OI):Call Wall = null → 結論列「上方無明顯 OI 牆」、RangeMap 不畫該牆、band_width null 不是負數。
2. **spot 恰在牆上 / 雙牆同值**:落區判定邊界(`spot == call_wall` 算區間內上緣,不算突破;突破 = 嚴格大於)。
3. **PCR 週合約 / 資料不足**:溫度計 PCR 格顯示「資料不足」fallback,不擋其他三格(failure isolation 沿用)。
4. **MTX 法人資料當日未發布**:retail_mtx 回 `no_trading_day` 或 warning,溫度計格顯示「—」,不 502 整頁。
5. **spot 缺**(TX 期貨未發布):RangeMap 無 spot 線、結論列省略位置句、SC-1 側別過濾退化 → 該日 walls 回 null + warning(不用 0 當 spot)。
6. **無交易日**:既有 `no_trading_day` banner 行為不變,結論列用 as_of_date 資料。

## E2E 歸屬(e2e-conventions 判準表,Phase 3 同步動)

| 改動 | 歸屬 | 動作 |
|---|---|---|
| options mode 頁面結構大改(SC-6~10) | `e2e/specs/options.spec.ts`(O#) | 既有 O# selector 大量失效 → 改寫 O# + 新增結論列/收合層 spec;selector 對 snapshot 不憑記憶 |
| 新 endpoint retail_mtx / foreign_futures(SC-4/5) | `backend/tests_e2e/test_api_*.py` + `live-contract.spec.ts`(L#) | contract test 必補;新 dataset 接入 → `@live` tag,本機 `npm run test:live` |
| 視覺 layout 大改 | `e2e/specs/visual.spec.ts`(V#) | baseline PNG 更新(`npm run test:update-snapshots`) |
| 無交易日行為(不變) | NTD# | 只確認 selector 沒壞 |
| FAKE_FINMIND fixture | — | MTX / futures-institutional 新 fixture + MANIFEST 條目同 commit(manifest gate 測試會抓) |
| SC-1/2/3 純 parser 邏輯 | — | pytest 層即可;但 payload 欄位改名影響前端 → 屬 grey zone,預設需要 → 併入 O# / L# 驗 |

## Out of scope

- 即時 snapshot 疊層 / LLM 生成判讀 / equity・market mode 改動 / Max Pain・PCR・hit-rate 演算法本體 / GEX / IV skew / VIX(P2/P3 roadmap 留 spec §5)

## S/M/L 分流

**L**:跨前後端、預估 ≥ 15 檔(backend parser+service+route+tests、frontend 新元件 ×4 + 改 3 + hooks + e2e 三個 spec 檔)、含對外 API shape 變更(`window_activity_oi` 改名)。
→ Phase 1/2 各 max 3 輪 review。

## cycle-count

各 SC cycle-count: [see state.json]
