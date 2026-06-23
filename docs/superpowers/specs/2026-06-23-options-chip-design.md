# 台指選擇權籌碼功能設計規格

> 日期: 2026-06-23 · 狀態: 草案 (待 user review)

---

## 1. 目標

在現有「個股籌碼」App 之外,新增一個**台指選擇權 TXO 籌碼**檢視模式,讓使用者一眼同時看到:

1. **大戶部位** — 前 5 / 前 10 大特定法人 + 全交易人的多空未沖銷 OI(當日快照 + 20 天淨額趨勢)
2. **熱門履約價** — 當日 Call / Put 各自成交量前 10 大履約價,含 OI 變化

兩個視圖併排同頁,設計意圖是讓「**大戶在做什麼**」與「**熱錢在炒哪個價位**」可以一眼對看。

### 1.1 功能列表

| # | 功能 | 影響範圍 |
|---|------|---------|
| O1 | App 最頂層加 mode switch〔個股 ⇄ 選擇權〕 | `App.tsx` + 新元件 `ModeSwitch` |
| O2 | 選擇權 page 容器(合約 dropdown + 日期 + Refresh) | 新元件 `OptionsPage` / `OptionsHeader` |
| O3 | 大戶 OI 視圖(4 組 bar + 20 天淨額趨勢線) | 新元件 + 新 endpoint + 新 hook |
| O4 | 熱門履約價視圖(Call / Put 並排,Vol + OI 變化) | 新元件 + 新 endpoint + 新 hook |

### 1.2 不在範圍內

- ❌ 個股選擇權、期貨大戶、Tick 大單
- ❌ 夜盤三大法人(後續需求再加)
- ❌ react-router / 新 charting library / 新色票
- ❌ 不動既有 equity 流程任何一行(`useChipData`、`routes/chip.py`、所有既有元件)
- ❌ 不把選擇權維度疊到既有 K 線 sub-chart

---

## 2. 後端設計

### 2.1 新增 endpoints

```
GET /api/options/oi_large_traders?contract={code}&date={YYYY-MM-DD}&days=20&refresh=false
GET /api/options/strike_volume?contract={code}&date={YYYY-MM-DD}&top_n=10&refresh=false
```

兩個 endpoint 都是 read-only,延用既有 chip routes 的錯誤對應(httpx → 502、ValueError → 400/503)。

#### oi_large_traders response

```json
{
  "contract": "TXO202607",
  "date": "2026-06-23",
  "fetched_at": "2026-06-23T14:30:00",
  "current": {
    "top5_prop":   { "long": 12500, "short": 8200,  "net": 4300 },
    "top10_prop":  { "long": 18000, "short": 11000, "net": 7000 },
    "top5_all":    { "long": 22000, "short": 17000, "net": 5000 },
    "top10_all":   { "long": 31000, "short": 24000, "net": 7000 }
  },
  "series": [
    { "date": "2026-06-04", "top10_all_net": 6800, "top10_prop_net": 5400 },
    ...20 個交易日
  ]
}
```

- `prop` = 特定法人;`all` = 全交易人(含特定法人)
- `series` 只回 top10 兩條淨額曲線(MVP 不過度;前 5 趨勢之後再加)
- 單位 = 口

#### strike_volume response

```json
{
  "contract": "TXO202607",
  "date": "2026-06-23",
  "fetched_at": "2026-06-23T14:30:00",
  "call": [
    { "strike": 22000, "volume": 18500, "oi": 35200, "oi_change": 2100 },
    ...top_n
  ],
  "put": [
    { "strike": 21500, "volume": 14200, "oi": 28100, "oi_change": 1800 },
    ...top_n
  ]
}
```

- `top_n` 預設 10,query 可調 1..20,超出回 400
- `oi_change` = 今日 OI − 前一個交易日 OI(該履約價);前一日無資料 → 0

### 2.2 FinMind dataset 對應

| Endpoint | FinMind dataset | 抓取窗口 | 過濾 / 聚合 |
|---|---|---|---|
| `oi_large_traders.current` + `.series` | `TaiwanOptionOpenInterestLargeTraders` | `start_date = date − 35 calendar days`, `end_date = date`;程式內取最後 1 筆為 current、最後 20 筆為 series | `option_id == 'TXO'` AND `contract_type == <contract.contract_type>`;每天的 (call, put) 兩 row 用 delta-equivalent 公式聚合(下方) |
| `strike_volume` | `TaiwanOptionDaily` | `start_date = date − 7 calendar days`, `end_date = date`;程式內取最後兩個交易日算 oi_change | `option_id == 'TXO'` AND `contract_date == <contract.contract_date>`;同 (date, strike, call_put) 在 `trading_session ∈ {position, after_market}` 兩 row,parser **加總**為當日全日量 |

選 35 cal days 是為了在連假後仍能涵蓋 20 個交易日;7 cal days 是因為只需要前一個交易日,留 buffer 應付連假。

#### Call / Put 聚合公式(delta-equivalent net OI)

FinMind `TaiwanOptionOpenInterestLargeTraders` 每天每個合約有 2 row(`put_call ∈ {call, put}`),每 row 含 buy/sell 各 4 個 OI 欄位(`top{5,10}_{trader, specific}`)。Parser 把 call/put 兩 row 聚合為「看多/看空」OI:

```
long  (看多 OI) = call.buy_top{N}_{cat} + put.sell_top{N}_{cat}
short (看空 OI) = call.sell_top{N}_{cat} + put.buy_top{N}_{cat}
net = long − short
```

物理意義:買 Call + 賣 Put 都是看多曝險;賣 Call + 買 Put 都是看空曝險。Net 直接代表「大戶淨多空方向」,是台股期權籌碼分析最常見的單一指標。

此聚合**保留** §2.1 response 的 4 組 × {long, short, net} shape 不變,**parser 內部**處理 call/put 兩 row。

### 2.3 合約代碼

`backend/services/finmind_options.py` 提供純函式:

```python
def list_active_contracts(today: date) -> list[Contract]: ...
# 回傳 7 個:
# - 週選 W1..W4(最近 4 個結算週三,排除月選結算週)
# - 月選 M0..M2(當月、次月、季月)
```

`Contract` = 字典/dataclass:
- `slot: str` — `W1..W4` / `M0..M2`
- `kind: "weekly" | "monthly"`
- `option_id: str` — 一律 `"TXO"`(spec §1.1 只做 TXO)
- `contract_date: str` — 給 `TaiwanOptionDaily` 用。月選 = `YYYYMM`(e.g. `202607`),週選 = `YYYYMMW{ordinal}`(e.g. `202607W2`)
- `contract_type: str` — 給 `TaiwanOptionOpenInterestLargeTraders` 用。月選 = `YYYYMM`(同 contract_date),週選 = **`"week"` 字面值**(FinMind 沒有 per-week 大戶 OI 粒度;近週週選整批 aggregate)
- `label: str` — UI 顯示用
- `settlement: str` — ISO date

**權衡:weekly 大戶 OI 為 aggregate**(FinMind 限制)。`list_active_contracts` 仍回傳 4 個 weekly slot(各有獨立 `contract_date` 供 strike_volume 用),但所有 weekly 共享 `contract_type='week'`。UI 在 weekly 被選時顯示 banner(§3.3)。

**忽略 F-suffix**:Phase 0 觀察到 `TaiwanOptionDaily` 有 `YYYYMMF{3,4,5}` 形式的 contract_date(疑似特殊週選 / 季月跨期合約)。本 spec 不處理,`list_active_contracts` 只產出 `^YYYYMM$` 月選 + `^YYYYMMW\d+$` 標準週選;F-suffix 合約若未來需要再加。

前端 `lib/options-contract.ts` 維持同樣邏輯,用 TypeScript 重寫。**兩邊靠 unit test 守住 parity**:同樣 input date,兩邊 output 必須完全一致(test fixture 共用 JSON)。

### 2.4 快取

- `chip_cache_dir() / "{contract}_{date}_oi_lt.json"`
- `chip_cache_dir() / "{contract}_{date}_strike_vol.json"`
- `_CACHE_VERSION_OPTIONS = 1`(獨立 const,**不**動既有 `_CACHE_VERSION = 3`)
- TTL 規則沿用 equity:`date == today` → 15 min stale → refetch;`date < today` → 永久有效
- `refresh=true` 強制 refetch + 覆寫

### 2.5 錯誤處理新增碼

| Error code | HTTP | 觸發 |
|---|---|---|
| `contract_required` | 400 | query 沒帶 contract |
| `invalid_contract` | 400 | contract 不在 `list_active_contracts` 內 |
| `top_n_out_of_range` | 400 | top_n < 1 或 > 20 |
| `no_trading_day` | 200(空 payload + flag)| FinMind 回空 list 且 date == today(假日 / 週末) |
| `finmind_error` | 502 | httpx HTTP/timeout/connect 異常 |
| `unexpected_error` | 502 | 其他 |

`no_trading_day` **不**走 HTTPException — 改回正常 200 帶 `{contract, date, no_trading_day: true}`,前端用灰 banner 顯示「[date] 無交易」(非錯誤紅)。

### 2.6 程式碼組織

```
backend/
  services/
    finmind.py                    ← 加 4 個 fetch 方法到 FinMindClient
                                    (fetch_oi_large_traders, _do_fetch_oi_large_traders,
                                     fetch_strike_volume, _do_fetch_strike_volume)
    finmind_options.py            ← 新檔 ~150 lines:
                                     - list_active_contracts() 純函式
                                     - parse_oi_large_traders() 純函式
                                     - parse_strike_volume() 純函式
                                     - 常數 _CACHE_VERSION_OPTIONS
  routes/
    options.py                    ← 新檔 ~80 lines,兩個 endpoint
  tests/
    test_finmind_options.py       ← 新檔
    test_options_routes.py        ← 新檔
```

`main.py` 加一行 `include_router(options_router)`。`FinMindClient` 不抽 base class、不拆模組 — 純粹**加方法**,維持既有 import path。

### 2.7 已知未驗證假設(實作 Phase 0 必須先驗證)

> **鐵則 A**:這三項 schema 對得起 spec 才繼續實作;對不上 → 修 spec 再實作。

1. **週選 / 月選 contract `data_id` 字面值**
   - FinMind dataset `TaiwanOptionOpenInterestLargeTraders` 的 contract 欄位是 `option_id` 還是 `contract_date`?月選通常 `TXO + YYYYMM`,週選代碼(`TX1`/`TX2`/`TX1W`/...)未知。
   - 驗證方式:`curl 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanOptionOpenInterestLargeTraders&start_date=2026-06-20&end_date=2026-06-23'`,看 row 結構。

2. **`TaiwanOptionOpenInterestLargeTraders` 確切欄位**
   - 預期 8 欄:`{top5,top10} × {prop,all} × {long,short}`,但 FinMind 命名可能是 `prop_buy/prop_sell` 或 `specific_buy_oi/specific_sell_oi` 之類。Parser 寫死前必須 curl 看回傳 sample。

3. **`TaiwanOptionDaily` 一日多 strike 的 response shape**
   - 預期一個 (contract, strike, call_put) 一筆。volume 欄位是 `volume` 還是 `Trading_Volume`?OI 是 `open_interest` 還是 `OI`?

驗證結果 + 實際 schema 寫進 implementation plan 的 Phase 0。

---

## 3. 前端設計

### 3.1 App.tsx 變動

**唯一在既有檔的改動**:`App.tsx` 加 mode state 與條件 render。

```ts
type Mode = "equity" | "options";

const [mode, setMode] = useState<Mode>(() =>
  (localStorage.getItem("mode") as Mode) || "equity"
);
useEffect(() => { localStorage.setItem("mode", mode); }, [mode]);
```

Header 最上方加 `<ModeSwitch value={mode} onChange={setMode} />`:

```tsx
<div className="h-full flex flex-col overflow-hidden">
  <ModeSwitch value={mode} onChange={setMode} />
  {mode === "equity" ? (
    <>...既有 header + tabs + content,完全不動...</>
  ) : (
    <OptionsPage />
  )}
</div>
```

`ModeSwitch` 只是兩個 button,視覺與既有 tab strip 同風格(`border-line` + `text-accent` active state),擺在 viewport 最上方一條(高度約 36px)。

### 3.2 新元件樹

```
OptionsPage
├─ OptionsHeader
│    ├─ ContractDropdown (週選 W1..W4 + 月選 M0..M2)
│    ├─ DateField (沿用既有元件)
│    └─ Refresh button (沿用既有樣式)
├─ OptionsLargeTradersPanel
│    ├─ <LargeTradersBars current={...} />     ← SVG,4 組 long/short bar
│    └─ <LargeTradersTrend series={...} />     ← SVG,20 天兩條淨額線
└─ OptionsStrikeVolumePanel
     └─ <StrikeVolumeTable call={...} put={...} />  ← Call/Put 並排表
```

垂直佈局:`OptionsHeader` shrink-0,下方一個 `grid grid-rows-2` 切兩半,每半各持一個 Panel。內部表格 / 圖表自己處理 overflow。

### 3.3 ContractDropdown

- Options 由 `lib/options-contract.ts` 算出,每次 mount 或日期跨日重算
- 預設選 W1(`list_active_contracts` 已排除已結算的合約,所以 W1 永遠 = 最近未結算的週選結算週三)
- localStorage 持久化「上次選的 contract kind」(weekly / monthly):重整後 kind 維持,具體哪一個 W1 / M0 由系統依當前日期重算
- 不持久具體的 contract code 本身(會在跨日 / 跨結算後失效)

#### 週選大戶 OI aggregate banner

當 `contract.kind === "weekly"` 時,在 `<OptionsLargeTradersPanel>` 標頭旁顯示資訊 banner:

> 📌 大戶 OI 為近週週選 aggregate(FinMind `contract_type='week'`),W1..W4 顯示同一份資料。熱門履約價依各週合約獨立。

樣式:`text-ink-dim text-xs px-3 py-1 bg-ink/[0.03] rounded`。不是錯誤、不是警告,純資訊。Monthly 選擇時 banner 隱藏。

### 3.4 兩個 hooks

```ts
useOptionsLargeTraders(contract: string, date: string)
  → { data, loading, error, refresh, noTradingDay }

useOptionsStrikeVolume(contract: string, date: string)
  → { data, loading, error, refresh, noTradingDay }
```

行為對齊既有 `useChipData`:
- contract / date 變動 → 自動重抓
- AbortController 防 race
- `refresh()` action 強制重抓(後端 `refresh=true`)
- `noTradingDay` = response payload 帶 flag 時為 true

### 3.5 LargeTradersBars 視覺

4 組 horizontal grouped bar,左右對稱(多倉左、空倉右,或同 baseline 雙色)。

```
                long           short
top5 特定法人   ▌▌▌▌▌▌▌▌▌▌▌▌  ▌▌▌▌▌▌▌▌
top10 特定法人  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ▌▌▌▌▌▌▌▌▌▌▌
top5 全交易人   ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌
top10 全交易人  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌
```

紅 = 多 / 綠 = 空(對齊既有股票漲跌色慣例)。右側標 net 數字。

### 3.6 LargeTradersTrend 視覺

20 天 line chart,X 軸日期,Y 軸 net 口數(正負皆可)。兩條線:
- `top10_prop_net` — 較粗,實線
- `top10_all_net` — 較細,虛線

當天那一點加 cursor mark(對齊既有 K 線 cursor pattern)。

### 3.7 StrikeVolumeTable 視覺

```
┌─────────── Call ────────────┬─────────── Put ────────────┐
│ Strike  Volume    OI ±      │ Strike  Volume    OI ±      │
├──────────────────────────────┼─────────────────────────────┤
│ 22000   18,500    +2,100 🔺 │ 21500   14,200    +1,800 🔺 │
│ 22100   12,100    +1,400 🔺 │ 21000    9,800    +  600 🔺 │
│ 21900    9,400    −  800 🔻 │ 21800    8,500    −1,200 🔻 │
│ ...                          │ ...                         │
└──────────────────────────────┴─────────────────────────────┘
```

OI 變化正 / 負分別用 accent(紅)/ 綠色標,絕對值在後。Strike 用大字級,Volume / OI 用次級字級。

### 3.8 視覺主題

延用 `chip-theme.ts` 的 token:
- `text-ink` / `text-ink-muted` / `text-ink-dim`
- `border-line` / `bg-accent` / `text-accent`
- 紅綠用既有 `chip-svg` 一致的色

不引入新色票、不動既有 Tailwind config。

### 3.9 載入 / 錯誤 / 空狀態

- Loading:沿用既有 spinner + shimmer bar pattern(`refresh-spinner` testid 風格)
- Error:沿用既有 banner(`text-accent bg-accent/[0.06] border-b border-line`)
- `noTradingDay`:灰 banner(`text-ink-dim bg-ink/[0.04]`),內容「[date] 無交易」

---

## 4. 測試策略

### 4.1 後端 unit / route tests

| # | 測試 | 紅 → 綠 範圍 |
|---|---|---|
| B1 | `test_list_active_contracts_includes_weekly_and_monthly` | 純函式 contract 推算 |
| B2 | `test_list_active_contracts_excludes_settled_week` | 已結算的 W1 不出現在 list |
| B3 | `test_parse_oi_large_traders_happy_path` | parser fixture → 8 欄 + net |
| B4 | `test_parse_oi_large_traders_empty_returns_zero` | 空 list 不爆,回 zero structure |
| B5 | `test_parse_strike_volume_oi_change_two_days` | 兩日 daily → 計算 oi_change |
| B6 | `test_parse_strike_volume_oi_change_first_day_zero` | 前一日無 row → oi_change = 0 |
| B7 | `test_oi_lt_endpoint_400_on_missing_contract` | route |
| B8 | `test_oi_lt_endpoint_400_on_invalid_contract` | route |
| B9 | `test_oi_lt_endpoint_happy_path_mocked_finmind` | route + mocked httpx |
| B10 | `test_oi_lt_endpoint_no_trading_day_today_holiday` | route 假日回 200 + flag |
| B11 | `test_strike_volume_endpoint_400_on_top_n_out_of_range` | route |
| B12 | `test_strike_volume_endpoint_happy_path_mocked_finmind` | route + mocked httpx |
| B13 | `test_oi_lt_cache_hit_skips_finmind` | cache hit 不打 FinMind |
| B14 | `test_oi_lt_cache_version_mismatch_refetches` | 改 version → 重抓 |

### 4.2 前端 unit tests

| # | 測試 | 範圍 |
|---|---|---|
| F1 | `ModeSwitch.test.tsx` — toggle 觸發 onChange + 視覺 active state | |
| F2 | `options-contract.test.ts` — 同 backend B1/B2 的 fixture JSON | parity |
| F3 | `useOptionsLargeTraders.test.ts` — 三狀態(loading/data/error) + abort | |
| F4 | `useOptionsStrikeVolume.test.ts` — 同上 | |
| F5 | `OptionsLargeTradersPanel.test.tsx` — fixture render,4 組 bar + 趨勢點 20 個 | |
| F6 | `OptionsStrikeVolumePanel.test.tsx` — fixture render,Call/Put 各 N 列、OI± 標色 | |
| F7 | `OptionsHeader.test.tsx` — contract dropdown 切換觸發 callback | |
| F8 | `App.test.tsx`(若有 / 否則新建) — mode switch 切換顯示 OptionsPage,localStorage 持久化 | |

### 4.3 自動化五步驟 + 真實環境驗證

- `npx tsc -b`(frontend) → 0 errors
- `npx vitest run`(frontend) → 全綠
- `python -m pytest -v`(backend) → 全綠
- `ruff check .` && `ruff check --fix .`(backend) → 0 issues
- `npm run build`(frontend) → 成功

DevTools MCP 真實環境 happy path + edge cases:
1. Mode 切到「選擇權」→ OptionsPage 出現,header dropdown 預設選 W1
2. Contract 切到月選 M0 → 兩 panel 同步重抓
3. 日期切到上一交易日 → 兩 panel 同步重抓,趨勢線最後一點對齊新日期
4. 日期切到週六 → 灰 banner「無交易」,panel 內顯示空
5. Refresh button → 兩 panel 同時轉圈
6. Mode 切回「個股」→ 既有畫面 100% 不變,既有功能正常
7. F5 重整 → mode 維持上次選擇(localStorage)
8. Console 0 errors / 0 red warnings

截圖存證放 `docs/superpowers/specs/2026-06-23-options-chip-verification/`。

---

## 5. Phasing

| Phase | 範圍 | commit |
|---|---|---|
| P0 | curl FinMind 三個 dataset,確認 schema,**若與 spec 不符 → 停下來修 spec** | (no commit;直接修 spec) |
| P1 | Mode switch + OptionsPage 骨架 + 大戶 OI 後端 + 大戶 OI 前端 | 1 commit `feat(options): mode switch + large traders OI` |
| P2 | 熱門履約價後端 + 熱門履約價前端 | 1 commit `feat(options): top strike volume panel` |
| P3 | 真實環境驗證 + 截圖 | 1 commit `chore: add DevTools MCP screenshots for options page` |

P1 + P2 在同一個 branch 連著做;P0 是 implementation plan 的 sanity check,不獨立 commit。

---

## 6. 風險與緩解

| 風險 | 緩解 |
|---|---|
| FinMind options dataset schema 與假設不符 | Phase 0 先驗證;不對就修 spec 再實作 |
| 週選代碼 / 結算日推算規則錯 | parity test(前後端用同 fixture JSON);先用週三定位,假日修正放下次 |
| FinMind 速率限制(預設 5 req/s)在 contract 切換頻繁時打到 | 沿用既有 TokenBucket(`services/rate_limiter.py`),不調 |
| `TaiwanOptionDaily` 一次回傳超大(整個合約所有 strike × 多日) | top_n filter 在後端做,response 只回前 N;cache 保存完整 parsed 結果 |
| 既有 equity flow 因 mode switch 退化 | 既有檔零改動(除 `App.tsx` 加 mode 條件 render);全套既有測試保持 100% 綠 |

---

## 7. 未列入此 spec、之後再議

- 夜盤三大法人(`TaiwanOptionInstitutionalInvestorsAfterHours`)
- Tick 大單(`TaiwanOptionTick`)
- 個股選擇權、期貨大戶
- 與 K 線連動 / 熱門履約價點選 → 跳到該 strike 詳情
- PCR、Max Pain 等衍生指標
- 假日表(目前以週三為結算定位,實際週三休假等首次踩到再加)

---

## Phase 0 Schema Validation Result — 2026-06-23

於 2026-06-23 以 Sponsor tier 對 FinMind API 進行 schema probe,涵蓋 `TaiwanOptionOpenInterestLargeTraders`(window 2026-06-15..2026-06-22)與 `TaiwanOptionDaily`(window 2026-05-15..2026-06-22,因 2026-06-19..06-22 為空)兩個 dataset,驗證 spec §2.7 的三項未驗證假設。

### TaiwanOptionOpenInterestLargeTraders

- **實際 row shape**:**一 row 包含全部 8 個 OI 數值欄位**(buy/sell × top5/top10 × trader/specific),即每一 row 同時帶長空雙邊。row 的 unique key = (date, option_id, contract_type, put_call)。spec 假設的「8 欄寬表 shape」與實際相符,**不需要重寫 parser**。

- **欄位對應(parser 名 → FinMind 實際欄位)**:
  - `date` → `date`
  - `contract_date` → `contract_type`(注意:此 dataset 沒有 `contract_date` 欄位,maturity 編碼於 `contract_type`)
  - `top5_prop_long_oi` → `buy_top5_specific_open_interest`
  - `top5_prop_short_oi` → `sell_top5_specific_open_interest`
  - `top10_prop_long_oi` → `buy_top10_specific_open_interest`
  - `top10_prop_short_oi` → `sell_top10_specific_open_interest`
  - `top5_all_long_oi` → `buy_top5_trader_open_interest`
  - `top5_all_short_oi` → `sell_top5_trader_open_interest`
  - `top10_all_long_oi` → `buy_top10_trader_open_interest`
  - `top10_all_short_oi` → `sell_top10_trader_open_interest`

- **distinct contract identifier 觀察**:
  - `contract_type` 取值 `{'week', 'all', '<YYYYMM>'}`,在 probe window 內僅見 `['202606', 'all', 'week']`(window 內只有 2026-06-15 一個交易日)。
  - `option_id` 為 2 字元短碼(`CA`..`OA` 共 30 個)+ 指數選擇權 3 字元(`TXO`/`TEO`/`TFO`/`TGO`)。
  - `name` 為中文標的名稱(臺指/電子/金融/台積電/鴻海/聯發科…39 個 distinct names),與 `option_id` 1:1 對應。
  - `put_call` 欄位拼法為 `put_call`(注意:此 dataset 與 TaiwanOptionDaily 的 `call_put` 拼法相反)。

### TaiwanOptionDaily

- **欄位對應(parser 名 → FinMind 實際欄位)**:
  - `date` → `date`
  - `data_id` → `option_id`(parser 必須改名)
  - `contract_date` → `contract_date`
  - `strike_price` → `strike_price`(float 非 int)
  - `call_put` → `call_put`
  - `volume` → `volume`
  - `open_interest` → `open_interest`

- **distinct `option_id` literals 觀察(40 個,probe field cap 30 + 補列 10 個)**:`TXO`, `TEO`, `TFO`, `TGO`, `CAO`, `CBO`, `CCO`, `CDA`, `CDO`, `CEO`, `CFO`, `CGO`, `CHO`, `CKO`, `CMO`, `CNO`, `CSO`, `CZO`, `DFO`, `DGO`, `DHO`, `DJO`, `DKO`, `DQO`, `DSO`, `DVO`, `DXO`, `GIO`, `GXO`, `HCO`, `HSO`, `IJO`, `IRO`, `NYO`, `OAO`, `OBO`, `OJO`, `OKO`, `OOO`, `OZO`。

- **Call/put 判別值 pair**:小寫 `'call'` / `'put'`(非 C/P,非大寫)。

- **`open_interest` 存在性**:**100% 行皆有 `open_interest` 欄位**(0 / 11,897 missing),parser 可信賴此欄位永遠存在,雖然 illiquid OTM 履約價多為 0。

### Spec deltas needed

- TaiwanOptionDaily: contract identifier field is `option_id` (NOT `data_id`). Parser must rename input accessor from data_id → option_id. The TXO index option uses option_id='TXO' (3 chars), while stock/ETF options use 3-char codes ending in 'O' (e.g. CAO, TEO) — there is NO consistent suffix rule.
- TaiwanOptionDaily: hidden `trading_session` dimension with values {'position','after_market'}. Same (date, option_id, contract_date, strike_price, call_put) appears TWICE — once per session. Parser MUST group by trading_session or pick one session explicitly, otherwise volume/OI double-counts. Spec did not mention this; Task 3 parser needs a session filter (recommend default = 'position' for regular-session OI, or sum both for total daily turnover).
- TaiwanOptionDaily: contract_date encodes weekly-vs-monthly in the SUFFIX, not in option_id. Pure YYYYMM (e.g. 202606) = monthly; YYYYMMW{N} = weekly; YYYYMMF{N} = front-week / specific expiry week. Parser must regex-parse the suffix to filter monthly-only contracts as the spec assumed.
- TaiwanOptionDaily: high/low fields are named `max`/`min`, NOT `high`/`low` (FinMind quirk). Not currently required by Task 3 parser but flagged for any future OHLC extension.
- TaiwanOptionDaily: strike_price is FLOAT (e.g. 35000.0, 60.0), not int. Parser should coerce or accept float; semantically it IS the strike (not last trade price — last trade is `close`). Confirmed.
- TaiwanOptionDaily: 2026-06-19..06-22 returned empty (likely market-closed or data-not-yet-available); widening to 2026-05-15..06-22 returned 11,897 rows. Parser must handle empty result and back-fill to the most recent available trading day.
- TaiwanOptionOpenInterestLargeTraders SHAPE: ONE row per (date, option_id, contract_type, put_call) carrying ALL 8 numeric OI columns (buy/sell × top5/top10 × trader/specific). This MATCHES the Task 2 parser's first assumed shape — NO rewrite needed for row-vs-category shape. However, each row carries BOTH long (buy_*) AND short (sell_*) numbers — there is no separate long-row/short-row split.
- TaiwanOptionOpenInterestLargeTraders: contract identifier is COMPOSITE — `option_id` (e.g. TXO) AND human-readable `name` (e.g. 臺指). Parser should filter on option_id='TXO' for TAIEX weekly/monthly index options. The `name` field is informational.
- TaiwanOptionOpenInterestLargeTraders: NO `contract_date` field exists. Maturity is encoded in `contract_type` with 3 values: 'week' (週選), 'all' (該標的全部到期月合計), or '<YYYYMM>' (specific month, e.g. '202606'). Parser must map contract_date → contract_type and interpret these 3 enum values, NOT a YYYYMM date string. Spec assumption of YYYYMM-style contract_date is INCORRECT for this dataset.
- TaiwanOptionOpenInterestLargeTraders: terminology mismatch. FinMind uses `trader` (前N大交易人 = all-traders, i.e. retail+prop+legal) and `specific` (前N大特定法人 = prop/legal-entity subset). Mapping in oi_lt_field_map: top5/10_all_* → *_trader_*; top5/10_prop_* → *_specific_*. This is the OPPOSITE of intuitive reading where 'all' might mean 'specific' — verify Task 2 parser uses the same convention.
- TaiwanOptionOpenInterestLargeTraders: each numeric field has a paired `*_per` percentage field (% of market_open_interest). Parser can ignore _per columns or use them for sanity checks. market_open_interest is the per-row denominator.
- Both datasets: distinct_data_ids in probe response actually holds `option_id` values for both datasets — the FinMind API does not expose a separate `data_id` field on either dataset. Parser-level alias `data_id` → `option_id` is needed.
- **(新增 by 對抗驗證)** 跨資料集 `option_id` 格式不一致:TaiwanOptionDaily 用 3 字元含 'O' 後綴(`CAO`, `CBO`...,加上指數 `TXO`/`TEO`/`TFO`/`TGO`),TaiwanOptionOpenInterestLargeTraders 用 2 字元短碼(`CA`, `CB`...,加上指數 `TXO`/`TEO`/`TFO`/`TGO`)。stock/ETF 代碼在兩 dataset 不可直接 join,需建立 `CA ↔ CAO` 正規化映射表;指數選擇權代碼則一致。
- **(新增 by 對抗驗證)** `put_call` vs `call_put` 欄位拼法不一致:TaiwanOptionDaily 用 `call_put`;TaiwanOptionOpenInterestLargeTraders 用 `put_call`。共用 parser 必須分別處理,不可假設同名。
- **(新增 by 對抗驗證)** `oi_lt_field_map` 需補上 `put_call` 與 `option_id` 兩個欄位映射(用於 filter TXO + 拆 call/put leg);`option_daily_field_map` 需補上 `trading_session` 為一級欄位以強制 parser 套用 session filter(預設 `'position'`)。
- **(新增 by 對抗驗證)** `market_open_interest` 在大多數 stock-option row 為 0(probe sample 30 個 option_id 中 29 個全零),任何用此值作分母的計算(如重算 `_per`)必須先 guard 除零。其為 per-(date, option_id, contract_type, put_call) leg 的 OI denominator,**非市場總 OI**,不可跨 leg 加總視為總額。
- **(新增 by 對抗驗證)** `contract_type='all'` 的 row 在 probe sample 為全零;parser 不應預設 `all` row 一定有實值,使用前需逐 row 檢查 `market_open_interest > 0`。
- **(新增 by 對抗驗證)** `data_id_literals` 清單(40 個 3 字元代碼)僅適用於 TaiwanOptionDaily;TaiwanOptionOpenInterestLargeTraders 使用獨立的 2 字元代碼集(`CA`..`OA` + `TXO`/`TEO`/`TFO`/`TGO`)。Parser 端應維護兩份 literal 白名單,白名單以外的代碼建議報錯而非 silent drop。
- **(新增 by 對抗驗證)** `contract_type` enum 觀察值僅 `{'week', 'all', '202606'}`(probe 僅一個交易日);結算日附近或月份切換可能擴張為 `{'week', 'all', '<near_YYYYMM>', '<far_YYYYMM>'}`,parser 應採白名單策略,遇到未知值報錯。
- **(新增 by 對抗驗證)** F-suffix(`YYYYMMF{3,4,5}`)語意未確認:probe 推論為「週選編號 / 特定到期週」,實作前應對照 TAIFEX 商品規格書確認 F-series 確切意義,而非僅憑 W/F 字面區分 weekly。
- **(新增 by 對抗驗證)** TaiwanOptionDaily 額外有 `settlement_price` 欄位(獨立於 `close`),為當日結算價,未來若需做保證金 / Greeks 衍生計算需採此欄位而非 `close`。
- **(新增 by 對抗驗證)** TaiwanOptionDaily 中 5,638 個 TXO row 僅 1,697 個 `volume > 0`;parser 在做履約價排行時應先過濾 0 量 row,避免大量 ties 與虛假信號。

### Adversarial verification

- **Lens 1 (mapping correctness):** confirms_mapping=true,recommended_action=`modify_spec`。rationale:逐欄核對 oi_lt_field_map / option_daily_field_map 所有 mapped field name 都在 probe 的 field_names 中出現,long/short × top5/10 × trader(=all)/specific(=prop) 8 欄組合與 sample rows 一致,沒有幻覺欄位。唯需補 (1) 跨資料集 option_id 格式不對齊、(2) data_id_literals 只對 Daily 有效兩條 delta。
- **Lens 2 (completeness):** confirms_mapping=false,recommended_action=`modify_spec`。rationale:spec_deltas 捕捉到大型 schema 變動(contract_type 改名、trading_session 雙重維度、trader vs specific 術語、data_id→option_id 改名),但漏掉 (a) `data_id_literals` 缺 TXO/TEO/TFO/TGO 等指數代碼、(b) 兩 dataset option_id 格式不同 silent join 失敗、(c) `settlement_price`、market_open_interest 範圍、零量 row 處理。皆為完整性 gap,不影響核心假設。
- **Lens 3 (parser pitfalls):** confirms_mapping=false,recommended_action=`modify_spec`。rationale:最高風險為 (1) `call_put` vs `put_call` 欄位名 flip,共用 parser 會 KeyError 或 silent 合併 call/put;(2) `oi_lt_field_map` 漏 put_call 與 option_id 欄位、`option_daily_field_map` 漏 trading_session 一級欄位,parser 嚴格依 field_map 實作會繼承 2x 重複計算 bug。其餘 (3) data_id_literals 兩 dataset 共用會 reject LargeTraders 全部 stock-option row、(4) market_open_interest 除零 guard。皆機械式可修,不需人工判斷。
