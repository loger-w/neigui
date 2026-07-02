# Implementation Spec — `backend/services/sector_aggregation.py`(P4 同檔加)

**Pre-reading**: `../design.md` v2 §4.1~§4.3

**動作**:同檔追加,**不動任何 P3 既有函式**。追加位置:constants 區加一常數、
TypedDict 區加一 class、§3.4 之後加 `_extract_amount_by_stock` + `_aggregate_sector_amount_share`、
檔尾加 `compute_sector_amount_share`。

## 1. Constants(追加一行)

```python
_AMOUNT_AVG_WINDOW = 20  # SC-3 default avg_window(P4;獨立於 _VOL_AVG_WINDOW,語意不同)
```

## 2. TypedDict(追加)

```python
class SectorAmountResult(TypedDict):
    sector: str
    today_share: float
    share_delta_20ma: float | None
```

## 3. Functions

### 3.1 `_extract_amount_by_stock(prices, universe)` — pure(SC-1)

```python
def _extract_amount_by_stock(
    prices: list[dict],
    universe: set[str],
) -> dict[str, dict[date, float]]:
    """Build stock_id → { date → turnover_value (TWD) }.

    P4 amount-dedicated extract — deliberately independent of close
    (row with missing close is kept; amount share only needs Trading_money).
    Same (sid, date) duplicate → later value wins (F6-echo).
    """
    out: dict[str, dict[date, float]] = {}
    for row in prices:
        sid = row.get("stock_id")
        if sid is None or sid not in universe:
            continue
        d_raw = row.get("date")
        if d_raw is None:
            continue
        try:
            d = date.fromisoformat(str(d_raw))
        except (ValueError, TypeError):
            continue
        amt_raw = row.get("Trading_money", 0)
        try:
            amt = float(amt_raw) if amt_raw is not None else 0.0
        except (ValueError, TypeError):
            amt = 0.0
        out.setdefault(sid, {})[d] = amt
    return out
```

- Failure tests(Phase 3 red,class `TestExtractAmountByStock`):
  - **A1** `test_A1_nested_dict_shape`:3 stocks × 3 dates → 正確 nested dict(float values)
  - **A2** `test_A2_stock_not_in_universe_dropped`
  - **A3** `test_A3_row_missing_date_or_sid_skipped`:缺 date / 缺 stock_id / 非 ISO date 三種 row 全 skip
  - **A4** `test_A4_duplicate_same_sid_date_later_wins`
  - **A5** `test_A5_missing_trading_money_zero_and_close_independent`:缺 `Trading_money` → 0.0
    保留;**row 無 `close` 欄仍保留**(對照:P3 close-extract 會 skip — 刻意不同)

### 3.2 `_aggregate_sector_amount_share(by_stock, sector_map, avg_window=20, today_date=None)` — pure(SC-2/3/4)

```python
def _aggregate_sector_amount_share(
    by_stock: dict[str, dict[date, float]],
    sector_map: dict[str, str],
    avg_window: int = _AMOUNT_AVG_WINDOW,
    today_date: date | None = None,
) -> list[SectorAmountResult]:
    """Per-sector: today turnover share of universe total + Δ vs mean(past N-day share).

    today total == 0 → all sectors absent → [] (KG7 natural).
    Past window: only days present in the sector's own day dict AND with
    universe total > 0 that day (design §8.6 — sparse-sector deviation documented).
    """
    if not by_stock:
        return []
    if today_date is None:
        dates = [d for per_date in by_stock.values() for d in per_date]
        if not dates:
            return []
        today_date = max(dates)

    # sector → date → Σamt;同 loop 建 total → date → Σamt
    sector_day_amt: dict[str, dict[date, float]] = {}
    total_day_amt: dict[date, float] = {}
    for sid, per_date in by_stock.items():
        sector = sector_map.get(sid, _OTHER_SECTOR)
        bucket = sector_day_amt.setdefault(sector, {})
        for d, amt in per_date.items():
            bucket[d] = bucket.get(d, 0.0) + amt
            total_day_amt[d] = total_day_amt.get(d, 0.0) + amt

    today_total = total_day_amt.get(today_date, 0.0)
    results: list[SectorAmountResult] = []
    for sector, day_amt in sector_day_amt.items():
        sector_today = day_amt.get(today_date, 0.0)
        if sector_today == 0:
            continue  # 缺席(含 today_total==0 ⟹ 全缺席 → [];KG7)
        today_share = sector_today / today_total  # sector_today>0 ⟹ today_total>0
        past_days = sorted(
            (d for d in day_amt if d < today_date and total_day_amt.get(d, 0.0) > 0),
            reverse=True,
        )[:avg_window]
        if len(past_days) < avg_window:
            share_delta: float | None = None
        else:
            past_shares = [day_amt[d] / total_day_amt[d] for d in past_days]
            share_delta = today_share - sum(past_shares) / len(past_shares)
        results.append(
            SectorAmountResult(
                sector=sector,
                today_share=today_share,
                share_delta_20ma=share_delta,
            )
        )
    # today_share DESC, tie-break sector ASC(today_share 恆非 None,不需 F1 None-safe key)
    results.sort(key=lambda r: (-r["today_share"], r["sector"]))
    return results
```

- Failure tests(Phase 3 red,class `TestAggregateSectorAmountShare`;
  hand-computable fixture 一律用小 `avg_window`(3)+ 連續 weekday dates):
  - **A6** `test_A6_today_share_hand_computed`:3 sectors 單日,amt 400/300/300 →
    share 0.4/0.3/0.3;Σ == `pytest.approx(1.0)`(IF2:個別 share 亦用 approx,
    浮點斷言慣例對齊 A11)
  - **A7** `test_A7_sector_today_zero_absent`:sector B 過去有量、today 無 row → B 缺席,
    A/C share 用不含 B 的 total 算
  - **A8** `test_A8_today_total_zero_returns_empty`:today 全 sector amt=0(row 在但值 0)→ `[]`
    (**T-E2 / KG7 lock**)
  - **A9** `test_A9_sector_map_fallback_other`:1 股不在 sector_map → 「其他」sector 出現且
    share 正確
  - **A10** `test_A10_empty_by_stock_returns_empty`:`{}` → `[]`
  - **A11** `test_A11_share_delta_positive_hand_computed`:avg_window=3,past 3 日 share 均 0.25,
    today_share 0.4 → delta = +0.15(浮點 `pytest.approx`)
  - **A12** `test_A12_share_delta_negative`:today_share 0.1 vs past mean 0.25 → delta = −0.15
  - **A13** `test_A13_new_sector_insufficient_history_delta_none`:sector 只有 2 個過去日
    (avg_window=3)→ today_share 正常、share_delta None(**E1**)
  - **A14** `test_A14_past_day_total_zero_skipped`:avg_window=3,4 個過去日中 1 日全 universe
    amt=0 → 該日 skip,delta 用其餘 3 日算(**T-E3**);對照組:僅 3 個過去日中 1 日 total=0
    → 有效 2 日 < 3 → None。**(IF1)fixture 兩個強制約束**:
    1) zero-total 日必須「row 在但 Trading_money=0」(不得用缺 row 建構 — 缺 row 該日不在
       sector day dict,兩種實作不可區分);
    2) zero 日必須落在**最近 avg_window 個過去日內**(4 日 d1<d2<d3<d4 時放 d3 或 d4;
       若放最舊 d1,漏 `total>0` filter 的 buggy 實作會被 `[:avg_window]` 切片僥倖救掉,
       test 失去鑑別力;正確佈局下 buggy 實作踩 0/0 ZeroDivisionError 立紅)
  - **A15** `test_A15_window_excludes_today`:fixture 設計成「若誤把 today 納入 mean 則 delta
    明顯不同」→ lock 排除 today(brainstorm 抉擇 3)
  - **A16** `test_A16_sort_today_share_desc`
  - **A17** `test_A17_sort_tie_break_sector_asc`:兩 sector share 相同 → 名稱 ASC

### 3.3 `compute_sector_amount_share(...)` — orchestrator(SC-5)

```python
async def compute_sector_amount_share(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    avg_window: int = _AMOUNT_AVG_WINDOW,
    refresh: bool = False,
) -> list[SectorAmountResult]:
    """Aggregate per-sector today turnover share + Δ vs past N-day mean share.

    Empty universe → raises ValueError("universe_empty").
    Empty prices from fetcher → returns [].
    Sorted by today_share DESC, tie-break sector name ASC.
    Window derivation reuses P3 _derive_window → SAME cache_key as P2/P3 (KG3).
    """
    if not universe:
        raise ValueError("universe_empty")
    start, end = _derive_window(end_date, lookback_days)
    prices = await _fetch_prices_window(start, end, refresh=refresh)
    by_stock = _extract_amount_by_stock(prices, universe)
    return _aggregate_sector_amount_share(by_stock, sector_map, avg_window=avg_window)
```

- Failure tests(Phase 3 red,class `TestComputeSectorAmountShareOrchestrator`):
  - **A18** `test_A18_orchestrator_shape`:monkeypatch `sa._fetch_prices_window` → fixture rows
    → list[SectorAmountResult] shape + sorted
  - **A19** `test_A19_empty_universe_raises`:`ValueError("universe_empty")`
  - **A20** `test_A20_empty_prices_returns_empty`:stub 回 `[]` → `[]`
  - **A21** `test_A21_httpx_error_propagates`:stub raise `httpx.HTTPError` → propagate
  - **A22** `test_A22_refresh_forwarded`:stub 記錄 kwargs → `refresh=True` 傳達
  - **A23** `test_A23_end_date_on_weekend_uses_max_date`:end_date=2026-06-28(Sun)、
    fixture 最新 row 2026-06-26(Fri)→ today_date 用 Fri(**T-E6**,T-E9 style)

### 3.4 Cache_key lock(SC-5;加進既有 `TestConstantsLock` class,**不動 T35/T36**)

- **T37** `test_T37_p4_amount_share_shares_fetch_window`:
  spy `market_breadth._fetch_daily_prices_window` + **同時 patch
  `market_breadth._fetch_taiex_series` 為 empty stub**(F4;`mb.compute_breadth` 內部會抓
  TAIEX),分跑 `mb.compute_breadth(end, universe)` 與
  `sa.compute_sector_amount_share(end, universe, sector_map)`,assert 兩次呼叫
  `(start, end)` 完全相同(pattern 照抄 T36,只換第二個 orchestrator)

### 3.5 Phase 4 review 追加(code-review-round-1)

- **A24** `test_A24_past_window_takes_most_recent_days`(TS-1,SC-3):
  avg_window=2,past 3 日 share = MON 0.10 / TUE 0.25 / WED 0.25,today 0.40 →
  correct(recent WED,TUE)delta = 0.15;oldest-N mutation(MON,TUE)→ 0.225。
  assert `pytest.approx(0.15)`
- **A25** `test_A25_past_day_sector_zero_but_total_positive_counts`(TS-3,SC-3):
  2330: {MON 250, TUE 0, WED 250, THU 400},2317: {MON 750, TUE 1000, WED 750, THU 600},
  avg_window=3 → TUE 是 valid share-0.0 日 → delta = 0.4 − mean(0.25, 0.0, 0.25) = 0.4 − 1/6。
  過濾過寬 mutation(past filter 加 day_amt>0)→ 只剩 2 valid 日 → None → 立紅
- **A26** `test_A26_negative_trading_money_treated_as_corrupt_zero`(CORR-1 fix a,SC-1):
  row Trading_money = -500.0 → extractor 視同 corrupt → 0.0(對齊 E4 非數值慣例)。
  紅先行:現行 extractor 直通負值 → 紅 → clamp 後綠

`_extract_amount_by_stock` 行為修訂(CORR-1):`amt < 0 → 0.0`(負 turnover 不存在於
domain,視同 corrupt data;保護 today_total=0 但 sector_today>0 的 ZeroDivisionError 洞)

## 4. SC-N ↔ test coverage matrix

| SC | tests |
|---|---|
| SC-1 | A1~A5 |
| SC-2 | A6~A10 |
| SC-3 | A11~A15 |
| SC-4 | A16~A17 |
| SC-5 | A18~A23 + T37 |
| SC-6 | see `finmind_realtime_integration.md` |

Total:24 unit tests(+3 integration 另檔)

## 5. Known Risks

- **R1(繼承 P3 R5/R2)**:window 公式耦合 P2 — T35(既有)+ T37(新)雙 lock
- **R2**:`_extract_amount_by_stock` 第 3 次 O(N) pass — accepted per design §8.8
