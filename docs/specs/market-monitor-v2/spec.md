# Market Monitor V2 — 大盤掃描頁 4 panel 重設計 + 新 panel

**Date**: 2026-06-30
**Type**: /mod(改既有 v0.18.0「大盤掃描 mode」4 panel + 新增 1 panel)
**Goal**: 解決原始痛點:現有 4 panel(熱力圖 / 漲跌幅 TOP / 大單量 / 量比)被權值股佔據、缺族群視角、混進 ETF/權證/處置股。
**SemVer**: MINOR(使用者可感的 UX / 視覺改動 + 新指標)
**Pre-reading**:
- 本對話的兩輪 deep-research 結論(第 1 輪 5 confirmed findings)
- `docs/specs/concept-cluster/spike-evidence/` 的「FinMind IndustryChain 細產業 tag 可用性」實證
- 既有 `routes/market.py` + `services/finmind_realtime.py` + `frontend/src/components/Market*.tsx`

---

## 1. 原始痛點(來自 user 2026-06-30 第一條 message)

| # | 痛點 | 對應現有 panel |
|---|------|-------------|
| 1 | 熱力圖看資金走向但只圍繞權值股(2330 / 2317 / 聯發科),看不到族群輪動 | sectors heatmap |
| 2 | 漲跌幅 TOP 15 沒實際決策價值(個股 outlier 主導) | leaderboards.gainers / losers |
| 3 | 大單量同樣只圍繞特定大型股 | leaderboards.amount |
| 4 | 量比有用但能改進 | leaderboards.volume_ratio |
| 5 | 全部要 4 位數股票(排 ETF / 權證) | 跨 panel filter |

---

## 2. 解法 5 個 panel(對應 5 痛點)

| 痛點 | 解法 panel | 資料來源 | 取代/改進? |
|------|-----------|---------|----------|
| #5 | **Universe filter**(共用)| TaiwanStockInfo + IndustryChain 推 ETF/權證/處置 黑名單 | 套入既有 4 panel,跨 panel 共用 |
| #1 | **Sector breadth heatmap** % 個股 > 20MA per sector | FinMind IndustryChain `industry`(32 大類)+ TaiwanStockPrice daily | **取代**現有 sectors heatmap |
| #2 | **McClellan Oscillator + AD Line** | TaiwanStockPrice daily(全 universe 漲跌家數)| **取代**漲跌幅 TOP |
| #3 | **Sector amount share**(細產業成交值佔大盤比 + Δ vs 20MA)| TaiwanStockPrice + IndustryChain | **取代**大單量(本身是個股維度,改族群維度)|
| #4 | **族群 volume ratio**(族群層級 vol / 20-day avg)| 同上,加 volume aggregation | **改進**量比(個股 → 族群)|

**Out of scope**(V2.5 / 後續另 spec):
- Faber sector rotation(屬「drill 進 sector 後看趨勢」,放 concept-drill spec)
- DC+HMM regime detection(第 1 輪 deep-research medium confidence,獨立小 feature)
- RRG(Relative Rotation Graph,deep-research 未驗證,待單獨 probe)
- LLM narrative ingestion(屬 V1 概念股題材深度)
- 籌碼共動 cluster(broker / 三大法人 同步,獨立大 feature,單寫 spec)

---

## 3. 成功條件(可驗收)

1. 進大盤掃描 mode 看到 5 個 panel(原 4 個被改造 + 新增 #3 sector amount share)
2. 所有 panel 預設 **universe = 4 位數普通股**(排 ETF prefix `00`、權證 stock_id 長度 ≠ 4、TWSE 注意/處置股)
3. Sector breadth heatmap 用 FinMind `industry`(32 大類)劃 sector,每格顯示「該 sector 中股價 > 20MA 比例」(顏色 = 比例 0-100%),hover 顯示成員數 + 強勢比例
4. McClellan Oscillator + AD Line 顯示趨勢線 + 數值;標記「±100 thrust」「centerline 0」「divergence vs 加權指數」訊號(訊號用 dot,**不寫方向性文案**)
5. Sector amount share 表/條:每 sector「今日成交值佔大盤 %」+「Δ vs 過去 20 日均值」,降序排列
6. 族群 volume ratio 表:每 sector「今日 vol / 過去 20 日 avg vol」,降序
7. **既有** market-monitor backend `/api/market/snapshot` endpoint **不刪除**,改追加新欄位(`breadth / sector_breadth / sector_amount_share / sector_volume_ratio`)而非 break;舊欄位 `gainers/losers/amount/volume_ratio` 保留 1 個 release 視 user 反饋再決定移除時點
8. 切換到 mode 後 5 panel 並排顯示在 viewport,**不需 scroll**(假設 1440x900 desktop)
9. 完成前 gate:`pytest -q` + `npm test` + `npm run build` + chrome-devtools 截圖驗證

---

## 4. 不能破壞(白名單)

| 行為 | 來源 | 驗證 |
|------|------|------|
| equity / options mode 完全不變 | `App.tsx` ternary | 既有 frontend test 全綠 |
| `/api/market/snapshot` endpoint 路徑 + refresh query 慣例 | `routes/market.py` | 既有 `test_market_routes.py` 全綠 |
| Bull = 紅 / Bear = 綠 配色 | `index.css @theme` | sector breadth heatmap **不**套這個(用 ink-accent 漸層) |
| `_CACHE_VERSION` 不動 | `services/finmind_realtime.py` | spec 強調 |
| `routes/market.py` error contract `{detail: {error: "<code>"}}` | 同上 | 新增 error code 沿用 |
| 既有 `useMarketSnapshot` hook 介面 shape | `hooks/useMarketSnapshot.ts` | 加新欄位 backward-compat(舊 prop 保留) |

---

## 5. Out of scope(寫進「下次處理」清單)

| 項目 | 為什麼延後 |
|------|----------|
| 移除舊 4 panel(gainers/losers/amount/volume_ratio)| V2 並列新舊;1 release 後依 user 反饋決定何時清除 |
| Live polling | 大盤資料 EOD 為主,5 秒 TAIEX 用既有 logic 即可 |
| 跨日 / 跨週對比 | V2 只顯示「最近一日 snapshot」 |
| 自訂閾值 UI(McClellan ±100 / breadth >70%) | 用硬編預設,user 抱怨再加 |
| Sector 自訂(讓 user 把多 sector 合成 super-sector) | concept-drill spec 處理 |

---

## 6. 各 panel 詳細設計

### 6.1 Universe filter(跨 panel 共用)

**目的**:確保所有 panel 看到的股票都是「4 位數普通股」。

**排除規則**:
- `stock_id` prefix `00` → ETF(例 0050 / 0056 / 0878 / 00919)
- `stock_id` 長度 ≠ 4 → 權證(例 7XX、6 位數)
- TWSE「注意股」/「處置股」/「全額交割股」→ 從 FinMind `TaiwanStockTradingDate` 或 TWSE 公告抓
- (可選 V2.5)KY 股不排除(僅標 flag),user 仍可看 KY 股

**實作**:`backend/services/market_universe.py`(新),提供 `get_filtered_universe() -> set[str]`,被既有 `services/finmind_realtime.py` 套用作前置 filter。

### 6.2 Sector breadth heatmap(取代 sectors heatmap)

**公式**:
```
sector_breadth[s] = count(stock.close > stock.MA20 in sector s) / count(stocks in sector s)
```

**Sector 定義**:FinMind `TaiwanStockIndustryChain.industry`(32 大類)— 不用 sub_industry(spec V0.2 6 spike 證明 sub 對 corr 沒解釋力,但對 heatmap 視覺**夠用**,sub 切太細視覺 crowd)。

**色票**:
- > 70% 強勢(深 ink-accent 漸層)
- 50-70%(中 ink-accent)
- 30-50%(neutral grey)
- < 30%(深 ink-muted)
- **不用 bull 紅 / bear 綠**(避免跟 K 線色票混淆)

**互動**:點 sector 格 → 觸發 concept-drill 進入該 sector 的 drill view(見 `docs/specs/concept-drill/spec.md`)

**參考**:第 1 輪 deep-research §B confirmed,StockCharts AD Percent per sector / breadth.app methodology

### 6.3 McClellan Oscillator + AD Line(取代漲跌幅 TOP)

**公式**(Ratio-Adjusted,跨 universe 套):
```
RANA = (上漲家數 − 下跌家數) / (上漲家數 + 下跌家數)
McClellan Oscillator = 19-day EMA(RANA) − 39-day EMA(RANA)
AD Line = 累加每日 (上漲家數 − 下跌家數)
```

**Universe**:套 §6.1 universe_filter(4 位數普通股)

**訊號**(只標 dot,不寫文案):
- McClellan ±100 thrust(超越則 dot)
- McClellan centerline cross(0 線上下穿越)
- McClellan vs 加權指數(0001)divergence(指數新高但 McClellan 沒同步 → divergence dot)

**色票**:純 ink 色階,**不用** bull/bear

**閾值 caveat**:
- 美股 McClellan ±100 是 ~3000 issues 校準的
- 台股 ~1000 issues,需 production 上線後依歷史 backtest 校準(spec 標 known gap)

**參考**:第 1 輪 deep-research §A confirmed,StockCharts ChartSchool

### 6.4 Sector amount share(取代大單量)

**公式**:
```
sector_amount[s] = sum(turnover_value in sector s) / total_market_turnover
share_delta[s] = sector_amount[s] - mean(sector_amount[s] over past 20 trading days)
```

**呈現**:表格降序排列,欄位 `sector / today_share / share_delta(20MA)`,顏色用 `share_delta` 正負(正 = ink-accent,負 = ink-muted)

**參考**:XQ 全球贏家教學「從細產業資金流向看類股輪動」(第 1 輪 deep-research §D)

### 6.5 族群 volume ratio(改進量比)

**公式**:
```
sector_vol_ratio[s] = sum(volume in sector s today) / mean(sum(volume in sector s) over past 20 trading days)
```

**呈現**:表格降序,欄位 `sector / today_vol(萬張)/ vol_ratio`。**Threshold 提醒**:vol_ratio > 1.5 標 dot(放量),< 0.7 標 dot(縮量)

**跟既有「個股 volume_ratio」差別**:既有是按單股算,容易被個股題材爆量主導;改族群維度看「整族群放量」更穩定

---

## 7. 前端 layout

```
+--------------------------------------------------------------+
| Header (時段 / refresh / lag indicator)                       |
+--------------------------------------------------------------+
| Universe filter banner: 「已排除 ETF/權證/處置股 共 N 檔」      |
+--------------------------------------------------------------+
| Left col            | Center col              | Right col      |
| (廣度 panel)         | (Sector breadth heatmap) | (資金流向 + 量) |
|                     |                         |               |
| McClellan + AD Line | (sector grid,點擊 drill)| Sector amount  |
| 趨勢圖              |                         | share(降序)   |
|                     |                         |               |
|                     |                         | 族群 vol ratio |
|                     |                         | (降序)         |
+--------------------------------------------------------------+
```

(V2.5 可考慮 layout 自適應,目前 desktop 為主)

---

## 8. 跨檔契約

- `/api/market/snapshot` payload 新增欄位:
  ```jsonc
  {
    "as_of_date": "2026-06-30",
    // 既有(V2 保留 1 release)
    "leaderboards": { "gainers": [...], "losers": [...], "amount": [...], "volume_ratio": [...] },
    "sectors": [...],  // 既有 heatmap
    // V2 NEW
    "universe_size": 1023,  // filter 後 4 位數普通股數
    "excluded_count": { "etf": 187, "warrant": 8421, "watch_list": 12 },
    "breadth": {
      "ad_line_value": 12345,
      "mcclellan_oscillator": -42.3,
      "ad_line_series": [...],  // 60 天序列供畫圖
      "mcclellan_series": [...],
      "thrust_dot": "above_plus_100" | "below_minus_100" | null,
      "centerline_cross": "above" | "below" | null,
      "divergence_dot": "bearish" | "bullish" | null
    },
    "sector_breadth": [
      { "sector": "半導體", "members": 142, "above_ma20": 89, "pct": 0.627 },
      ...
    ],
    "sector_amount_share": [
      { "sector": "半導體", "today_share": 0.412, "share_delta_20ma": 0.034 },
      ...
    ],
    "sector_volume_ratio": [
      { "sector": "電子零組件業", "today_vol_lots": 1234567, "vol_ratio": 1.42 },
      ...
    ]
  }
  ```

- error contract 維持 `{detail: {error: "<code>"}}`
- 新 error code:`universe_filter_unavailable`(若 TaiwanStockInfo / 處置股清單 fetch fail)

---

## 9. 風險 + 開放問題

| 風險 | 緩解 |
|------|------|
| TWSE 注意/處置股清單來源 — FinMind 是否有對應 dataset? | P1 先 probe;若無,fallback 用 TWSE OpenAPI 或 daily 公告 scrape |
| McClellan ±100 thrust 閾值在台股 ~1000 issues 不準 | spec 標 known gap;P5 加 backtest 紀錄,V2.5 補閾值校準 |
| Sector breadth 用 industry 32 大類仍可能粗(半導體 142 檔)| concept-drill spec 處理 drill 看 sub_industry / 個股 |
| 量比改成族群維度後,個股維度沒了 — 部分 user 可能想看個股 | V2 保留舊 panel 1 release,看用戶反饋再決定 |
| MA20 需 60+ trading day 歷史資料,新上市股 < 20 天時怎麼算 | 該股 skip,sector breadth 分母排除該股 |

### 開放問題
- Sector 數 32 是否要再聚合(`半導體` 已含設計/封測/晶圓/通路/基板)?或保持 32 大類交給 concept-drill 細分?
- McClellan ratio-adjusted 跟 raw 差異對台股是否明顯?(美股因 issues 變動大要 ratio,台股穩定可能 raw 即可)
- 是否該加「全市場 % > 20MA」單一數字當 hero metric?

---

## 10. 反身性 self-audit

1. **「mega-cap bias = 缺陷」這個前提**(concept-cluster 早期 audit 已提)— 權值股主導不是 bug 是市場現實;sector breadth 是次訊號,**不該獨立決策**
2. **單人使用 vs 公開** — 訊號公開即失效,本 spec 預設 personal tool 用,**不建議公開喊單**
3. **6 panel 並排會有「決策過載」** — V2 ship 後若發現 user 一次只看 1-2 panel,V3 可考慮 collapsible / tab 化
4. **新舊 panel 並列 1 release** — 留 1 release 後若 user 還在用舊 panel,代表 V2 redesign 沒解問題,要 root cause 而非機械移除舊 panel

---

## 11. SemVer & Changelog

- 既有 `0.18.x` → 完成後 `0.19.0`(MINOR,使用者可感新指標 + 視覺重組)
- changelog 條目草稿:
  ```ts
  { date: '2026-MM-DD', kind: 'feature', scope: 'global',
    text: '大盤掃描頁新增族群參與度、市場廣度、族群資金流向指標,並過濾掉 ETF / 權證 / 注意處置股' }
  ```

---

## 12. Revision History

- **V2**(2026-06-30)— /mod 既有 v0.18.0 大盤掃描 mode,改造 4 panel + 新增 sector amount share。基於本對話兩輪 deep-research + concept-cluster spec V0.2 反身性 audit 沉澱
