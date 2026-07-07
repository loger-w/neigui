# options-page-v2 — 判讀翻譯層 Design Spec (v1)

> Brainstorm artifact | 2026-07-07 | 前置討論:本 session(受眾/使用時刻/幅度三問已定案)

## 0. 背景與目標

**Why**:使用者回饋「一般人根本不知道 Max Pain / OI 牆 / 未平倉 PCR / 三大法人 OI 怎麼看」,NET 四格圖表同樣無法判讀。現況診斷:資料與計算底子好(hit rate 用 T-1、walk-forward 分位、permutation p-value,均無 look-ahead),**缺的是把統計事實翻成可行動判讀的「翻譯層」**;另 OI 牆計算有三個真問題(見 §4)。

**受眾定調**:知道 call/put 但不會判讀的初階者 — 術語可保留,但每個指標配「這代表什麼」判讀句。

**使用時刻定調**:盤後複盤 + 隔天開盤前看一眼 — EOD 資料即足,本輪**不**接即時 snapshot。

**改造幅度定調**:重排資訊架構(非僅加 tooltip)。

**鐵則承襲(不變)**:
- design v4 §7 反身性對沖:**禁方向性文案**(做多/做空/賣選/滿倉),判讀句只描述位置與變化,不給操作建議。既有 `queryByText(/做多|做空|賣選|滿倉/)` 測試續留並擴至新元件。
- 台股配色:bull=紅 / bear=綠;Call Wall=壓力=bear、Put Wall=支撐=bull,data-testid + 正向 assertion 鎖住。
- hit rate 一律 T-1(CLAUDE.md §4)。
- 不刪任何既有統計 — 全數降級到「進階統計」收合層。

**UI 實作階段指示**(user 2026-07-07):呼叫 `frontend-design` + `bencium-controlled-ux-designer` skill 輔助視覺設計。

## 1. 新資訊架構(四層,由上而下)

```
1. 今日結論列   一句話,規則模板生成(非 LLM)
2. 區間地圖     主視覺:價格軸 + 現價 + 雙牆 + Max Pain + 每檔 OI 分布
                (與既有 Strike Ladder 合併,加 OI/成交量切換)
3. 籌碼溫度計列  四格「誰站哪邊」:外資選擇權 / 前十大交易人 /
                PCR 分位 / 散戶小台多空比(新)+ 外資期貨(新,併格或第五格)
4. 進階統計     預設收合:hit rate 表、PCR 次日報酬統計、Spearman、
                NET 四組對照表、日夜盤拆分 — 現四卡內容全數保留於此
```

### 1.1 今日結論列(ConclusionBar)

規則模板生成,素材全部來自既有 payload,句式固定:

- **位置句**:以 `[put_wall, call_wall]` 三等分判定 spot 落區 →「位於支撐 P 與壓力 C 之間偏上緣/中段/下緣」;`spot > call_wall` →「已越過壓力 C」;`spot < put_wall` →「已跌破支撐 P」;任一牆為 null →「上方/下方無明顯 OI 牆」。
- **Max Pain 句**:「Max Pain M 在現價上/下方 x.x%」(|x|<0.05% 顯示「與現價幾乎重合」)。
- 資料缺漏時該句省略,不硬湊。判讀句為**位置描述**,禁方向性詞(§0 鐵則)。

### 1.2 區間地圖(RangeMap;取代/合併 Strike Ladder)

- 橫向價格軸 SVG:每檔 OI 分布(call bear 色 / put bull 色,鏡像上下),疊 spot 垂線、Put Wall / Call Wall 標記、Max Pain ▼ 標記、動態牆(改語意後,§4.2)小標記。
- 「OI / 成交量」toggle:OI 為預設(牆的本質);成交量沿用既有 strike volume 資料 — 既有 `useOptionsStrikeVolume` 的 payload 已含兩者,無新 endpoint。
- 純渲染函式進 `lib/`(照 §3 慣例 pure SVG + colocated 單元測試),元件只掛 DOM;響應式沿用 `frontend-conventions`(實作前讀)。
- 既有 `OptionsStrikeLadder` 元件由 RangeMap 取代;`options-svg.tsx` 的 `StrikeLadder` renderer 改造為 RangeMap renderer 的基底(同檔演進,不另留舊版)。行為改動 🔴 與新功能 🟢 分開 commit。

### 1.3 籌碼溫度計列(ThermometerRow)

四格統一 shape:**方向色塊 + 主數字 + 一句判讀 + 20 日 sparkline**:

| 格 | 資料來源 | 主數字 | 判讀句模板 |
|---|---|---|---|
| 外資選擇權 | 既有 institutional payload `foreign.total_net` | 淨口數 | 「外資選擇權 delta 等效淨多/淨空 N 口,較昨日 增/減」 |
| 前十大交易人 | 既有 large traders `top10_all` | 淨口數 | 「前十大交易人淨多/淨空 N 口(20 日趨勢 ↑/↓)」 |
| PCR 分位 | 既有 pcr payload | PCR 值 + P 分位 | 「Put/Call 未平倉比 x.xx,歷史第 P 百分位,偏高/中性/偏低」 |
| 散戶小台多空比(新) | §5 新 endpoint | 多空比 % | 「小台散戶淨多/淨空,佔總未平倉 x%」 |

外資期貨淨未平倉(新)併入外資格做第二行對照(「期貨淨空 N 口」),不獨立成格 — 同一主體兩市場互相印證,放同格語意最強。

### 1.4 進階統計(AdvancedPanel)

- 預設收合;tab 層級用 `hidden` attribute(CLAUDE.md §3)。
- 內容 = 現四卡全部統計:Max Pain hit rate 表、OI 牆 hit rate、PCR 次日報酬統計表(均值/標差/正報酬率/N)、Spearman r/p、NET 四組(前5/前10 × 特定法人/全交易人)對照表 + 「特定法人 vs 全交易人」固定說明文字、三大法人日夜盤拆分、data_quality_warnings。
- 「賣方總賠付 / 履約價數 / call-only / put-only」等診斷資訊移到此層或 tooltip,首屏不出現。

## 2. NET 四格收斂

- 首屏只留「前十大交易人」一格(溫度計列),含 20 日 sparkline + 判讀句。
- 其餘三組進進階區對照表(當日 net + 20 日變化),附說明:「特定法人=前 N 大中的法人機構;全交易人=含自然人大戶」。
- `parse_oi_large_traders` 的 delta 等效合成規則不變;UI 補單位「口」與正負語意說明。

## 3. 各卡改文案(保留但降級的部分)

- Max Pain 主數字旁加「距現價 ±x.x%」。
- 每個術語(Max Pain / OI 牆 / PCR / delta 等效淨部位)配 info tooltip 一段白話解釋(繁中,≤2 句)。
- 錯誤/載入/無交易日行為不變。

## 4. 計算修正(backend,行為改動 🔴)

### 4.1 靜態牆限價外側

`_pick_static_wall` 增加 spot 側別過濾:Call Wall 候選 = `strike ≥ spot`、Put Wall 候選 = `strike ≤ spot`;該側無 OI>0 履約價 → 回 `None`(UI 顯示「—」+ warning `static_wall_no_otm_candidate`)。tie-break 仍 closest-to-spot。**band_width_pct 因此恆 ≥ 0**。

Hit rate(`parse_oi_walls_hit_rate`)同步套側別限制,side 判定用 **T-1 close** 作 spot(`closes_by_date` 已有管線;缺 close 的樣本剔除並計入 warning,不回退 anchor=0)。此修正會改變歷史 hit rate 數值 — 屬預期(修語意 bug)。

### 4.2 動態牆改語意:淨增倉

`Σ|ΔOI|`(活動量,建倉平倉混計)改為 **window 首尾淨增倉** `net_increase(K) = oi_end(K) − oi_start(K)`,每側取最大**正值**;全部 ≤ 0 → `None` + warning `dynamic_wall_no_net_increase`。UI 標籤「5 日增倉最多」。payload 欄位 `window_activity_oi` 更名 `window_net_increase_oi`(跨檔契約,前後端同步改)。`partial_window` 語意不變。

### 4.3 Max Pain payload 不動

演算法正確,僅前端呈現調整(§3)。`_CACHE_VERSION_OPTIONS_CHIP` 因 4.1/4.2 bump +1。

## 5. 新資料(FinMind Sponsor,EOD)

| 優先 | 指標 | Dataset | 計算 |
|---|---|---|---|
| P1 | 散戶小台多空比 | `TaiwanFuturesDaily`(MTX 總 OI)+ `TaiwanFuturesInstitutionalInvestors`(MTX 法人) | 散戶多單 = 總OI − 法人多方;散戶空單 = 總OI − 法人空方;多空比 = (散戶多 − 散戶空) / 總OI |
| P1 | 外資台指期淨未平倉 | `TaiwanFuturesInstitutionalInvestors`(TX) | 外資 long OI − short OI |

- 新 endpoint:`GET /api/options/retail_mtx`、`GET /api/options/foreign_futures`(query:`date`、`refresh`;shape 沿用既有契約:`detail.error` / `no_trading_day` / `as_of_date` / `data_quality_warnings`)。
- 接入慣例照 `finmind-conventions`(實作前必讀):TokenBucket、atomic cache、`_run_once` dedup、配額評估(兩個 dataset 均為 range query,單日 2 calls 級,配額影響微小)。
- **實作前先跑 SC-0 probe** 驗兩個 dataset 的 MTX/TX 欄位名(法人名稱、long/short 欄位),不憑記憶假設 schema。

**Roadmap(本輪不動工)**:P2 台指 VIX(TAIFEX OpenAPI);P3 GEX / IV skew(design v4 既定 MVP2)。

## 6. Out of scope

- 即時 snapshot 疊層(使用時刻定調盤後)。
- LLM 生成判讀(規則模板即可,可測試、無幻覺)。
- 既有 equity / market mode 任何改動。
- Max Pain / PCR / hit rate 演算法本體。

## 7. Testing 概要

- **Backend**:4.1/4.2 修正走 TDD(紅先行);既有 walls 測試中「該變」的 assertion 事前標記。新 parser(retail_mtx / foreign_futures)pure function + fixtures(probe 產出)。
- **Frontend**:ConclusionBar 模板句 pure function 單測(各落區/null 分支);RangeMap pure SVG renderer 單測;溫度計格 component 測試;**禁方向性文案 assertion 擴至 ConclusionBar + ThermometerRow**。
- **E2E**:歸屬判斷在 /feat Phase 0 讀 `e2e-conventions` 判準表定案(頁面結構大改,預期 O# spec 需動)。
- **真實環境**:DevTools MCP 截圖驗證(`docs/specs/<slug>/screenshots/`)。

## 8. 風險

- **R1**:4.1 修正後歷史 hit rate 數值會變 — 屬修 bug,changelog 註明。
- **R2**:MTX 法人 dataset 欄位名未驗證 — SC-0 probe 先行(§5)。
- **R3**:結論列模板句在極端行情(雙牆同側、牆缺失)要有 fallback 句 — §1.1 已列,測試覆蓋。
- **R4**:頁面結構大改動到既有 e2e selector — /feat TDD 階段同步改 spec。

## 9. 版本

MINOR bump(使用者可感的 UX 大改 + 新指標),entry 文字實作時照 `changelog-conventions`。
