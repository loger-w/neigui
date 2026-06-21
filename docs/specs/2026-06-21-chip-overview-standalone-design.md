# 籌碼總攬獨立專案設計規格

> 從 trading-king 抽取籌碼分析功能為獨立專案 `trash-cmoney`

---

## 1. 專案目標

將 trading-king 的「籌碼分析」頁面（含籌碼總覽 + 泡泡圖兩個 Tab）抽取為完全獨立的專案，統一使用 FinMind API 作為資料源，移除所有非籌碼相關的依賴。

### 成功標準

- 功能與原專案的籌碼分析頁面完全一致（含互動行為）
- UI/UX 行為與原專案一致（含 hover 同步、bubble 互動、日期自動調整等）
- 僅需設定 `FINMIND_TOKEN` 即可運行（`FINMIND_RATE_LIMIT_PER_SEC` 為可選）
- 後端/前端測試全部通過
- TypeScript strict mode 無錯誤

### 與原專案的刻意差異

- **股票搜尋**：原專案依賴 Fubon bootstrap 的股票列表。獨立專案改用 FinMind `TaiwanStockInfo` 作為搜尋來源，行為一致（輸入代號/名稱 → 下拉選單），但資料源不同。
- **日期選擇器**：原專案使用原生 `<input type="date">`，獨立專案沿用相同做法（不改用 Shadcn Calendar）以保持行為一致。
- **Hooks `active` 參數**：原專案因多頁面需要 `active` 控制 fetch 時機。獨立專案為單頁面，移除此參數（永遠 active）。Hook 簽名從 `(symbol, date, active)` 改為 `(symbol, date)`，內部 `if (!symbol || !active)` 簡化為 `if (!symbol)`。

---

## 2. 技術棧

### 後端

| 項目 | 版本 |
|------|------|
| Python | >=3.12 |
| FastAPI | >=0.115 |
| Uvicorn | >=0.30 (standard) |
| httpx | >=0.27 |
| Pydantic | >=2.6 |
| python-dotenv | >=1.0 |
| pytest | >=8 (dev) |
| pytest-asyncio | >=0.23 (dev) |

### 前端

| 項目 | 版本 |
|------|------|
| React | ^19.0 |
| React DOM | ^19.0 |
| TypeScript | ^5.7 |
| Vite | ^6.0 |
| Tailwind CSS | ^4.0 |
| Shadcn/ui | latest (New York style) |
| Vitest | ^4.0 (dev) |

---

## 3. 環境變數

`.env` 檔案僅包含：

```env
FINMIND_TOKEN=your_finmind_sponsor_token
FINMIND_RATE_LIMIT_PER_SEC=5
```

- `FINMIND_TOKEN`：必填，FinMind Sponsor tier token
- `FINMIND_RATE_LIMIT_PER_SEC`：選填，預設 5，每秒最大 API 請求數

**不包含任何其他設定**（無 Fubon、無群益、無 BFF Key、無 Discord、無 Supabase）。

---

## 4. 專案結構

```
C:\side-project\trash-cmoney\
├── backend/
│   ├── main.py                    # FastAPI app entry (CORS + lifespan + routes)
│   ├── services/
│   │   ├── finmind.py             # FinMind API client (cache + rate limit + dedup)
│   │   └── rate_limiter.py        # Token bucket rate limiter
│   ├── routes/
│   │   ├── chip.py                # 3 GET chip endpoints
│   │   └── symbols.py             # Symbol search endpoint
│   ├── utils/
│   │   └── cache.py               # atomic_write_json / read_json helpers
│   ├── tests/
│   │   ├── test_finmind.py        # Service unit tests
│   │   └── test_chip_routes.py    # Route integration tests
│   ├── data/
│   │   └── cache/
│   │       └── chip/              # JSON cache (gitignored)
│   ├── pyproject.toml
│   ├── .env.example
│   └── .env                       # gitignored
├── frontend/
│   ├── src/
│   │   ├── main.tsx               # React entry
│   │   ├── App.tsx                # Single-page layout
│   │   ├── components/
│   │   │   ├── ui/                # Shadcn/ui components
│   │   │   ├── SymbolSearch.tsx   # 股票搜尋（debounce + 下拉）
│   │   │   ├── ChipBrokersPanel.tsx
│   │   │   ├── ChipBubbleView.tsx
│   │   │   └── ChipKlineChart.tsx
│   │   ├── hooks/
│   │   │   ├── useChipData.ts
│   │   │   ├── useChipBubble.ts
│   │   │   └── useContainerSize.ts
│   │   └── lib/
│   │       ├── api.ts             # fetch wrapper
│   │       ├── chip-data.ts       # types + helpers
│   │       ├── chip-theme.ts      # color palette
│   │       ├── chip-kline-svg.tsx
│   │       ├── chip-inst-bar-svg.tsx
│   │       ├── chip-bubble-svg.tsx
│   │       └── chip-price-bar-svg.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   └── components.json            # Shadcn/ui config
├── .gitignore
└── README.md
```

**注意：** Tailwind CSS 4 使用 CSS-first 配置（`@theme` 指令在 CSS 中），不需要 `tailwind.config.ts`。

---

## 5. 後端 API 規格

### 5.1 GET `/api/chip/{symbol}`

籌碼總覽：三大法人 + 融資融券 + 分點前 15 大。

**Path Params:**
- `symbol`: 股票代號（4-6 碼，如 `2330`, `00878`）

**Query Params:**
- `date`: `YYYY-MM-DD`，預設今天
- `refresh`: `bool`，預設 false，true 時跳過 cache

**Response:**
```json
{
  "symbol": "2330",
  "date": "2026-06-20",
  "fetched_at": "2026-06-20T14:30:00+08:00",
  "institutional": {
    "foreign": { "buy": 12000, "sell": 8000, "net": 4000 },
    "trust": { "buy": 500, "sell": 300, "net": 200 },
    "dealer": { "buy": 100, "sell": 150, "net": -50 }
  },
  "margin": {
    "margin_purchase": { "balance": 50000, "change": 200, "limit": 100000 },
    "short_sale": { "balance": 3000, "change": -50, "limit": 100000 },
    "short_balance_ratio": 6.0
  },
  "top_brokers": [
    {
      "name": "美林",
      "broker_id": "8440",
      "buy": 500,
      "sell": 100,
      "net": 400,
      "avg_buy_price": 850.5,
      "avg_sell_price": 848.0
    }
  ]
}
```

### 5.2 GET `/api/chip/{symbol}/bubble`

泡泡圖：per-broker per-price 交易明細。

**Query Params:** 同 5.1

**Response:**
```json
{
  "symbol": "2330",
  "date": "2026-06-20",
  "fetched_at": "2026-06-20T14:30:00+08:00",
  "trades": [
    {
      "broker": "美林",
      "broker_id": "8440",
      "price": 850.0,
      "buy": 50,
      "sell": 0
    }
  ]
}
```

### 5.3 GET `/api/chip/{symbol}/history`

歷史資料：查詢過去 90 個日曆天的範圍，回傳筆數為該範圍內的實際交易日（通常 60-65 筆）。

**Query Params:**
- `refresh`: `bool`，預設 false

**Cache 策略：** 比較 `last_date` 與今天的日期。若 `last_date` < today 且今天是交易日（或已過收盤時間），則視為 stale 重新 fetch。

**Response:**
```json
{
  "symbol": "2330",
  "fetched_at": "2026-06-20T14:30:00+08:00",
  "last_date": "2026-06-20",
  "candles": [
    { "date": "2026-03-22", "open": 800, "high": 810, "low": 795, "close": 805, "volume": 25000 }
  ],
  "institutional": [
    { "date": "2026-03-22", "foreign_net": 1000, "trust_net": 200, "dealer_net": -50, "major_net": 1150 }
  ],
  "margin": [
    { "date": "2026-03-22", "margin_balance": 48000, "short_balance": 3200, "margin_change": 100, "short_change": -20 }
  ],
  "major": [
    { "date": "2026-03-22", "major_net": 1500 }
  ]
}
```

### 5.4 GET `/api/symbols`

股票搜尋：從 FinMind `TaiwanStockInfo` 取得股票列表並支援搜尋。

**Query Params:**
- `search`: 搜尋關鍵字（代號或名稱），最短 1 字元

**Response:**
```json
[
  { "symbol": "2330", "name": "台積電" },
  { "symbol": "2317", "name": "鴻海" }
]
```

**實作細節：**
- 啟動時從 FinMind 拉取完整股票列表（`TaiwanStockInfo` dataset）
- 快取在記憶體中（每日只需更新一次）
- 搜尋邏輯：prefix match on symbol OR contains match on name
- 回傳最多 20 筆

### 5.5 FinMind API 呼叫

| FinMind Dataset | 用途 | 端點路徑 |
|---|---|---|
| `TaiwanStockInfo` | 股票列表 | `GET /api/v4/data` |
| `TaiwanStockInstitutionalInvestorsBuySellWide` | 三大法人 | `GET /api/v4/data` |
| `TaiwanStockMarginPurchaseShortSale` | 融資融券 | `GET /api/v4/data` |
| `TaiwanStockPrice` | K 線 | `GET /api/v4/data` |
| `TaiwanStockTradingDailyReport` | 泡泡圖（單日）| `GET /api/v4/taiwan_stock_trading_daily_report` |
| `TaiwanStockTradingDailyReportSecIdAgg` | 主力（區間）| `GET /api/v4/taiwan_stock_trading_daily_report_secid_agg` |

**注意事項（從原專案繼承）：**
- `TradingDailyReport` 只接受 `date` 參數（單日），不接受 `start_date/end_date`
- `SecIdAgg` 使用非標準端點路徑（非 `/api/v4/data`）
- 分點資料盤後 21:00 更新，盤中查詢可能為空

### 5.6 後端核心邏輯（從原專案搬移）

以下函式直接搬移，不重寫：

**資料轉換：**
- `_to_lots(shares)` — 股 → 張，truncate toward zero，維持正負號
- `_parse_institutional(rows)` — 解析三大法人 raw data（single day）
- `_parse_margin(rows)` — 解析融資融券，券資比 = `short_sale_balance / margin_purchase_balance * 100`（%），zero-division 回傳 0
- `_parse_top_brokers(rows)` — 聚合 broker，加權平均價，按 |net| 排序。核心語意：net = _to_lots(buy_shares) - _to_lots(sell_shares)（先各自截斷再相減）
- `_parse_institutional_series(rows)` — 解析多日法人序列（history 用）
- `_parse_margin_series(rows)` — 解析多日融資融券序列（history 用）
- `_compute_major_net(rows)` — 從原始 per-trade rows 計算 Top-15 主力淨買超
- `_compute_major_net_agg(rows)` — 從預聚合 SecIdAgg rows 計算 Top-15 主力淨買超

**基礎設施：**
- `TokenBucket` — Token bucket rate limiter（獨立檔案 `rate_limiter.py`）
- `_run_once(inflight_key, coro_fn)` — Inflight dedup，防止同一 request 重複打 API
- `atomic_write_json(path, data)` — 寫入 `.tmp` 再 `os.replace`（獨立檔案 `utils/cache.py`）
- `read_json(path)` — 讀取 JSON cache（獨立檔案 `utils/cache.py`）
- Cache versioning：`_CACHE_VERSION = 1`（全新專案從 1 開始）
- Cache staleness：今日資料 30 分鐘過期；歷史日永久快取

### 5.7 錯誤處理

| 狀態碼 | 情境 |
|--------|------|
| 200 | 正常回傳 |
| 502 | FinMind API 連線/逾時/HTTP 錯誤 |
| 503 | FINMIND_TOKEN 未設定 |

### 5.8 App Lifecycle

```python
@asynccontextmanager
async def lifespan(app):
    # startup: 初始化 FinMindClient（建立 httpx.AsyncClient）
    # startup: 載入股票列表快取
    yield
    # shutdown: 關閉 httpx.AsyncClient
```

---

## 6. 前端規格

### 6.1 頁面佈局

單頁面應用，無 Router。

```
┌─────────────────────────────────────────────────┐
│  Header                                         │
│  [SymbolSearch: ____▼] [Date: ____] [🔄 Refresh]│
│  [Tab: 籌碼總覽] [Tab: 泡泡圖]                    │
├─────────────────────────────────────────────────┤
│  Error Banner (if error)                        │
├─────────────────────────────────────────────────┤
│                                                 │
│  Content Area (based on active tab)             │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 6.2 Error Banner

- 位置：Header 下方、Tab content 上方
- 顯示條件：`chipError || bubbleError`（任一 hook 回傳 error）
- 樣式：紅色背景半透明橫幅，文字顯示錯誤訊息
- 不阻塞頁面（仍可操作其他元素）

### 6.3 Tab 1：籌碼總覽

**佈局：** 兩欄 grid `[1fr_420px]`

**左欄 — K 線 + 子圖（ChipKlineChart）：**

子圖垂直比例：K 線 3.5 份 / 5 個子圖各 1 份，間距 6px。

1. **KlineChartSvg** — K 線 + MA5(黃)/MA20(紫) + 成交量柱狀圖
2. **InstBarSvg** — 主力買賣超（major_net）
3. **InstBarSvg** — 外資（foreign_net）
4. **InstBarSvg** — 投信（trust_net）
5. **InstBarSvg** — 自營商（dealer_net）
6. **MarginLineSvg** — 融資融券折線（margin_change + short_change 雙折線）
   - Hover 時額外顯示：margin_balance、short_balance、short_balance_ratio

**右欄 — ChipBrokersPanel：**
- 股票資訊 header（代號 + 名稱 + 日期）
- 三大法人區塊（外資/投信/自營商 buy/sell/net）
- 融資融券區塊（增減、餘額、券資比%）
- 主力買賣超摘要（top_brokers 加總 net）
- 買方 Top 15 broker list（net > 0，按 net 降序）
- 賣方 Top 15 broker list（net < 0，按 |net| 降序）

**Broker Badge 系統：**
- "外" badge：匹配 `外資|摩根|美林|高盛|瑞銀|花旗|瑞信|巴克萊|德意志|野村|大和|麥格理`
- "官" badge：匹配 `官股|公股|臺銀|台銀|兆豐|合庫|第一金|華南|彰銀|土銀`

**Hover 同步：**
- 所有子圖共享 `hoverIndex` state
- 移動游標時所有圖表同步顯示 crosshair + 對應數值
- 數值格式：帶正負號、千分位（如 `+1,234` / `-567`）

### 6.4 Tab 2：泡泡圖

**佈局：** 兩欄 grid `[1fr_400px]`

**左欄 — BubbleChartSvg：**
- 蝴蝶佈局：Y=價位、左=賣出(綠)、右=買入(紅)
- 氣泡半徑 ∝ √(volume)，面積 ∝ volume
- Min radius 3px, max 22px
- 忽略 volume ≤ 5 的交易
- 限制前 100 筆（by volume）做佈局
- **收盤價虛線標記**：取自 `history.candles` 中 date === activeDate 的 close，若找不到則用最後一筆 candle 的 close
- Hit-testing：hover 顯示 tooltip、click toggle broker filter

**右欄：**
- PriceBarSvg（180px）：分價蝴蝶圖（左賣右買）
- Filter indicator（如果有選中 broker）
- 買/賣 Trade list（各限 200 筆，按 volume 排序）
- **TradeList row click** 也可 toggle broker filter（同 bubble click）

**互動：**
- Hover bubble → tooltip（broker 名稱、張數、價格、方向）
- Click bubble OR TradeList row → toggle broker filter → 更新 PriceBar + TradeList
- Tooltip 使用 ref-based DOM 操作（非 React state）避免重繪

### 6.5 日期自動調整

- 首次載入或切換股票時，`userPickedDate = false`
- History 回傳後，取 `candles` 最後一筆的 date 作為 active date
- 用戶手動選日期後，`userPickedDate = true`，不再自動調整

### 6.6 Tab 狀態保持

- 使用 CSS `hidden` attribute pattern（非 unmount）
- 兩個 tab content 都 render，inactive 的加 `hidden` attribute
- 確保切 tab 不丟失滾動位置和 hover state

### 6.7 ChipBubbleView Lazy Loading

- 使用 `React.lazy()` + `<Suspense>` 載入 ChipBubbleView
- 首次切到泡泡圖 tab 時才載入
- Fallback 顯示 loading skeleton

### 6.8 股票搜尋（SymbolSearch）

- Shadcn `Input` + 自訂下拉選單
- Debounce 200ms 打 `GET /api/symbols?search=`
- 下拉顯示匹配的股票（代號 + 名稱）
- 選中後設定 `symbol` + `symbolName`
- 最少輸入 1 字元才觸發搜尋

### 6.9 Refresh 按鈕

- Shadcn `Button` variant="ghost"
- Disabled 條件：`loading === true` 或 `symbol` 為空
- 點擊時同時 refresh summary + history（或 bubble，取決於當前 tab）

### 6.10 色彩主題（chip-theme.ts，沿用原專案）

```typescript
Bull = "#e85a4f"      // 紅色（漲/買）
Bear = "#7fc99a"      // 綠色（跌/賣）
Ink = "#ede4d3"       // 主文字
InkMuted = "#d4c8b0"  // 次文字
InkDim = "#8a8273"    // 淡文字
Line = "#2e2a22"      // 細邊線
LineStrong = "#4a4234" // 粗邊線
MA5 = "#f0b429"       // MA5 黃
MA20 = "#b794f4"      // MA20 紫
Font = "Inter Tight, system-ui, sans-serif"
```

**整體風格：** 深色主題（dark mode only）

**字體載入：** 在 `index.html` 中用 Google Fonts CDN 引入 Inter Tight。

### 6.11 Shadcn/ui 元件列表

| 元件 | 用途 |
|------|------|
| Input | 股票搜尋輸入 |
| Button | 刷新按鈕 |
| Tabs, TabsList, TabsTrigger, TabsContent | Tab 切換（forceMount） |
| Skeleton | Loading state |

**不使用 Shadcn Calendar** — 日期選擇用原生 `<input type="date">` 保持與原專案行為一致。

### 6.12 Vite 設定

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000'
    }
  }
})
```

### 6.13 前端資料 helpers（chip-data.ts）

**Types:**
- `ChipSummary`, `InstitutionalSide`, `MarginSide`, `TopBroker`
- `ChipBubbleData`, `BrokerTrade`
- `ChipHistory`, `DailyCandle`, `InstitutionalDaily`, `MarginDaily`, `MajorDaily`

**Helper functions:**
- `splitBrokers(brokers: TopBroker[])` → `{buyers, sellers}`（by net > 0 / < 0）
- `aggregateByBroker(trades: BrokerTrade[])` → broker 級別彙總 + 加權均價
- `aggregateByPrice(trades: BrokerTrade[])` → 價位級別彙總，按價格降序
- `fmtVol(n: number)` → 千分位格式化

---

## 7. 測試規格

### 7.1 後端測試

**test_finmind.py（搬移 + 適配）：**
- `test_fetch_chip_summary_transforms` — 驗證 institutional/margin/broker 解析
- `test_fetch_chip_summary_cache_hit` — cache 命中不打 API
- `test_fetch_chip_summary_refresh_ignores_cache` — refresh 強制重取
- `test_fetch_chip_summary_empty_data` — 空資料邊界
- `test_fetch_chip_bubble_transforms` — 泡泡圖聚合 + lot 轉換
- `test_fetch_chip_history` — 歷史 K 線 + 法人 series + 融資融券 series + 主力 series
- `test_to_lots_truncation` — lot 轉換正負值，truncate toward zero
- `test_compute_major_net` — Top-15 聚合邏輯
- `test_broker_net_from_truncated_lots` — 驗證 net = _to_lots(buy) - _to_lots(sell) 語意

**test_chip_routes.py（搬移 + 適配）：**
- 三個 chip endpoint 正常回傳
- symbol search endpoint 正常回傳
- 502/503 錯誤處理
- 預設日期邏輯
- refresh 參數傳遞

### 7.2 前端測試

**chip-data.test.ts：**
- `splitBrokers` — 正確分流買方/賣方
- `aggregateByBroker` — broker 聚合 + 加權均價
- `aggregateByPrice` — 價位聚合 + 排序
- `fmtVol` — 千分位格式化

---

## 8. 啟動方式

```powershell
# 安裝
cd backend && pip install -e ".[dev]"
cd frontend && npm install

# 啟動後端
cd backend && uvicorn main:app --reload --port 8000

# 啟動前端
cd frontend && npm run dev

# 測試
cd backend && pytest
cd frontend && npm test
```

---

## 9. 從原專案移除的項目

- Fubon Neo SDK（全部）
- 群益 SKCOM 下單
- WebSocket pool / 即時行情
- Signal engine / Monitor rules
- Bookmarks / Watchlist
- Discord bot integration
- Supabase / USER_LABEL
- BFF API Key middleware
- MA / CDP / Camarilla 端點
- MXF 期貨相關
- Auto monitor / screener
- @dnd-kit（拖放排序）
- React Router

---

## 10. CORS 設定

```python
allow_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
allow_methods = ["*"]
allow_headers = ["*"]
```

無需額外的 `FRONTEND_ORIGIN` 環境變數（純本地開發）。

---

## 11. Shadcn/ui 配置

`components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```
