# options-page-v2 — Design (v3)

> Phase 1 artifact | 上游:`brainstorm.md`(SC-1~11)+ `docs/superpowers/specs/2026-07-07-options-page-v2-design.md`
> Changelog:
> - v1(2026-07-07)初版
> - v2(2026-07-07)round 1 修 9 findings(1 P0 + 3 P1 + 5 P2,詳見 `design-review-round-1.json`):R1 spot=None caller 傳導、R2 dynamic wall None 規格、R3 institutional series 全側聚合 + day_change 恆 0 入 Known Risks、R4 新增 §1.4 strike_volume 含 OI>0 strike(🔴)、R5 retail series 缺日 drop、R6 options-svg.test.tsx 遷移、R7 StrikeLadder 反色遺留明文、R8 獨立 _CACHE_VERSION_FUTURES、R9 warning 固定字串
> - v3(2026-07-07)round 2 修 4 findings(1 P1 + 3 P2,詳見 `design-review-round-2.json`):R10 strike_volume 基準日 fallback 對齊 + 前端 as_of 防禦、R11 拆 _CACHE_VERSION_STRIKE_VOL、R12 RangeMap 視窗策略、R13 types 補 dropped_no_close。**Round 2 gate 達標(0 P0 / 1 P1),Phase 1 收斂。**

## 0. 架構總覽

```
OptionsPage.tsx(重排)
├─ OptionsHeader(既有,不動)
├─ no-trading-day banner(既有,不動)
├─ OptionsConclusionBar        (NEW, SC-6)   ← mp + ow + spot
├─ OptionsRangeMap             (NEW, SC-7)   ← sv + spot + ow + mp(牆用後端權威值)
├─ OptionsThermometerRow       (NEW, SC-8)   ← inst + lt + pcr + retail + foreignFut
└─ OptionsAdvancedPanel        (NEW, SC-9)   ← 全部 payload(現四卡統計 + NET 對照表)
        │
        ▼
Backend routes/options.py
├─ 既有 5 endpoint:oi_walls 行為修正(SC-1/2/3)、institutional / pcr 加 series(SC-8 供給)
└─ NEW:/api/options/retail_mtx(SC-4)、/api/options/foreign_futures(SC-5)
        │
        ▼
services/finmind.py(fetch)+ services/finmind_options.py(SC-1/2/3 parser 修正)
+ services/finmind_futures.py(NEW,SC-4/5 純 parser)
```

**被移除的元件**:`OptionsChipPanel`(四卡平列容器)、`OptionsLargeTradersStrip`(NET 四格)、`OptionsStrikeLadder`(wrapper)— 內容分別收進 AdvancedPanel / ThermometerRow / RangeMap。**雙源收斂**:`options-svg.tsx::maxOIStrike`(前端自算牆)刪除,牆一律吃後端 `oi_walls` payload(SC-1 修正後的權威值)。

## 1. Backend 計算修正(SC-1/2/3;🔴 行為改動)

### 1.1 SC-1 靜態牆限價外側(`services/finmind_options.py`)

```python
def _pick_static_wall(
    oi_map: dict[float, int], spot: float | None, side: str,  # "call" | "put"
) -> dict | None:
    # spot is None → return None(caller 記 warning "oi_walls_no_spot",不用 0 硬算)
    # side="call" → 候選 = {K: oi for K, oi in oi_map if K >= spot}
    # side="put"  → 候選 = {K: oi for K, oi in oi_map if K <= spot}
    # 候選空 → None(caller 記 warning "static_wall_no_otm_candidate")
    # 其餘同現行:max OI,tie-break closest to spot
```

- `parse_oi_walls` 的 `spot` 參數型別改 `float | None`;`band_width_pct` 型別改 `float | None` — 任一牆為 `None` 時 `band_width_pct=None`(**不是 0**,0 是合法窄區間值)。有值時因側別限制恆 ≥ 0。
- Warning 名固定:`oi_walls_no_spot` / `static_wall_no_otm_candidate_call` / `static_wall_no_otm_candidate_put`(分側,結論列要分別 fallback)。
- **Caller 同步改(R1 修,P0)**:`services/finmind.py::fetch_oi_walls` 現行 `spot_val = float(spot_payload.get("spot") or 0.0)`(finmind.py:1497)把 None 強轉 0.0,parser 的 None 分支永遠不可達 → 移除 `or 0.0` coercion,spot 缺時傳 `None` 進 `parse_oi_walls`。route-level 測試必含:spot payload 無值時 oi_walls 回四牆全 null + 僅 `oi_walls_no_spot`(**不得**出現 `static_wall_no_otm_candidate_*`)。

### 1.2 SC-2 動態牆改淨增倉(同檔)

```python
def _pick_dynamic_wall(net_increase_map: dict[float, int], spot: float) -> dict | None:
    # net_increase(K) = oi_end(K) − oi_start(K)(window 首尾差,非 Σ|Δ|)
    # 取最大「正值」;全部 ≤ 0 → None(caller 記 warning "dynamic_wall_no_net_increase")
    # tie-break closest to spot;回傳 {"strike", "window_net_increase_oi", "partial_window"}
```

- **spot=None 統一規則(R2 修)**:`parse_oi_walls` 入口先判 — `spot is None` → 四面牆(static×2 + dynamic×2)全 `None`、`band_width_pct=None`、warnings **只含** `oi_walls_no_spot`(不 emit `static_wall_no_otm_candidate_*` / `dynamic_wall_no_net_increase` — 缺 spot ≠ 無候選/無增倉),`_pick_dynamic_wall` 因此不會收到 None spot,簽名維持 `float`。
- `parse_oi_walls` 內 `activity_for_side` 改為首尾差計算;新掛牌 strike(window 起點無資料)視 oi_start=0,全額算增倉(語意=新錢),沿用 partial_window flag。
- **跨檔契約改名**:payload 欄位 `window_activity_oi` → `window_net_increase_oi`。同步改:`frontend/src/lib/options-types.ts::OIWallDynamic`、AdvancedPanel 顯示、既有測試。
- 舊 warning `dynamic_wall_no_activity` 刪除(語意被 `dynamic_wall_no_net_increase` 取代)。

### 1.3 SC-3 hit rate 側別同步(同檔)

- `parse_oi_walls_hit_rate`:`closes_by_date` 從 optional 改**必要語意** — `t_minus_1` 無 close 的樣本**剔除**並累計;`dropped > 0` 時 warning 用**固定字串** `hit_rate_samples_dropped_no_close`(R9 修:動態計數不進契約字串),計數放 payload 欄位 `hit_rate.dropped_no_close: int`;移除 anchor=0.0 fallback。
- 牆選擇改用 1.1 的側別版:`_pick_static_wall(call_oi, spot=t1_close, side="call")` / put 同理;任一側 None → 該樣本剔除(同計 dropped)。
- 呼叫端 `services/finmind.py::fetch_oi_walls` 已傳 `closes_by_date=tx_closes`(finmind.py:1518-1522,已確認)。
- `_CACHE_VERSION_OPTIONS_CHIP` bump → 2(1.1-1.3 全部生效即作廢舊 cache)。

### 1.4 SC-7 附帶:strike_volume 含 OI>0 strike(R4 修;🔴 行為改動)

- `parse_strike_volume` 的 drop 規則從「volume == 0 剔除」改為「`volume > 0 OR oi > 0` 保留」— OI 牆常落在深 OTM 大 OI 但當日零成交的檔位,RangeMap 的 OI 分布與牆標記(吃 oi_walls 權威值)必須共享同一 strike 集合,否則牆標記懸空 / 分布圖缺大 OI 檔位。
- **基準日 fallback 對齊(R10 修,P1)**:`parse_strike_volume` 的 `today = dates[-1]` 改採與 `fetch_oi_walls` F7 同款「最近**有 OI** 的日子」fallback — 交易日早晨僅夜盤 rows 發布(volume>0 但 OI 全 0)時,舊規則選日 D、oi_walls 退 D-1,RangeMap 疊圖基準日不一致(懸空牆 + 全零分布,每個交易日早晨重現)。對齊後兩 payload 的 `as_of_date` 同日。
- `oi_change` 計算規則不變;cache version **拆獨立 `_CACHE_VERSION_STRIKE_VOL = 2`**(R11 修:只作廢 strike_volume 舊 entry — 從 2 起跳使共用 `_CACHE_VERSION_OPTIONS=1` 時代的舊 cache 失效;spot / oi_large_traders 的 30 個攤提 cache **不**波及,對齊 R8 per-domain 慣例)。
- 前端 renderer 仍加防禦:牆 strike 不在資料集時照價位軸插畫標記(不 crash、不省略),vitest 鎖住「牆 strike 缺 bar」case。

## 2. Backend 新資料(SC-4/5;🟢)

### 2.1 純 parser:`services/finmind_futures.py`(NEW,零 I/O,樣板=finmind_options.py)

```python
def parse_retail_mtx(rows_total: list[dict], rows_inst: list[dict]) -> dict:
    """rows_total: TaiwanFuturesDaily data_id=MTX;rows_inst: TaiwanFuturesInstitutionalInvestors data_id=MTX。
    per-day:total_oi(position session、單月合約加總)、inst_long/inst_short(三法人合計)
    retail_long = total_oi − inst_long;retail_short = total_oi − inst_short
    ratio = (retail_long − retail_short) / total_oi
    日資格(R5 修):total_oi=0 或該日「無任何法人 rows」→ 該日整筆 drop(不以 0 入列,
    偽中性點會污染 sparkline);dropped>0 → warning "retail_mtx_days_dropped"(固定字串)
    + payload 欄位 dropped_days: int
    回傳 {"current": {...}, "series": [{date, ratio}] 20 日, "as_of_date", "dropped_days"}"""

def parse_foreign_futures(rows_inst: list[dict]) -> dict:
    """rows_inst: TaiwanFuturesInstitutionalInvestors data_id=TX、外資 rows。
    per-day:foreign_net = long_oi − short_oi
    回傳 {"current": {long_oi, short_oi, net_oi}, "series": [{date, net_oi}] 20 日, "as_of_date"}"""
```

- **欄位名以 SC-0 probe 為準**(brainstorm R:MTX/TX 法人 dataset 欄位未驗證):probe 腳本擴充 `backend/tests/fixtures/options_chip/probe.py` pattern,產出 fixture 進 committed fixtures + MANIFEST。
- 三大法人鍵名沿用 `foreign / dealer / trust` 契約(CLAUDE.md §4)。

### 2.2 Fetch:`services/finmind.py::FinMindClient` 加兩個 method

- `fetch_retail_mtx(date_str, refresh)` / `fetch_foreign_futures(date_str, refresh)`:各 1-2 個 **range query**(start = end − 40 calendar days,涵蓋 20 交易日),TokenBucket + atomic cache + `_run_once` dedup 全套;cache key `retail_mtx_{end}` / `foreign_futures_{end}`,version = **`_CACHE_VERSION_FUTURES = 1`**(R8 修:定義在 `finmind_futures.py` 自帶,不借用 `_CACHE_VERSION_OPTIONS_CHIP` — cache version 慣例 per-service,TXO chip bump 不應作廢期貨 cache)。配額影響 ~2-4 calls/冷載,可忽略(6000/hr 瓶頸無感)。
- 不開新 service module(fetch 集中 FinMindClient 是既有 pattern;parser 純函式另檔),故不觸發 per-module `get_finmind()` wrap 規則。

### 2.3 Routes:`routes/options.py` 加兩個 endpoint(SC-4/5)

- `GET /api/options/retail_mtx?date=&refresh=`、`GET /api/options/foreign_futures?date=&refresh=`;共通行為沿用:`run_with_disconnect`、`_is_stale_for_requested` → `no_trading_day`、`detail.error` 契約、502/503 走 main.py global handler。

### 2.4 既有 payload 補 series(SC-8 供給;🟢 additive)

- `fetch_institutional` payload 加 `series: [{date, foreign_total_net}]`(20 日)。**聚合來源(R3a 修)**:既有 `foreign_history` 只聚合 call 側(finmind.py:1707),**不能**導出 total_net — 需在 `fetch_institutional` 內對 `rows_day` 新寫 per-date **call+put 全側**聚合,raw rows 已在手、零額外 fetch(修正 v1「資料已在 foreign_history」的錯誤依據)。
  [amendment 2026-07-07: code-review CR1(P0)— 公式自 `call_net + put_net` 改為 **delta 等效 `call_net − put_net`**(買 put = 偏空,與大戶 OI `_aggregate_call_put_pair` 換向規則一致);純加總會把大買保護性 put 判讀成淨多,溫度計「淨多/淨空」句方向相反]
- `fetch_pcr` payload 加 `series: [{date, pcr}]`(20 日;資料已在 pcr_history,零額外 fetch)。
- **「較昨日 增/減」資料來源(R3b 修)**:前端取 `series` 末兩點差計算;**不使用** payload 的 `day_change` 欄位(該欄位 `parse_institutional` 恆填 0、caller 從未回填 — 既有缺陷,入 Known Risks,本輪不修不擴散)。
- 皆為新增欄位,不動既有欄位 → 不 bump 舊 cache 也相容,但因 SC-1/2 已 bump v2,一併重算。

## 3. Frontend 四層(SC-6~10)

> **Phase 3 前端 wave 開工前必做**(user 指示 2026-07-07,二度重申):先呼叫 `frontend-design` + `bencium-controlled-ux-designer` 兩個 skill 取得視覺設計指引,再寫元件 code。

### 3.1 檔案組織

| 檔 | 動作 | 責任 |
|---|---|---|
| `lib/options-conclusion.ts` | NEW | 純函式:`buildConclusion(input): string[]`(句子陣列);落區三等分 / 越過(嚴格 >)/ 跌破(嚴格 <)/ 單側無牆 / spot 缺 → 省位置句;Max Pain 距現價句(\|x\|<0.05% →「幾乎重合」);零 React 依賴 |
| `lib/options-range-svg.tsx` | NEW(自 `options-svg.tsx::StrikeLadder` 演進) | RangeMap 純渲染:per-strike 雙向 bar(metric prop = "oi" \| "volume")、spot 列、牆標記(**props 傳入後端值,不自算**)、Max Pain ▼ 列;`maxOIStrike` 刪除。**顯示視窗(R12 修)**:spot 上下各 20 檔,牆 / Max Pain 落窗外則擴窗至包含,窗外檔位截尾不畫 `[auto-default: 固定檔數視窗+強制納牆 | reason: 渲染可預測;deep OTM OI>0 檔位可達百檔]`;**as_of 防禦(R10 修)**:`sv.as_of_date !== ow.as_of_date` 時隱藏牆標記 + 顯示「牆資料基準日不同」註記(後端 fallback 對齊後屬殘餘防線),vitest 鎖 mismatch case |
| `lib/options-svg.tsx` | Modify | 留 MiniBar / Sparkline(溫度計沿用);StrikeLadder + `maxOIStrike` 刪除。**測試遷移(R6 修)**:`options-svg.test.tsx` 內 StrikeLadder / maxOIStrike 相關測試(11 處引用)遷往 `options-range-svg.test.tsx` 或列入 Phase 2「該變 assertion」清單,不留孤兒紅測 |
| `components/OptionsConclusionBar.tsx` | NEW | 掛 DOM + 資料缺漏 fallback 文案「結論生成資料不足」 |
| `components/OptionsRangeMap.tsx` | NEW | section wrapper + OI/成交量 toggle(local state)+ loading/error |
| `components/OptionsThermometerRow.tsx` | NEW | 四格 config-driven(label / 主數字 / 判讀句 / Sparkline);外資格含期貨對照第二行;判讀句純函式同檔 export 供測試 |
| `components/OptionsAdvancedPanel.tsx` | NEW | 收合容器(`hidden` attribute);內容 = 既有四卡 + NET 對照表 + 說明文字 |
| `components/OptionsMaxPainCard.tsx` | Modify(SC-10) | 主數字旁「距現價 ±x.x%」(吃 spot prop);「賣方總賠付/履約價數/call-only」移 tooltip |
| `components/OptionsNetTable.tsx` | NEW | NET 四組對照表(當日 net + 20 日變化)+「特定法人 vs 全交易人」固定說明 |
| `components/OptionsChipPanel.tsx`、`OptionsLargeTradersStrip.tsx`、`OptionsStrikeLadder.tsx` | Delete | 職責移轉如 §0;測試檔隨遷 |
| `components/ui/tooltip.tsx` | NEW(若 ui/ 尚無) | Radix tooltip primitive,shadcn-ish 樣板;SC-10 四詞白話解釋用 |
| `hooks/useRetailMtx.ts`、`hooks/useForeignFutures.ts` | NEW | TanStack Query,回傳 `{data, loading, error, refresh, noTradingDay}` 標準 shape |
| `hooks/useOptionsChip.ts` | Modify | 聚合擴充 retail + foreignFut(refreshAll / anyNoTradingDay 同步納入) |
| `lib/options-types.ts` | Modify | `OIWallDynamic.window_net_increase_oi`、`band_width_pct: number \| null`、`OptionsOIWallsHitRate.dropped_no_close: number`(R13;AdvancedPanel hit rate 表顯示剔除數)、institutional/pcr `series`、兩個新 payload 型別 |
| `lib/options-api.ts` | Modify | `retailMtx()` / `foreignFutures()` |
| `components/OptionsPage.tsx` | Modify | §0 新結構組裝;spot 傳入 ConclusionBar / RangeMap / MaxPainCard |
| `lib/changelog.ts` | Modify(SC-11) | MINOR bump entry |

### 3.2 資料流

- 全 hook 併發、失敗隔離不變:結論列僅在 mp+ow+spot 齊備時生成完整句,缺哪段省哪句(§brainstorm edge 1/5);溫度計每格獨立 error fallback「—」。
- refresh:沿用 `refreshAll()` 逐 hook 呼叫(**不用** invalidateQueries cascade — finmind-conventions 明載 cascade 不帶 refresh=true)。
- **配色(R7 修,措辭警示)**:目標 = call=bear 綠 / put=bull 紅(CLAUDE.md §4)。**注意:演進基底 StrikeLadder 的現行配色是反轉遺留**(isCallWall → `--color-up` 紅、call volume bar 紅;OptionsOIWallsCard 的 F2 修已改對但 ladder 從未同步)— range-svg 演進時**必須翻轉**,不得沿用基底;以 data-testid 正向 assertion 先紅後綠鎖住。

### 3.3 邊界(對應 brainstorm edge cases)

| Edge | 行為 |
|---|---|
| 單側無價外 OI | 該牆 null → RangeMap 不畫、結論列「上方/下方無明顯 OI 牆」、band null 顯「—」 |
| spot == 牆 | 落區判定:突破/跌破用嚴格不等;等值算區間內邊緣 |
| PCR 資料不足 | 溫度計 PCR 格「資料不足」,不擋其他格 |
| MTX 法人缺資料 | retail_mtx payload warning + 前端格「—」 |
| spot 缺 | walls=null + `oi_walls_no_spot`;RangeMap 無 spot 列;結論列省位置句 |
| 無交易日 | 既有 banner;結論列句尾標「(N/N 資料)」不做 — 沿用 banner 即可 |

## 4. 測試 / E2E 對映(細節在 Phase 2 PLAN.md)

- pytest:SC-1/2/3 紅先行(既有 oi_walls 測試中「該變」assertion 事前標記清單列入 PLAN.md);SC-4/5 route + parser 測試(fixtures 由 probe 產出)。
- vitest:conclusion 純函式全分支、range-svg renderer、thermometer 判讀句、AdvancedPanel 收合、**禁方向性文案 assertion 擴至 ConclusionBar + ThermometerRow**。
- e2e:O1-O5 改寫對映新結構(O1→結論列+溫度計 visible、O3→RangeMap 牆 testid 非空…);L# 新 endpoint schema(`@live` 本機);V# baseline 重拍;FAKE_FINMIND 新 fixture + MANIFEST 同 commit;新 route 一律 `clock.today()`。

## 5. SC ↔ 設計章節對映

| SC | 章節 | SC | 章節 |
|---|---|---|---|
| SC-1 | §1.1 | SC-6 | §3.1 conclusion + §3.3 |
| SC-2 | §1.2 | SC-7 | §3.1 range-svg / RangeMap |
| SC-3 | §1.3 | SC-8 | §2.4 + §3.1 thermometer |
| SC-4 | §2.1-2.3 | SC-9 | §3.1 AdvancedPanel / NetTable |
| SC-5 | §2.1-2.3 | SC-10 | §3.1 MaxPainCard + tooltip |
| — | — | SC-11 | §3.1 changelog |

## Known Risks

- **KR-1(自 R3b)**:`parse_institutional` 的 `day_change` 欄位恆為 0(註解宣稱 caller 回填但從未發生)— 既有缺陷。本輪處置:前端一律不讀該欄位(判讀句改用 series 末兩點差);欄位本身留待獨立 cleanup(已記 `docs/next-time.md` 候選)。
- **KR-2(resolved 2026-07-07)**:MTX / TX 期貨法人 dataset 欄位已 probe 驗證(`probe-futures-2026-07-07.md`)— schema 與 options institutional 相同;附帶發現 MTX 總 OI 需 position session + 含週合約口徑(已修入 PLAN W2)。
