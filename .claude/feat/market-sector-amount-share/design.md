# Design — market-monitor-v2 P4 sector amount share

**Version**: v2
**Date**: 2026-07-02
**Pre-reading**: `brainstorm.md`(本 dir)/ `docs/specs/market-monitor-v2/spec.md §6.4, §8` /
`docs/specs/market-monitor-v2/plan.md Phase 4` / `.claude/feat/market-sector-breadth/design.md v2`(P3 樣板)/
`backend/services/sector_aggregation.py`(P3 現行)/ `backend/services/finmind_realtime.py`(整合點)

## Changelog

- **v2**(2026-07-02)— Phase 1 review round 1 accept 5 findings:F1 §6 補 T-E2/T-E3/T-E6 /
  F2 sector 缺席語意代價文件化(§8.9 + R4)/ F3 sparse sector window deviation 標註(§8.6)/
  F4 T37 補 taiex patch 註記 / F5 today_date 雙 extract 分歧文件化(§8.4 + Phase 6 檢查項)
- **v1**(2026-07-02)— initial design;P3 design v2 同構,只換公式。三個關鍵抉擇
  (extract 專職版 / universe 分母 / window 排除 today)已在 brainstorm §5 定案,本檔落實。

---

## 1. 架構總覽

在 `services/sector_aggregation.py` **同檔加**第三個 public 入口(不新開檔):

```
compute_sector_amount_share(end_date, universe, sector_map,
                            lookback_days=60, avg_window=20, refresh=False)
    -> list[SectorAmountResult]
```

內部拆兩段(對齊 P3 三兄弟結構):

```
compute_sector_amount_share
  ├─ (fetch)  _fetch_prices_window(start, end, refresh)   ← P3 既有薄殼,delegate P2
  │            (SAME cache_key `breadth_prices_<start>_<end>` → 冷啟動零額外 fetch)
  └─ (pure)   _aggregate_sector_amount_share(by_stock_amt, sector_map, avg_window, today_date=None)
       ├─ build sector → date → Σ Trading_money;同時 build total → date → Σ Trading_money
       ├─ today_date = max date across all stocks(F7 global 慣例)
       ├─ today_share[s] = sector_amt[s][today] / total_amt[today]
       ├─ share_delta[s] = today_share[s] − mean(past avg_window 有效日 daily_share[s],排除 today)
       └─ output sorted by today_share DESC, tie-break sector ASC
```

**設計原則**(全繼承 P3):
- 純 aggregation 函式獨立單測(fixture,不打 FinMind)
- Orchestrator 走「monkeypatch 本模組 `_fetch_prices_window`」測 flow
- SC-6 整合走 `finmind_realtime._do_fetch_market_snapshot` 追加第三個獨立 try/except,
  失敗 → None,**不動 stale**(F6 sequel)
- Cache 共用 P2 `breadth_prices_<start>_<end>` — P2/P3 兩 consumer 已攤還冷啟動(KG3 繼承)

## 2. 檔案組織

| 檔案 | 責任 | 動作 |
|---|---|---|
| `backend/services/sector_aggregation.py` | 加 `SectorAmountResult` TypedDict + `_extract_amount_by_stock` + `_aggregate_sector_amount_share` + `compute_sector_amount_share` | 🟢 同檔加 |
| `backend/tests/test_sector_aggregation.py` | 加 ≥ 8 unit test(SC-1~5)+ T37 cache_key lock | 🟢 同檔加 |
| `backend/services/finmind_realtime.py` | 加 `_fetch_sector_amount_share` helper + 第三個 try/except + payload 欄位 | 🔵 改(add-only)|
| `backend/tests/test_finmind_realtime.py` | 加 T-INT-1/2/3(SC-6)| 🔵 改(加 test)|

**不動**:
- `_extract_close_and_volume_by_stock` / `_aggregate_sector_breadth` / `_aggregate_sector_volume_ratio` /
  `compute_sector_breadth` / `compute_sector_volume_ratio` / `_fetch_prices_window` / `_derive_window`
  (P3 既有函式;`_fetch_prices_window` 與 `_derive_window` 為 P4 **reuse not modify**)
- `services/market_breadth.py`(P2)/ `services/market_universe.py`(P1)
- finmind_realtime 既有 P1/P2/P3 payload key 順序(`sector_amount_share` 附加在 `sector_volume_ratio` 之後)
- `_CACHE_VERSION_REALTIME` / `_CACHE_VERSION_BREADTH`(spec §4 明示不 bump)
- Frontend(P5)

## 3. 資料流

```
routes/market.py::get_snapshot → fetch_market_snapshot()
  └─ _do_fetch_market_snapshot
       ├─ (existing) universe / sector_map / mv / watch_list → allowed + primary_sector
       ├─ (existing P2) _fetch_breadth               → snapshot["breadth"]
       ├─ (existing P3) _fetch_sector_breadth        → snapshot["sector_breadth"]
       ├─ (existing P3) _fetch_sector_volume_ratio   → snapshot["sector_volume_ratio"]
       └─ NEW P4:      _fetch_sector_amount_share(end, allowed, primary_sector)
                         └─ sector_aggregation.compute_sector_amount_share(...)
                              └─ _fetch_prices_window(start, end)  ← REUSE 同一 cache_key
```

**Cache reuse 關鍵**:四個 compute(P2 breadth + P3 ×2 + P4 amount_share)呼叫同一
`_fetch_daily_prices_window(start, end)`,`start`/`end` 由同構 `_derive_window` 公式導出
→ 同一 `breadth_prices_<start>_<end>` key → 冷啟動只跑一次(`_run_once` inflight dedup + 24h cache)。
P4 直接呼叫 P3 既有 `_derive_window`(單一 source,不複製公式)。

**Trading_money 欄位可用性**(brainstorm §1 已驗):P2 `_do_fetch_prices` 寫 cache 為 raw FinMind rows
(`market_breadth.py:376`),`Trading_money` 天然在 cache 內,不需 bump cache version、不需重抓。
邊界情況:若使用者 disk 上有「P2 時代已寫入的舊 cache」,rows 同樣是 raw(P2 從未裁欄)→ 相容。

## 4. 邊界 / 接點

### 4.1 Public API — orchestrator

```python
class SectorAmountResult(TypedDict):
    sector: str
    today_share: float            # 0.0~1.0;today sector amt / today total amt
    share_delta_20ma: float | None  # None = 有效過去日 < avg_window(新上市 / 資料不足)


async def compute_sector_amount_share(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,   # 60,matches P2/P3 → shared cache_key
    avg_window: int = _AMOUNT_AVG_WINDOW,          # 20
    refresh: bool = False,
) -> list[SectorAmountResult]:
    """Aggregate per-sector today turnover share vs universe total + Δ vs past 20-day mean.

    Empty universe → raises ValueError("universe_empty").
    Empty prices from fetcher → returns [].
    Sorted by today_share DESC, tie-break sector name ASC.
    """
```

**行為**(全對齊 P3 orchestrator 慣例):
- `universe` 空 → `raise ValueError("universe_empty")`
- `sector_map` 空 → 所有股歸「其他」
- Fetcher fail(httpx.HTTPError)→ propagate(上層 try/except handle)
- `refresh=True` 一路傳到 fetcher
- window derivation:呼叫 P3 既有 `_derive_window(end_date, lookback_days)`(同一公式 → 同 cache_key)

### 4.2 純函式

```python
def _extract_amount_by_stock(
    prices: list[dict],
    universe: set[str],
) -> dict[str, dict[date, float]]:
    """從 daily price rows 建 stock_id → { date → turnover_value }。

    Rules(對齊 _extract_close_and_volume_by_stock 慣例):
    - stock_id 缺 or not in universe → skip row
    - date 缺 or 非 ISO → skip row
    - Trading_money 缺 or 非數值 → 0.0(保留 row;對齊 volume=0 慣例)
    - 同 (sid, date) duplicate → later value wins(F6-echo)
    - 注意:**不看 close 欄**(close 缺仍保留 — amount share 只需 turnover;
      與 close-extract 的 skip 條件刻意不同,設計上 amount 維度獨立)
    """


def _aggregate_sector_amount_share(
    by_stock: dict[str, dict[date, float]],
    sector_map: dict[str, str],
    avg_window: int = _AMOUNT_AVG_WINDOW,
    today_date: date | None = None,
) -> list[SectorAmountResult]:
    """Per-sector: today turnover share + Δ vs mean(past avg_window daily_share)。

    Rules:
    - by_stock 空 or 無 valid dates → return [](F3)
    - today_date default = max(all dates across all stocks)(F7 global)
    - sector = sector_map.get(sid, "其他")(E5)
    - Build 兩個 dict:
        sector_day_amt: dict[str, dict[date, float]]   # 只含實際有 row 的日
        total_day_amt:  dict[date, float]              # Σ across all stocks per day
    - today_total = total_day_amt.get(today_date, 0.0);
      sector_today = sector_day_amt[s].get(today_date, 0.0)
    - sector_today == 0 → 該 sector 缺席(對齊 P3 vol_ratio「今日無量 = 缺席」;
      today_total == 0 ⟹ 全 sector 缺席 → [],KG7 自然解)
    - today_share = sector_today / today_total
    - past window(E1/E3):
        past_days = [d for d in sector_day_amt[s] if d < today_date and total_day_amt[d] > 0]
        取 sorted DESC 前 avg_window 個;len < avg_window → share_delta = None
        else share_delta = today_share − mean(sector_day_amt[s][d] / total_day_amt[d] for d in 該批)
      (缺日不補 0 — sector 該日無 row 就不在自己的 day dict;total=0 的日 skip 不算有效日)
    - 排序:key = (-today_share, sector);today_share 恆非 None(缺席 sector 無 entry)
      → 不需 F1 None-safe key(share_delta 可 None 但非排序鍵)
    """
```

### 4.3 Fetcher / window — 全 reuse P3

- `_fetch_prices_window`:P3 既有薄殼,不動,直接呼叫
- `_derive_window`:P3 既有,不動,直接呼叫(T37 spy test lock P4 與 P2 窗口全等)

### 4.4 整合 — `services/finmind_realtime.py`(F6 sequel)

```python
async def _fetch_sector_amount_share(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
) -> list[dict] | None:
    """market-monitor-v2 P4 (SC-6) — delegate to sector_aggregation.compute_sector_amount_share.

    Empty universe → None (silent skip)。F6 sequel:exceptions propagate to
    caller's try/except httpx.HTTPError only(aggregation empty prices → [] 不 raise)。
    """
    if not universe:
        return None
    from services import sector_aggregation as sa

    return await sa.compute_sector_amount_share(end_date, universe, sector_map, refresh=refresh)
```

`_do_fetch_market_snapshot` 內,P3 sector_volume_ratio try/except **之後**追加第三個獨立 try/except
(只 catch `httpx.HTTPError`,同 P3 兩個),payload dict 在 `"sector_volume_ratio"` 之後加:

```python
    try:
        sector_amount_share = await _fetch_sector_amount_share(
            clock.today(), allowed, primary_sector, refresh=refresh
        )
    except httpx.HTTPError as exc:
        logger.warning("market snapshot: sector_amount_share compute failed: %s", exc)
        sector_amount_share = None
    ...
        "sector_volume_ratio": sector_volume_ratio,
        # market-monitor-v2 P4 (SC-6) — sector amount share (None if compute failed)
        "sector_amount_share": sector_amount_share,
    }
```

stale 契約不變:sector_amount_share fail 不動 stale(EOD data ≠ intraday degradation)。

獨立 try/except 而非 gather:P3 design §4.4 兩理由繼承(語意獨立 + test 覆蓋容易);
第三 call 共用 cache_key,serial 執行 near-zero cost。

Payload shape(spec §8):

```jsonc
{
  ... existing (P1/P2/P3) ...,
  "sector_amount_share": [
    { "sector": "半導體", "today_share": 0.412, "share_delta_20ma": 0.034 },
    { "sector": "電子零組件業", "today_share": 0.126, "share_delta_20ma": -0.011 },
    { "sector": "新上市集中族群", "today_share": 0.005, "share_delta_20ma": null }
  ] | null | []   // [] = empty prices;null = httpx fail or empty universe
}
```

## 5. SC-N 對應設計章節

| SC | 對應章節 | 對應函式 |
|---|---|---|
| SC-1 | §4.2 `_extract_amount_by_stock` | 該函式 |
| SC-2 | §4.2 `_aggregate_sector_amount_share`(today_share 段) | 該函式 |
| SC-3 | §4.2 `_aggregate_sector_amount_share`(past window 段) | 該函式 |
| SC-4 | §4.2 排序 rule | 該函式 sort key |
| SC-5 | §4.1 orchestrator + §4.3 reuse | `compute_sector_amount_share` + T37 |
| SC-6 | §4.4 finmind_realtime 整合 | `_fetch_sector_amount_share` |

## 6. Testability

- **純函式(SC-1~4)**:手算 fixture — 3 sectors × 2~3 stocks × 25 天;fixture 含
  duplicate row / 缺 Trading_money / 新上市股(5 天)/ 不在 sector_map 股
- **Edge case test lock(F1 review round 1)**:
  - **T-E2**:today 全 universe Trading_money=0 → assert `[]`(KG7 lock,無特殊分支,
    test 是唯一 regression 防線)
  - **T-E3**:fixture 塞一個過去日全 sector Trading_money=0(該日 total=0)→ assert
    該日不計入 past window,share_delta 用剩餘有效日算
  - **T-E6**:end_date 落週日、fixture 最新 row 是週五 → assert today_date 取 max date
    (F7,T-E9 style)
- **Orchestrator(SC-5)**:`monkeypatch.setattr(sa, "_fetch_prices_window", stub)`(patch 本模組符號)
- **T37 cache_key lock**:spy `market_breadth._fetch_daily_prices_window`,分跑
  `mb.compute_breadth` 與 `sa.compute_sector_amount_share`,assert (start, end) 全等
  (對齊 T36 慣例;CLAUDE.md §9「常數同值 + 公式同構兩者都要 lock」)。
  **(F4)同 T36,需同時 patch `market_breadth._fetch_taiex_series` 為 empty stub**
  (`mb.compute_breadth` 內部會抓 TAIEX 序列,不 patch 會打真實 fetch 路徑)
- **整合(SC-6)**:延用 P3 T-INT 樣板(`unittest.mock.patch` + `AsyncMock`,
  該檔既有慣例)— T-INT-1 happy / T-INT-2 fail 隔離 + stale lock / T-INT-3 empty universe

## 7. 安全 / 輸入驗證 / 權限

- 無 user input(universe / sector_map / end_date 皆 module 內部產出)
- 無 auth boundary;FinMind token 走既有 client;cache path 走 `chip_cache_dir()`,無注入面

## 8. 隱性假設

1. **FinMind `TaiwanStockPrice` row 有 `Trading_money` 欄(dollar 成交值)**:FinMind 官方 schema
   固定欄位;若某 row 缺 → 0.0(不 skip)。Phase 6 real-env 驗證實際欄位值非全 0
2. **P2 cache rows 為 raw 不裁欄**:`market_breadth.py:376` `all_rows.extend(rows)` 直寫;
   舊 cache 亦相容(P2 從未裁欄)→ 不需 cache version bump
3. **Trading_money 單位 = 元(TWD)**:share 為比值,單位消掉,不需換算
4. **today_date = max date across ALL prices(F7 global)**:個股該日無 row → 該股不貢獻
   today 分子分母;全繼承 P3 trade-off 文件化。**(F5 review round 1)P4 today_date 由
   amount-extract 導出,date 集合可能寬於 P3 close-extract(close 缺的 row P4 保留、P3 skip)
   → 同 payload 內 `sector_breadth` 與 `sector_amount_share` 的隱含 as-of 日理論上可分歧。
   FinMind EOD rows 實務上完整同出,視為理論邊界;Phase 6 real-env 順帶檢查兩 panel as-of 一致**
5. **分母 = filtered universe 總成交值**(brainstorm §5.2):不含 ETF/權證/處置股;
   前端文案不得寫「占大盤」絕對語意(P5 注意)
6. **past window 有效日定義**:該 sector 自己的 day dict 有該日 **且** total_day_amt[d] > 0;
   缺日不補 0(E1 新上市自然 → None,對齊 P3 vol_ratio)。**(F3 review round 1)此定義
   對 mature sector 與 spec §6.4 字面「past 20 trading days」等價(每個市場交易日都有 row);
   對 sparse sector 是刻意 deviation(mean 只在該 sector 有交易的日上取樣,window 實際回溯
   可遠於 20 個市場交易日)— 對齊 P3 vol_ratio 缺日不補 0 慣例,非 bug**
7. **float 精度**:turnover 為 TWD 大數(~1e12 級),float64 有效位數 15~16 位,誤差可忽略;
   share 不四捨五入,前端自理顯示精度
8. **`_extract_amount_by_stock` 額外一次 O(N) pass**:每 snapshot 3 次 extract(P3 2 次 + P4 1 次);
   accepted trade-off — 不動 P3 既有函式邊界 > 微性能(P3 §8.12 量測基準 ≈ 2-3s/pass post-cache-warm)
9. **(F2 review round 1)sector_today=0 缺席 ⟹ 流出訊號不呈現**:過去 20 日有量但今日
   全員停牌/無成交的 sector 會靜默消失,其強負 share_delta(資金流出訊號)不在表中 —
   accepted(對齊 SC-2 / P3 vol_ratio 慣例);**P5 前端文案不得暗示表格 = 全 sector 覆蓋**

## 9. Known Risks

- **R1(繼承 KG3)**:冷啟動 ~257s 首次 fetch;P2/P3 已攤還,P4 zero 額外
- **R2(繼承 P3 R5)**:window 公式耦合 P2 — T35(既有)+ T37(新)雙 lock
- **R3**:`Trading_money` 若 FinMind 某日整批缺 → 該日 total=0 → E3 skip;若 **today** 整批缺
  → `[]`(KG7);real-env 驗證關注
- **R4(繼承 P3 R2 + F2)**:「其他」sector 聚集 → dominate 排行;小 sector 全員停牌 →
  靜默缺席(流出訊號丟失);real-env 檢查兩者
