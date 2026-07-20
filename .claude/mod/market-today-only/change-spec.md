# mod/market-today-only — change-spec

User 拍板(2026-07-20 對話):market 頁分析區重定位 —「看今天」:加權 vs 上櫃強弱、權值獨強還是中小強、資金流到哪些族群(去台積電/市值偏差)、族群三層鑽取(產業 → 子產業 → 成員股)。移除全部 20/60 日歷史窗計算(冷載入分鐘級問題根除)。經典檢視(heatmap + 排行)保留折疊不動。

## §1 成功條件(SC)

**單位契約(全 spec 統一,R7)**:所有 `*_change_rate` 欄位 = **百分比數值**(−2.11 表示 −2.11%),與 tick snapshot upstream 透傳慣例一致(2026-07-20 真實 API 實證:101 row `change_rate: -2.11`);貢獻公式內 `chg_i` = `change_rate / 100`(小數比率)。既有 e2e tick fixture 的 change_rate 值(0.009 級雜值)與真實 API 不一致,本次修 fixture 時一併對齊百分比語意。

- **SC-1 大盤強弱卡**:加權(001)/ 櫃買(101)即時漲跌並排;「拉盤結構」= 001 漲跌% − 上市普通股中位數漲跌%(>0 = 權值拉指數,<0 = 中小強),同式櫃買一組;台積電今日漲跌% + 對加權貢獻點數。
  - 資料前提(已實證,2026-07-20 真打):tick snapshot 含 `001` 與 `101` index rows,欄位含 `close` / `change_price` / `change_rate`;`index_prev_close = close − change_price`。
  - 貢獻點數(估算,與看盤軟體同法):`contrib_i = index_prev_close × (mv_i × chg_i) ÷ Σ mv(該市場 universe)`。上市 / 上櫃各出「拉抬前五 / 拖累前五」。Σmv 用 universe(已剔 ETF/處置股)總和,與真實指數基底的偏差列為估算誤差來源(UI 標「估算」)。
  - unit:% 與點數;量法:unit test 固定 fixture 手算對照 + real-env 與看盤軟體貢獻排行方向一致(容忍估算誤差)。
- **SC-2 權值 vs 中小分層**:全市場(上市+上櫃普通股)按 T-1 市值分三桶 — 前 50 / 51-150 / 其餘;各桶等權平均漲跌% + 上漲家數比例(chg>0 / 總數,平盤不計入分子)。
  - 邊界(R8):mv 缺的股**剔除**不入任何桶、不計 members;change_rate 為 null 的股剔除(不入 median / avg / up_ratio 分母)。
- **SC-3 族群輪動三層**:
  - 主列表 = IndustryChain 47 產業:等權平均漲跌%、量比(Σ今日量 ÷ Σ昨日量)、成員數;等權漲跌 desc 排序。
  - 展開產業 → 子產業列(同 metrics)。
  - 點開子產業(或產業)→ 成員股列表:漲跌%、量比、成交額(新 endpoint,見 §3)。
  - 一檔多桶:同一產業內同 stock_id 去重(等權一票);跨產業允許重複(集團股天生多桶,UI 標成員數即可)。
  - 邊界(R8):成員缺 `yesterday_volume` → 該股**分子分母同步剔除**(不對稱剔除會系統性高估量比);剔除後分母 0 → 量比 null。IndustryChain 未涵蓋股不入輪動視圖。
- **SC-4 歷史窗管線移除**:market_breadth.py / sector_aggregation.py / _fetch_eod_results 背景任務 + backoff 機制整段刪除;`/api/market/snapshot` 冷請求(部署後首發)**< 5s**(量法:重啟 backend 首發 curl `%{time_total}`;現況分鐘級)。
- **SC-5 契約與降級**:snapshot 新欄位 shape 固定(§3);IndustryChain fetch 失敗 → `sector_rotation: null` + 其餘欄位照常(不 500);mv_map 失敗 → 貢獻 top5 與 cap_tiers null 降級,index 卡的漲跌/中位數/spread 照常;**001 或 101 index row 缺席(R5)→ `index_strength.twse` / `.tpex` 該側整組 null(含該側 contrib)**,另一側照常。

## §2 不能破壞的既有行為白名單

1. 經典檢視:heatmap(市值加權著色/佈局)+ 四排行榜完全不動。
2. Universe filter:普通股 whitelist(排除 ETF / 權證 / index rows / 處置股)沿用 `primary_sector` 對映;tick snapshot 5s cache、`_run_once` dedup、cancel 鏈(run_with_disconnect)不動。
3. `refresh=true` 語意:跳 cache 重抓 tick snapshot(不再有 EOD 面)。
4. equity / options / borrow 三 mode 零波及;`/api/market/snapshot` 之外的 route 不動。
5. e2e M1 / M2 / M3 / M5 / M6 / M8 保持綠;M4 / M9 是 🔴 該紅(見 §4);M7(1440x900 幾何)為**條件綠**(R9):新版面沿用 `market-v2-grid` testid 且維持無 scroll 約束,若版面高度合法改變則 M7 同 PR 調整 assertion。
6. 盤中 `is_trading_session` 2.5s 輪詢節奏與 `useForceRefreshQuery` cancel-before-refetch 行為不動。

## §3 對外契約(diff 級)

### snapshot payload(`GET /api/market/snapshot`)
移除欄位:`breadth`、`sector_breadth`、`sector_volume_ratio`、`sector_amount_share`、`eod_pending`、**`eod_as_of`(R2 — producer 隨 _fetch_eod_results 刪除,欄位一併移除,不保留 null 孤兒)**。
新增欄位(全部可 null,降級語意 SC-5):

```jsonc
"index_strength": {
  "twse": { "close": 42650.6, "change_rate": -0.04, "median_change_rate": -1.8, "spread": 1.76 },
  "tpex": { "close": 370.4, "change_rate": -2.11, "median_change_rate": -2.4, "spread": 0.29 },
  "tsmc": { "change_rate": 1.2, "contrib_points": 210.5 },
  "contrib": {
    "twse": { "up": [ { "stock_id": "2330", "name": "台積電", "change_rate": 1.2, "contrib_points": 210.5 } /* ×5 */ ], "down": [ /* ×5 */ ] },
    "tpex": { "up": [/*×5*/], "down": [/*×5*/] }
  }
},
"cap_tiers": [
  { "tier": "top50", "members": 50, "avg_change_rate": -0.3, "up_ratio": 0.32 },
  { "tier": "mid100", "members": 100, "avg_change_rate": -1.9, "up_ratio": 0.18 },
  { "tier": "rest", "members": 1600, "avg_change_rate": -2.2, "up_ratio": 0.15 }
],
"sector_rotation": {
  "as_of": "2026-07-20 13:07:05",
  "industries": [
    { "name": "半導體", "members": 120, "avg_change_rate": 0.4, "vol_ratio": 1.31,
      "subs": [ { "name": "記憶體IC", "members": 6, "avg_change_rate": 3.1, "vol_ratio": 2.4 } /* … */ ] }
    /* 47 組,等權漲跌 desc */
  ]
}
```

輪詢成本:industries+subs 無成員股列表,估 30-60KB pre-gzip(盤中 2.5s 輪詢可承受;成員股不入 payload)。

### 新 endpoint:`GET /api/market/sector_members?industry=<name>&sub_industry=<name?>`
- 從 universe / sector_map / chain 的**既有 TTL cache**(universe 5s、sector_map 24h、chain 7d)組成員列表:`{ industry, sub_industry, members: [{ stock_id, name, change_rate, vol_ratio, total_amount }] }`,依漲跌 desc。cache 溫時零 FinMind 呼叫(dashboard 2.5s 輪詢常態);cache 冷時沿用各 fetcher 的既有重抓語意(review P2#4 措辭修正 — 非嚴格零呼叫)。
- 未知 industry → 404 `{"error": "unknown_sector"}`;錯誤 contract 沿用 detail.error。

### 新資料源:TaiwanStockIndustryChain
- 新 service `services/industry_chain.py`(per-module `get_finmind()` wrap,finmind-conventions):全表 1 request,disk cache TTL **7 天**(靜態對映);失效時機 = TTL 過期 / `_CACHE_VERSION_INDUSTRY_CHAIN` bump;bust 觸發點 = fetch 函式內 TTL 判斷(refresh=true **不**強制重抓 chain — 靜態資料無盤中變動);驗證測試 = `test_industry_chain.py`(cache 命中零 call / TTL 過期重抓 / 失敗降級 null)。
- **FAKE_FINMIND=1 時 chain cache 只寫 memory 不落檔**(R10,沿 warrant_iv_history R17 precedent — 防 e2e 跨 run 殘留 + FAKE_TODAY 凍結時鐘下 7 天 TTL 永不過期問題);`test_industry_chain.py` 加對應 case。

## §4 逐檔 diff 計畫(三類標記)

### Backend
| 檔 | 類 | 動作 |
|---|---|---|
| `services/industry_chain.py` | 🟢 | 新增:fetch + 7 天 cache + `(industry, sub, stock_ids)` 對映結構 |
| `services/market_today.py` | 🟢 | 新增:純函式 compute — index_strength(含貢獻 top5)/ cap_tiers / sector_rotation / sector_members。輸入:`universe rows`(已過 filter 的普通股)+ **`index_rows: dict[str, dict]`(R12 — finmind_realtime 在 universe filter **之前**從 raw snapshot 抽 001/101 傳入;白名單第 2 條的「filter 排除 index rows」只約束普通股 universe,不約束此獨立抽取)** + mv_map + type_map + chain;零 IO。`test_market_today.py` 的 index 缺席 case 以 index_rows 缺 key 模擬 |
| `services/finmind_realtime.py` | 🔴+🟢 | 🔴:移除 `_fetch_breadth/_fetch_sector_*`、`_fetch_eod_results`、`_eod_background`/`_eod_backoff_until`/`_EOD_COMPONENT_KEYS`、payload EOD 欄位(含 eod_pending / eod_as_of);🟢:接 market_today compute + 001/101 抽取點 + `_fetch_sector_map` 回傳 type map。**Commit 拆法(R15):🔴 commit = EOD 移除 + payload 欄位刪除(新欄位以 null 佔位入 payload shape);🟢 commit = market_today 接線讓欄位有值** |
| `services/market_breadth.py` | 🔴 | 整檔刪除(唯一 consumer 是 _fetch_breadth;prices window 委派同亡) |
| `services/sector_aggregation.py` | 🔴 | 整檔刪除 |
| `routes/market.py` | 🟢 | 加 `/sector_members` route(cancel 鏈同 snapshot 慣例) |
| tests:`test_market_breadth*.py`、`test_sector_aggregation*.py` | 🔴 | 刪除(行為隨功能移除) |
| tests:`test_finmind_realtime.py` EOD 相關段 | 🔴 | 移除 EOD 測試;snapshot payload shape 測試改新欄位 |
| **`tests/conftest.py`(R1 — P0)** | 🔴 | 移除 `import services.market_breadth as mb` 與 `fr._eod_background` / `fr._eod_backoff_until` / `mb._inflight` 清理段(保留 `fr._inflight` / `mu._inflight`);不改則 collection 期 ImportError 全 suite 假紅 |
| `tests_e2e/test_api_market.py`(R4) | 🔴 | `eod_as_of` / `breadth` / `sector_breadth` 存在性 assert 改新契約鍵(此檔在 `pytest -q` 無條件 gate 內) |
| `services/warrant_flow.py` 等引用 market_breadth 的 docstring/註解 | 🔵 | 收尾同步(不影響行為) |
| tests:`test_industry_chain.py`、`test_market_today.py`、routes 測試 | 🟢 | 新增(SC-1/2/3/5 邊界:空 universe / mv 缺 / chain 缺 / 分母 0 / 多桶去重 / index row 缺席 / FAKE 不落檔) |

### Frontend
| 檔 | 類 | 動作 |
|---|---|---|
| `lib/market-types.ts` | 🔴 | 型別:刪四 EOD 欄位 + eod_pending,加三新欄位 |
| `lib/market-api.ts` | 🟢 | 加 sectorMembers() |
| `components/MarketIndexStrength.tsx` + test | 🟢 | 新:大盤強弱卡(SC-1) |
| `components/MarketCapTiers.tsx` + test | 🟢 | 新:分層條(SC-2) |
| `components/MarketSectorRotation.tsx` + test | 🟢 | 新:輪動三層(SC-3,成員展開 fetch sector_members) |
| `components/MarketPage.tsx` + test | 🔴 | 換掛新三卡,移除舊四卡;`eod_pending` 輪詢分支移除 |
| `components/MarketBreadthPanel.tsx`、`MarketSectorBreadthHeatmap.tsx`、`MarketSectorVolRatio.tsx`、`MarketSectorAmountShare.tsx`、`lib/breadth-svg.tsx`、`lib/sector-breadth-svg.tsx` + tests | 🔴 | 刪除 |
| `lib/market-format.ts`(R2) | 🔴 | `eodLabel()` 隨 eod_as_of 移除退役;`market-format` 其餘保留 |
| `lib/market-format.test.ts`(R13) | 🔴 | `describe("eodLabel")` 段移除(lotsToWan / pctText / signedPctPoints 段保留) |
| `components/MarketColdLoad.test.tsx`(R11 — P0) | 🔴 | **改寫不刪檔**:此檔鎖 useContainerSize cold-load 0×0 regression(ref 只掛資料態分支的 bug),import 的舊二元件刪除後必炸;新三卡凡含 SVG + useContainerSize 者,同型 regression case(loading → data 後量到真實寬度)移植到新卡,走真實 hook 不 mock |
| `lib/market-types.test.ts`、`hooks/useMarketSnapshot.test.ts`(R2) | 🔴 | eod_as_of / eod_pending 契約段隨欄位移除改寫 |
| `hooks/useMarketSnapshot.ts` | 🔴 | `eod_pending` 輪詢分支移除(盤中 2.5s 不變) |
| UI 實作前呼叫 frontend-design + bencium-controlled-ux-designer(user 常規指示) | — | Phase 4 進 UI 前 |

### E2E / fixtures / 文件
| 檔 | 類 | 動作 |
|---|---|---|
| `e2e/specs/market.spec.ts` M9 | 🔴 | 改為新三卡資料級 assertion(貢獻 top5 非空、輪動列表非空、分層三桶;手算基準值與 fixture 同 commit 對齊)+ **展開第一個產業列 → assert 成員列表非空(R14 — 走真 sector_members fetch,新 endpoint 的 e2e 歸屬在此,不另開 spec;404 contract 由 routes pytest 覆蓋)** |
| `e2e/specs/market.spec.ts` M4(R3) | 🔴 | 四舊 panel testid visible assert 改為三新卡 root visible |
| `e2e/specs/live-contract.spec.ts` L3(R4) | 🔴 | breadth / sector_* 四鍵 + mcclellan shape assert 改新三欄位存在性(null 容許) |
| `e2e/helpers/selectors.ts`(R3) | 🔴 | 刪四舊 panel testid 常數、加三新卡 testid |
| `tests_e2e/fixtures/taiwan_stock_tick_snapshot_2026-06-26.json`(R6) | 🔴 | 補 `001` / `101` index rows(含 close/change_price/change_rate)+ 各股 `yesterday_volume` 欄 + change_rate 值對齊百分比語意(現值 0.009 級雜值);M9 手算基準同步 |
| `scripts/gen-market-e2e-fixtures.py` + EOD 窗口 fixture + MANIFEST 條目 | 🔴 | EOD 窗口生成移除;新增 IndustryChain fixture(縮樣)+ MANIFEST 條目(與 fetch method 同 commit,MANIFEST gate) |
| `frontend/src/lib/changelog.ts` | 🟢 | MINOR bump 0.37.0(user 可感 redesign) |
| 專案 CLAUDE.md §0 / skill `market-pipeline` | 🔵 | 收尾同步(EOD 管線敘述移除) |

### 既有測試紅綠預判
- 該紅(🔴):上表刪除/改動檔的對應測試、`test_finmind_realtime.py` 的 payload shape / eod 段、`tests_e2e/test_api_market.py`、M4 / M9、live-contract L3、`MarketPage.test.tsx`、`market-types.test.ts` / `useMarketSnapshot.test.ts` 的 eod 段、`market-format.test.ts` eodLabel 段、`MarketColdLoad.test.tsx`(改寫移植)、`market-types` 波及的 type check。

Review 記錄:round 1 R1-R10、round 2 R11-R15 全數修入(P0×2 / P1×8 / P2×5,無遺留);P2 處置 — R8/R9/R10/R14/R15 均已落為 spec 條文。
- 不該紅:heatmap / leaderboard / universe filter / cancel 鏈 / equity / options 全部測試,M1/M2/M3/M5/M6/M8(M7 條件綠,見 §2.5)。

## §5 Backward compat / migration

- 無外部 API consumer(前後端同 repo 同 PR 部署);payload 欄位移除不需 deprecate window。
- 孤兒 cache(`breadth_prices_*` chunked JSONL、`eod_results_*`、`taiex_close_*` 等 breadth 家族):prd 磁碟 ephemeral 自然消失;本機在 Phase 7 驗證時一次性手動清除(regenerable cache,非資料)。
- 可逆性:單 PR revert 即回復舊四格(cache 會重建)。

## §6 Out of scope

- ABF/HDI/FPC 細分(IndustryChain 天生同桶)、景碩歸類修正 — 資料源限制,UI 標註即可。
- 輪動的多日歷史軌跡(rotation 時序圖)— 未來若要,另開 feature 且不得重引 per-day 歷史窗。
- 經典檢視任何改動。
- 興櫃(emerging)股票(tick snapshot 不含)。

## §7 規模

L 級(≥5 檔、對外 payload 契約、跨 backend/frontend/e2e)→ Phase 3 review max 2 輪,退出條件無 P0/P1。
