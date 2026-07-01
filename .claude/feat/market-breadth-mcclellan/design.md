# Design — market-monitor-v2 P2 McClellan Oscillator + AD Line

**Version**: v3
**Date**: 2026-07-01
**Pre-reading**: `brainstorm.md`(本 dir)/ `docs/specs/market-monitor-v2/spec.md §6.3, §8` / `docs/specs/market-monitor-v2/plan.md Phase 2`

## Changelog

- **v3**(2026-07-01)— Phase 6 real-env finding accepted:§8.1 假設打紅 —
  FinMind `TaiwanStockPrice` **without data_id** 只回 `start_date` 那一天(non
  date-range semantic)。fetcher `_do_fetch_prices` 改 per-trading-day loop
  透過 `services.trading_calendar.get_trading_days`。冷啟動成本 ~257s
  (100+ trading days × sponsor 5-15/s),24h cache 攤還後續 request 到 ~11s
  → 標 known gap **KG3**(V2.5 考慮 warmer job / 縮 lookback / 換 dataset)。
- **v2**(2026-07-01)— Phase 1 review round 1 accept 7 findings:F1 refresh 契約 / F2 fetch window derivation / F3 _run_once inflight dedup / F4 divergence window=20 記錄 StockCharts 慣例 / F5 明訂 sparse-row 處理 / F6 stale flag 不動 / F7 cache helper trio 展開
- **v1**(2026-07-01)— initial

---

## 1. 架構總覽

新增 backend service `services/market_breadth.py`,單一 public 入口 `compute_breadth(end_date, universe, lookback_days=60, refresh=False) -> BreadthResult`。內部分三段:

```
compute_breadth
  ├─ (fetch)  _fetch_daily_prices_window(start, end, refresh)  → list[dict{stock_id, date, close}]
  ├─ (fetch)  _fetch_taiex_series(start, end, refresh)          → list[dict{date, close}]
  └─ (pure)   _build_result(prices, taiex, lookback_days)      → BreadthResult
       ├─ _count_daily_ups_downs(prices, universe)   → list[(date, up, down)]
       ├─ compute_ad_line(counts)          → list[dict{date, value}]
       ├─ compute_rana(counts)             → list[dict{date, value}]
       ├─ compute_mcclellan(rana)          → list[dict{date, value}]
       └─ _detect_signals(mcclellan_series, taiex_series)
            → thrust_dot / centerline_cross / divergence_dot
```

**設計原則**:
- Fetcher 和 compute 分離 → compute 純函式獨立測(SC-1/2/3 全走 fixtures,不打 FinMind)
- SC-4 走「注入 fetcher stub」測 orchestrator flow
- SC-6 整合走 `services/finmind_realtime._do_fetch_market_snapshot` 追加一個 `_fetch_breadth()` 呼叫,`return_exceptions=True` 讓 breadth fail 不阻塞 snapshot 但 **不動** `stale` flag(見 §4.4)

## 2. 檔案組織

| 檔案 | 責任 | 動作 |
|---|---|---|
| `backend/services/market_breadth.py` | compute_breadth + 純函式 + fetcher + BreadthResult TypedDict + cache helpers | 🟢 新 |
| `backend/tests/test_market_breadth.py` | ≥ 8 unit test 覆蓋 SC-1~5 | 🟢 新 |
| `backend/services/finmind_realtime.py` | 追加 `_fetch_breadth()` + snapshot payload 加 `breadth` 欄位 | 🔵 改(小) |
| `backend/tests/test_finmind_realtime.py`(既有) | 加 1 個 integration test 驗 SC-6 | 🔵 改(加 test) |

**不動**:
- `services/market_universe.py`(P1,injection 讀取而不改)
- Frontend(spec.md Phase 5 才動)
- `_CACHE_VERSION_REALTIME`(spec §4 明示 P2 不 bump;`market_breadth` 用獨立 `_CACHE_VERSION_BREADTH = 1`)

## 3. 資料流

```
┌───────────────────────────────────────────────────────────────┐
│  routes/market.py::get_snapshot  →  fetch_market_snapshot()    │
└────────────────────────────────┬──────────────────────────────┘
                                 │ (existing) reuses:
                                 ├─ _fetch_universe / _fetch_sector_map / _fetch_market_value_map / _fetch_watch_list
                                 │ (produces `allowed` set after filter_universe)
                                 │
                                 └─→ NEW: _fetch_breadth(end_date=clock.today(), universe=allowed, refresh=refresh)
                                          │
                                          └─ market_breadth.compute_breadth(...)
                                             │
                                             ├─ _fetch_daily_prices_window
                                             │   window: start = end - trading_day_pad(lookback_days + 39)
                                             │           (derived, 見 §4.3 F2 fix — 保證 slow EMA warm-up 過後仍有 lookback_days 個有效點)
                                             │   TaiwanStockPrice without data_id → 全市場 date-range payload
                                             │   cache: 24h by end_date (chip_cache_dir/breadth_prices_<end>.json)
                                             │   dedup: _run_once("breadth_prices_" + end + "_r" + int(refresh))
                                             │
                                             ├─ _fetch_taiex_series
                                             │   TaiwanStockPrice data_id='TAIEX' → 空/error → try '0001' → 空/error → return []
                                             │   cache: 24h (chip_cache_dir/breadth_taiex_<end>.json)
                                             │   dedup: _run_once("breadth_taiex_" + end + "_r" + int(refresh))
                                             │
                                             └─ _build_result → BreadthResult TypedDict
                                                └─ 加進 snapshot["breadth"](append-only,append-only,不動 stale)
```

## 4. 邊界 / 接點

### 4.1 Public API — `compute_breadth`

```python
class BreadthResult(TypedDict):
    ad_line_value: float                     # 累計 AD Line 最新值(warm-up 完成後,否則取最後有值點)
    mcclellan_oscillator: float | None       # 最新 McClellan 值(warm-up 不足 → None)
    ad_line_series: list[dict]               # [{"date": "YYYY-MM-DD", "value": float}, ...]
    mcclellan_series: list[dict]             # 同上;warm-up 期(< 39 天)value=None
    thrust_dot: str | None                   # "above_plus_100" | "below_minus_100" | None
    centerline_cross: str | None             # "above" | "below" | None(最後一日方向)
    divergence_dot: str | None               # "bullish" | "bearish" | None
    known_gaps: list[str]                    # ["taiex_unavailable"] etc; 空 list 表無 gap

async def compute_breadth(
    end_date: date,                # F1 fix: date not str, align with clock.today()
    universe: set[str],
    lookback_days: int = 60,
    refresh: bool = False,          # F1 fix: refresh contract 對齊 CLAUDE.md §4
) -> BreadthResult
```

**行為**:
- `universe` 為空 → `raise ValueError("universe_empty")`
- Fetcher fail(httpx.HTTPError,daily prices 端)→ **propagate**(對齊 CLAUDE.md §F 不 swallow),上層 `_do_fetch_market_snapshot` 走 `return_exceptions=True` graceful fallback
- TAIEX fetch 特殊:兩個 stock_id 都試過失敗 → 回 empty series,`divergence_dot=None`,`known_gaps` 加 `"taiex_unavailable"`(不阻塞 breadth 主體回傳)
- `refresh=True` 一路傳到 fetcher,跳 cache 重抓(F1 fix)

### 4.2 純函式(module-level, testable in isolation)

```python
def _count_daily_ups_downs(
    prices: list[dict],
    universe: set[str],
) -> list[tuple[date, int, int]]:
    """從 daily price rows 算每日 (up, down) 家數。

    F5 fix — E2/E4 明訂處理:
    - Iterate FinMind 實際回傳的 (stock_id, date) pair;missing row 不 fill(每日
      分母 = 該日實際有 close vs prev_close 兩天資料的股票數)
    - stock_id not in universe → skip
    - 該股該日 close > prev_close → up++;close < prev_close → down++;== → flat 不計
      (spec §6.3 RANA 慣例:advances vs declines,unchanged 排除)
    - 新上市股某日無 prev_close → 該股該日 skip(不當 flat 也不當 up/down)
    - 連假 sparse → 日期軸 = 實際回傳 date 的 union(不填 NaN 空日)
    - 回傳按 date 遞增排序
    """


def compute_ad_line(counts: list[tuple[date, int, int]]) -> list[dict]:
    """counts = [(date, up, down)] → [{"date", "value"}], 累加 (up - down)"""


def compute_rana(counts: list[tuple[date, int, int]]) -> list[dict]:
    """RANA[t] = (up-down)/(up+down); 分母 0(E6)→ 0.0"""


def compute_mcclellan(
    rana_series: list[dict],
    fast: int = 19,
    slow: int = 39,
) -> list[dict]:
    """McClellan = fast-EMA(RANA) - slow-EMA(RANA)
    warm-up:前 slow-1 (38) 點 value=None;第 slow 點起 seed = 前 slow 點 SMA。
    """


def detect_thrust_dot(
    mcclellan_series: list[dict],
    threshold: float = 100.0,
) -> str | None:
    """最後一日 mcc > +threshold → 'above_plus_100'; < -threshold → 'below_minus_100'; 否則 None
    最後一日 value=None(warm-up)→ None"""


def detect_centerline_cross(mcclellan_series: list[dict]) -> str | None:
    """最後兩日 sign 換:負 → 正 return 'above';正 → 負 return 'below';同號或 None-value 回 None"""


def detect_divergence(
    mcclellan_series: list[dict],
    taiex_series: list[dict],
    window: int = 20,           # F4 fix: 記錄 StockCharts 慣例(見 §8.4)
) -> str | None:
    """近 window 天內:
    - TAIEX close 於窗內達新高 (max) 且 對應 mcc 未同步新高 → 'bearish'
    - TAIEX close 於窗內達新低 (min) 且 對應 mcc 未同步新低 → 'bullish'
    - 否則 None
    TAIEX 空 → None
    """
```

**EMA 算法**:標準 α = 2/(N+1),初始值取前 N 天算術平均(seed)。

### 4.3 Fetcher(async)

```python
async def _fetch_daily_prices_window(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """FinMind TaiwanStockPrice without data_id → 全市場 date-range payload。
    cache: 24h at chip_cache_dir/breadth_prices_<end.isoformat()>.json;
    schema: [{stock_id, date, close, ...}]。
    F3 fix: 內用 _run_once dedup key = 'breadth_prices_' + end.iso + '_r' + int(refresh)"""


async def _fetch_taiex_series(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """試 stock_id='TAIEX' → 空/httpx.HTTPError → 試 '0001' → 空/error → return [].
    cache: 24h at chip_cache_dir/breadth_taiex_<end.iso>.json。
    F3 fix: _run_once dedup key = 'breadth_taiex_' + end.iso + '_r' + int(refresh)"""
```

**window derivation(F2 fix)**:
`start` 由 `lookback_days` 反推,`start = end - timedelta(days=int((lookback_days + slow_ema_period) * 1.5))`(1.5 因子涵蓋週末/連假,slow_ema_period=39)。預設 `lookback_days=60` → 抓 `(60+39)*1.5 ≈ 148 天` 曆日,約 100+ trading day,保證 slow EMA warm-up 過後仍有 ≥ 60 個 valid mcclellan 點。

**get_finmind indirection(F3 + P1 pattern)**:對齊 P1 pattern,module 內 `def get_finmind(): from services.finmind import get_finmind as _real; return _real()`,test 可 `monkeypatch.setattr(mb, "get_finmind", ...)` 獨立 swap。

### 4.3.5 Cache helper trio(F7 fix,mirror `services/market_universe.py`)

```python
_CACHE_VERSION_BREADTH = 1
_BREADTH_TTL_HOURS = 24  # EOD daily → hours scale,對齊 market_universe 慣例
_inflight: dict[str, asyncio.Task] = {}


def _cache_path(key: str) -> Path:
    return chip_cache_dir() / f"{key}.json"


def _read_cache(key: str) -> dict | None:
    p = _cache_path(key)
    if not p.exists():
        return None
    data = read_json(p, default=None)
    if data is None or data.get("_cache_version") != _CACHE_VERSION_BREADTH:
        return None
    data.pop("_cache_version", None)
    return data


def _write_cache(key: str, payload: dict) -> None:
    cached = {**payload, "_cache_version": _CACHE_VERSION_BREADTH}
    atomic_write_json(_cache_path(key), cached)


def _is_fresh(cached: dict, ttl_hours: float) -> bool:
    fetched_at = cached.get("fetched_at", "")
    if not fetched_at:
        return False
    try:
        dt = datetime.fromisoformat(fetched_at)
    except ValueError:
        return False
    return datetime.now() - dt < timedelta(hours=ttl_hours)


async def _run_once(key: str, coro_fn):
    if key in _inflight:
        return await _inflight[key]
    _inflight[key] = asyncio.ensure_future(coro_fn())
    try:
        return await _inflight[key]
    finally:
        _inflight.pop(key, None)
```

### 4.4 整合 — `services/finmind_realtime.py`(F6 fix — 不動 stale)

新增 module-local helper:

```python
async def _fetch_breadth(
    end_date: date,
    universe: set[str],
    refresh: bool = False,
) -> dict | None:
    """Delegate to market_breadth.compute_breadth; return None on empty universe。
    傳 refresh 進 compute_breadth 的 fetcher(F1)。"""
    if not universe:
        return None
    from services import market_breadth as mb  # 延 import 避 potential circular
    return await mb.compute_breadth(end_date, universe, refresh=refresh)
```

在 `_do_fetch_market_snapshot` 內,`allowed` 產出後追加(**單一 gather 不新增 barrier,不動 stale**):

```python
try:
    breadth = await _fetch_breadth(clock.today(), allowed, refresh=refresh)
except (httpx.HTTPError, ValueError) as exc:
    # F6: breadth fail 是 EOD data 補不到,不算 intraday degradation
    #     stale 保留給 (universe / sector_map / watch_list) 三個 intraday 訊號
    logger.warning("market snapshot: breadth compute failed: %s", exc)
    breadth = None

# stale 不受 breadth 影響(F6 fix)
# stale = isinstance(universe_res, BaseException) or sector_degraded or watch_degraded

return { ... existing ..., "breadth": breadth }
```

Payload shape:

```jsonc
{
  // ... existing (P1) ...
  "breadth": {
    "ad_line_value": 12345,
    "mcclellan_oscillator": -42.3,
    "ad_line_series": [...],
    "mcclellan_series": [...],
    "thrust_dot": null,
    "centerline_cross": null,
    "divergence_dot": null,
    "known_gaps": []
  } | null
}
```

## 5. SC-N 對應設計章節

| SC | 對應章節 | 對應純函式 |
|---|---|---|
| SC-1 | §4.2 `compute_ad_line` | `compute_ad_line` |
| SC-2 | §4.2 `compute_rana` + `compute_mcclellan` | 兩者 + EMA |
| SC-3 | §4.2 `detect_thrust_dot` + `detect_centerline_cross` + `detect_divergence` | 三個偵測函式 |
| SC-4 | §4.1 `compute_breadth` orchestrator + §4.3 fetcher inject | `compute_breadth`(整合) |
| SC-5 | §4.1 empty universe / §4.3 TAIEX fetch fail | `compute_breadth` + `_fetch_taiex_series` fallback |
| SC-6 | §4.4 finmind_realtime 整合 | `_fetch_breadth` + payload assemble(不動 stale) |

## 6. Testability

- **純函式(SC-1/2/3)**:直接餵手算 fixture,不打 FinMind。手算 fixture 舉例:5 天 [(up=100,down=50), ...] → 手算 AD Line 累加序列 → 對照。
- **_count_daily_ups_downs(F5)**:fixture 包含新上市股(某日無 prev_close)/ flat 收盤(close==prev_close)/ 連假 sparse 三種 pattern。
- **Orchestrator(SC-4)**:`monkeypatch.setattr(mb, "_fetch_daily_prices_window", async_stub)` + `_fetch_taiex_series` 同法,注入 fixture 資料。
- **Edge(SC-5)**:兩個獨立 test — universe 空 raise / TAIEX fetch raise 但 breadth 主體回。
- **整合(SC-6)**:延用 P1 `test_finmind_realtime` 樣板,`monkeypatch` `_fetch_breadth` 為 stub,assert payload 有 breadth 欄位 + 舊 4 panel 完整 + **stale 不被 breadth fail 拉紅**(F6)。

## 7. 安全 / 輸入驗證 / 權限

- 無 user input(universe 是 module 內部產出)
- 無 auth boundary
- FinMind token 走既有 `FinMindClient`,不新增外部依賴

## 8. 隱性假設

1. **[v3 amend — Phase 6 finding]** ~~FinMind `TaiwanStockPrice` without data_id 可回全市場 date-range~~ — **打紅**。實測 (evidence/SC-6_snapshot-happy.json):不加 `data_id` 時 FinMind 只回 `start_date` 那一天全 universe,忽略 `end_date`。**新策略**:`_do_fetch_prices` 用 `services.trading_calendar.get_trading_days` 拿 window 內 trading days,per-day loop 每天一 call。100 trading days × 15/s ≈ 冷啟動 ~7s + 額外 Python overhead → 實測 ~257s(sponsor rate 更保守),24h cache 攤還到 ~11s。標 known gap **KG3**
2. **TAIEX stock_id**:先試 `TAIEX` 後試 `0001`,兩者皆失敗記 known_gap;不 crash
3. **EMA 起算**:前 slow-1 (38) 點 mcclellan 值 = None;`mcclellan_oscillator` public 欄位在 warm-up 期也 None
4. **Divergence window = 20 天**(F4 選擇 (b) 記錄 StockCharts convention):20-day 是 StockCharts ChartSchool McClellan divergence 分析常見 lookback,對應 ~1 month trading 窗口。brainstorm E7 「最後 3 個新高互比」是過度精細,20-day rolling max 更 robust。若 P6 real-env 顯示訊號偏噪 → V2.5 抽 `window` 參數
5. **fetch window pad(F2)**:`(lookback_days + slow) * 1.5` 曆日 → 涵蓋週末/連假後保證 ≥ lookback_days 個 valid trading day + slow EMA warm-up
6. **_count_daily_ups_downs unchanged 處理(F5)**:close == prev_close → **不計 up 也不計 down**(spec §6.3 隱含 advances/declines 定義;若打紅改成 up++)

## 9. Known Risks

- **R1**:全市場 date-range payload 可能 > 100k row(1000 stock × 100 trading day)— httpx timeout 30s 可能不夠 → 若打紅在 fetcher 層加 pagination(by 30-day chunk)
- **R2**:McClellan ±100 thrust 台股閾值 known gap G1,標 spec §9 交由 V2.5 backtest 校準
- **R3**:Divergence window=20 沒 real-env 校準 — P6 若訊號密度太高/低,V2.5 抽參數

## 10. 反身性 self-audit

1. **McClellan 台股閾值不準**:brainstorm G1 已標 known gap,not P2 blocker,不做偷偷校準
2. **Divergence 演算法**:F4 accept 選 (b),brainstorm E7 修正為 StockCharts convention。這是理性 pushback:E7 「最後 3 個新高互比」我原本自己列,review 挑出 silent divergence,採用 StockCharts 慣例避免過度精細
3. **P2 只 backend**:frontend UI(spec §7 layout)留 Phase 5;P2 完成後 payload shape 就 locked,frontend 可 parallel start
4. **Stale flag**(F6 fix)是 P1 三輪 review 打磨的載重規則,P2 不能因為順手就 flip;breadth 是 EOD data 補不到 ≠ intraday tick 停滯
