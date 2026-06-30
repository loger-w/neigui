# Design — E2E Testing Framework (v3)

**Slug**: `e2e-tests` | **Scope**: L | **SC**: 11

> v3 對應 design-review-round-2.json 全 14 條 accepted。Changelog 在尾。

---

## 1. Architecture (v3)

加 Playwright 作為 frontend E2E framework,**獨立 `e2e/` 目錄**。後端假料機制走 **四層**:
1. `services/finmind.py::FinMindClient._get(url, params)` 被 `FakeFinMindClient`(**繼承 FinMindClient**)override,讀 fixture by (dataset, data_id, dates);
2. `services/finmind.py::FinMindClient.__init__` 在 `FAKE_FINMIND=1` 時 skip httpx 建構 + skip token check + `_limiter=NoOpBucket()`,讓 `FakeFinMindClient.__init__` 走 `super().__init__()` 無痛繼承;
3. `services/trading_calendar.py::_fetch_raw_dates_from_finmind` 自己開 httpx,env-gate 讀 `TaiwanFuturesDaily_TX_calendar.json`(reuse `_get` fixture);
4. `routes/symbols.py::load_symbols` 同樣 env-gate 讀 `TaiwanStockInfo.json`。

**Backend clock indirection**(R2-P0-3 + R3-P1-CLOCK-ROUTES):新增 `services/clock.py::today() / now()`,**20 處** `date.today()` swap 過去:`services/finmind.py` ×15、`services/finmind_realtime.py` ×1、`services/trading_calendar.py` ×1、**`routes/chip.py` ×1、`routes/options.py` ×2**(後三處是 R3-P1-CLOCK-ROUTES timebomb 修正,`routes/options.py:24` 走 `list_active_contracts(today)`,過 2026-07-15 TXO 結算後 `TXO202607` 會脫離 active list)。`FAKE_FINMIND=1` 時 `today()` 讀 env `FAKE_TODAY`(預設 `2026-06-26`,週五)。Playwright `page.clock` 同步凍 browser 到同一時間。

`FAKE_FINMIND` 嚴格值:`"1"` = fake;`"0"` 或未設 = real;其他值 lifespan startup raise(R2-P2-1 改成 lifespan 前置 fail-loud,而非 lazy `get_finmind()`)。新 endpoint `GET /api/_meta/mode` 回 `{fake, fixtures_dir, fake_today}`;Playwright globalSetup probe 之。

Backend 另起 `backend/tests_e2e/` pytest 子集,ASGI in-process client,**autouse 設 `CHIP_DATA_DIR=tmp_path`**(R2-P0-4 防真假料 cache 互染)。CI Linux 跑全套;visual baseline 走 Playwright 預設 colocated path,**不裝 LFS**;首次 baseline 由獨立 workflow_dispatch workflow 生成 PR(R2-P1-3)。

---

## 2. File Structure

### 新增

```
backend/
├── services/
│   ├── clock.py                          # R2-P0-3 today()/now() indirection
│   └── finmind_fake.py                   # R2-P0-1 繼承 FinMindClient + R2-P0-2 preload+slice
└── tests_e2e/
    ├── __init__.py
    ├── conftest.py                       # autouse FAKE_FINMIND=1 + FAKE_TODAY + CHIP_DATA_DIR=tmp
    ├── fixtures/                         # 預錄 FinMind JSON(by lowest-level cache key)
    │   ├── README.md                     # rotation 每季 + release 前;owner = maintainer
    │   ├── MANIFEST.json                 # R3-P0-PARSE fix:explicit {filename: {dataset, data_id}} map(no heuristic)
    │   ├── TaiwanStockInfo.json
    │   ├── TaiwanFuturesDaily_TX_calendar.json    # R2-P1-1:trading_calendar gate 讀此 + _get TX 路徑同時 reuse
    │   ├── TaiwanStockPrice_2330_2026-01-01_2026-06-26.json
    │   ├── TaiwanStockInstitutionalInvestorsBuySellWide_2330_2026-06-26.json
    │   ├── TaiwanStockMarginPurchaseShortSale_2330_2026-06-26.json
    │   ├── TaiwanStockKBar_2330_2026-06-26.json
    │   ├── taiwan_stock_trading_daily_report_2330_2026-06-12_2026-06-26.json   # 10-day window file(in-mem slice 來源)
    │   ├── taiwan_stock_trading_daily_report_secid_agg_2330_BROKER001_2026-06-26.json
    │   ├── TaiwanStockMarketValue_2026-06-26.json
    │   ├── taiwan_stock_tick_snapshot_2026-06-26.json
    │   ├── TaiwanOptionDaily_TXO_2026-04-01_2026-06-26.json     # 88-day window file
    │   ├── TaiwanOptionOpenInterestLargeTraders_TXO_2026-05-26_2026-06-26.json
    │   ├── TaiwanFuturesDaily_TX_2026-06-26.json                # tx_close / spot
    │   ├── TaiwanOptionFinalSettlementPrice_TXO.json
    │   ├── TaiwanOptionInstitutionalInvestors_TXO_2026-06-26.json
    │   └── TaiwanOptionInstitutionalInvestorsAfterHours_TXO_2026-06-26.json
    │   # R2-P1-4:empty_no_trading_day.json 不需要 — _get fallback `return []` 即無交易日
    ├── test_api_chip.py
    ├── test_api_options.py
    ├── test_api_market.py                # SC-7 single /api/market/snapshot
    ├── test_api_symbols.py
    ├── test_api_meta_mode.py
    ├── test_api_error_shape.py
    ├── test_api_gzip.py
    └── test_api_no_trading_day.py        # 鎖 2026-06-27 (Sat) — options-only

e2e/
├── playwright.config.ts                  # FAKE_FINMIND=1 + FAKE_TODAY=2026-06-26 + CHIP_DATA_DIR=./e2e/.cache
├── playwright.live.config.ts
├── .cache/                               # gitignored,fake-mode 寫到這裡
├── tsconfig.json
├── package.json
├── README.md                             # Python 3.12 venv + visual baseline bootstrap 章節
├── helpers/
│   ├── global-setup.ts                   # probe /api/_meta/mode + live-guard.assertLiveCapBeforeAll()
│   ├── start-server.ts
│   ├── clock.ts                          # installFixtureClock + 凍 2026-06-26T13:30+08
│   ├── visual.ts
│   ├── live-guard.ts                     # R2-P1-2:fs.readFileSync + regex,globalSetup 用
│   └── selectors.ts                      # §6 TESTIDS/ROLES + footer enforcement statement
├── specs/
│   ├── equity.spec.ts                    # SC-3 5 case
│   ├── options.spec.ts                   # SC-4 4 case
│   ├── market.spec.ts                    # SC-5 3 case
│   ├── navigation.spec.ts                # SC-6 4 case(N4 三步流程版,R2-P2-2)
│   ├── no-trading-day.spec.ts            # SC-8 options-only + ?date=2026-06-27 (Sat)
│   ├── visual.spec.ts                    # SC-9 + Win32 skip
│   └── live-contract.spec.ts             # SC-11 hard cap 3
└── .gitignore                            # test-results/ + playwright-report/ + node_modules/ + .cache/

.github/workflows/
├── e2e.yml                               # push/PR trigger
└── e2e-update-snapshots.yml              # R2-P1-3:workflow_dispatch,跑 --update-snapshots 開 PR
```

### 修改

| File | 改動 | 對應 |
|---|---|---|
| `backend/services/rate_limiter.py` | **新增 `class NoOpBucket`**(公開於 services 層,讓 finmind.py 與 tests 共用 — R3-P1-NOOPBUCKET) | R3-P1-NOOPBUCKET |
| `backend/tests/conftest.py` | 改為 `from services.rate_limiter import NoOpBucket` re-export(維持既有 fixture 簽名向後相容) | R3-P1-NOOPBUCKET |
| `backend/services/finmind.py` | (1) `__init__` 加 `if os.getenv("FAKE_FINMIND")=="1": from services.rate_limiter import NoOpBucket; self._limiter=NoOpBucket(); self._inflight={}; self._token=""; self._http=None; return`(skip httpx + token check)<br>(2) `get_finmind()` 同 v2(FAKE_FINMIND==1 回 FakeFinMindClient) | R2-P0-1, R3-P1-NOOPBUCKET, SC-2 |
| `backend/services/finmind.py` | **15 處** `date.today()` swap 成 `from services.clock import today; today()` | R2-P0-3 |
| `backend/services/finmind_realtime.py` | 1 處 `date.today()` swap | R2-P0-3 |
| `backend/services/trading_calendar.py` | (1) `_fetch_raw_dates_from_finmind` 前置 env-gate 讀 `TaiwanFuturesDaily_TX_calendar.json`<br>(2) 1 處 `date.today()` swap | R2-P0-3, R2-P1-1 |
| `backend/routes/chip.py` | 1 處 `date.today()` swap(line 110) | R3-P1-CLOCK-ROUTES |
| `backend/routes/options.py` | 2 處 `date.today()` swap(line 24 `_resolve_contract` + line 32 `_today_str`)— line 24 是 timebomb,過 2026-07-15 TXO 結算 → TXO202607 脫離 active | R3-P1-CLOCK-ROUTES |
| `backend/routes/symbols.py` | `load_symbols` lifespan 前置 env-gate 讀 `TaiwanStockInfo.json` | R2-P0-1 (F1 carry-over) |
| `backend/main.py` | (1) **lifespan 前置** `FAKE_FINMIND` 嚴格驗證(R2-P2-1 移到 lifespan 而非 get_finmind 內 lazy)<br>(2) 加 `GET /api/_meta/mode` 回 `{fake, fixtures_dir, fake_today}` | R2-P2-1, SC-2, F6 |
| `frontend/package.json` | scripts 加 `"e2e"` `"e2e:live"` `"e2e:ui"` `"e2e:update-snapshots"`(全 cross-env) | SC-1, F5 |
| `.gitignore` (root) | 加 `e2e/test-results/` `e2e/playwright-report/` `e2e/node_modules/` `e2e/.cache/` | SC-1, R2-P0-4 |
| `frontend/src/components/ChipBrokersPanel.tsx` | 補 root `data-testid="chip-brokers-panel"` | F7 |
| `frontend/src/components/ChipKlineChart.tsx` | 補 root `data-testid="chip-kline-chart"` | F7 |
| `frontend/src/components/OptionsMaxPainCard.tsx` | 補 root `data-testid="options-max-pain-card"` | F7 |
| `frontend/src/components/OptionsOIWallsCard.tsx` | 補 root `data-testid="options-oi-walls-card"` | F7 |
| `frontend/src/components/OptionsPCRCard.tsx` | 補 root `data-testid="options-pcr-card"` | F7 |
| `frontend/src/components/OptionsInstitutionalCard.tsx` | 補 root `data-testid="options-institutional-card"` | F7 |
| `frontend/src/components/OptionsLargeTradersStrip.tsx` | 補 root `data-testid="options-large-traders-strip"` | F7 |
| `frontend/src/components/OptionsStrikeLadder.tsx` | 補 root `data-testid="options-strike-ladder"` | F7 |
| `frontend/src/components/MarketHeatmap.tsx` | 補 root `data-testid="market-heatmap"` | F7 |
| `frontend/src/components/MarketLeaderboard.tsx` | 補 root `data-testid="market-leaderboard"` | F7 |

**不動**:`backend/tests/` 完全不改;`ModeSwitch.tsx` 維持現狀 label。

---

## 3. Per-SC Design

### SC-1: Playwright framework 跑得起來

**`e2e/playwright.config.ts`** 重點(R2-P0-4 加 CHIP_DATA_DIR):

```ts
import { defineConfig, devices } from "@playwright/test";
const fakeMode = process.env.FAKE_FINMIND !== "real";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",
  globalSetup: "./helpers/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "python -m uvicorn main:app --port 8000",
      cwd: "../backend",
      env: fakeMode
        ? {
            FAKE_FINMIND: "1",
            FAKE_TODAY: "2026-06-26",                       // R2-P0-3
            CHIP_DATA_DIR: "../e2e/.cache",                 // R2-P0-4
            FINMIND_TOKEN: "fake",
          }
        : { FAKE_FINMIND: "0" },
      url: "http://127.0.0.1:8000/api/symbols?search=2",
      reuseExistingServer: false,                            // F6
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      cwd: "../frontend",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

**`e2e/helpers/global-setup.ts`**(加 live-guard,R2-P1-2):
```ts
import { request } from "@playwright/test";
import { assertLiveCap } from "./live-guard";

export default async function globalSetup() {
  assertLiveCap();                                         // R2-P1-2 不是 beforeAll,改 globalSetup 一次
  const api = await request.newContext({ baseURL: "http://127.0.0.1:8000" });
  const r = await api.get("/api/_meta/mode").catch(() => null);
  if (!r || !r.ok()) throw new Error("Backend /api/_meta/mode 無回應 — 啟動失敗");
  const body = await r.json();
  const expectFake = process.env.FAKE_FINMIND !== "real";
  if (expectFake && !body.fake) throw new Error("ABORT: detected real backend on :8000");
  if (!expectFake && body.fake) throw new Error("ABORT: e2e:live but backend in fake");
}
```

**`e2e/helpers/live-guard.ts`**(R2-P1-2 唯一機制):
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPEC = join(__dirname, "..", "specs", "live-contract.spec.ts");
const CAP = 3;

export function assertLiveCap(): void {
  const src = readFileSync(SPEC, "utf-8");
  const count = (src.match(/^\s*test\s*\(/gm) ?? []).length;
  if (count > CAP) {
    throw new Error(`live-contract.spec.ts has ${count} tests (cap ${CAP}). 縮 scope OR 升 SC-11 brainstorm。`);
  }
}
```

**`e2e/package.json`** + cross-env:
```json
{
  "scripts": {
    "test":     "playwright test --grep-invert='@live'",
    "test:live":"cross-env FAKE_FINMIND=real playwright test --config=playwright.live.config.ts",
    "test:ui":  "playwright test --ui",
    "update-snapshots": "playwright test --update-snapshots"
  },
  "devDependencies": { "@playwright/test": "^1.49.0", "cross-env": "^7.0.3", "typescript": "^5.7.0" }
}
```

**Timing budget**(F25):cold-start ≤ 90s + per-test ≤ 8s × ~17 ≈ 3.5 min → 5-min slack。

---

### SC-2: `FAKE_FINMIND=1` 切假料(_get-layer stub + preload + in-memory slice)

**`backend/services/clock.py`**(R2-P0-3 新增):
```python
"""Clock indirection — 讓 E2E 凍 today() for fixture stability。

Production:  today() == date.today()
FAKE_FINMIND=1 + FAKE_TODAY=YYYY-MM-DD:  today() == date.fromisoformat(FAKE_TODAY)
"""
from __future__ import annotations
from datetime import date, datetime
import os


def today() -> date:
    if os.getenv("FAKE_FINMIND") == "1":
        s = os.getenv("FAKE_TODAY", "")
        if s:
            return date.fromisoformat(s)
    return date.today()


def now() -> datetime:
    if os.getenv("FAKE_FINMIND") == "1":
        s = os.getenv("FAKE_TODAY", "")
        if s:
            return datetime.fromisoformat(f"{s}T13:30:00+08:00")
    return datetime.now()
```

**`backend/services/rate_limiter.py`** 新增(R3-P1-NOOPBUCKET):
```python
class NoOpBucket:
    """Test / fake-mode 用無 sleep token bucket;duck-types TokenBucket。"""
    rate: float = float("inf")
    async def acquire_async(self, tokens: int = 1, timeout: float | None = None) -> bool:
        return True
    async def acquire(self, tokens: int = 1, timeout: float | None = None) -> bool:
        return True
```

**`backend/tests/conftest.py`** 改 re-export(向後相容,避免破壞既有 import 點):
```python
from services.rate_limiter import NoOpBucket  # noqa: F401 — re-export for legacy test imports
```

**`backend/services/finmind.py::FinMindClient.__init__`** 修改(R2-P0-1 + R3-P1-NOOPBUCKET):
```python
def __init__(self) -> None:
    self._inflight: dict[str, asyncio.Task] = {}
    if os.getenv("FAKE_FINMIND") == "1":
        # Fake 模式不需 token / httpx / 真 limiter,但仍需 self._limiter 屬性給 _get 內部 await。
        from services.rate_limiter import NoOpBucket   # R3-P1-NOOPBUCKET:services 內部 import,無 layering 違規
        self._limiter = NoOpBucket()
        self._token = ""
        self._http = None  # type: ignore[assignment]  # FakeFinMindClient 不會用到
        return
    self._token = os.getenv("FINMIND_TOKEN", "")
    if not self._token:
        raise ValueError("FINMIND_TOKEN env var is required")
    self._limiter = get_finmind_rate_limiter()
    self._http = httpx.AsyncClient(timeout=30.0)
```

**Phase 3 ordering**(避免 break 既有測試):rate_limiter.py 新增 NoOpBucket → tests/conftest.py 改 re-export → 最後 finmind.py __init__ skip 路徑。三步分 commit。

**`backend/tests_e2e/fixtures/MANIFEST.json`**(R3-P0-PARSE 新增 — explicit filename → key):
```json
{
  "TaiwanStockInfo.json":                                              {"dataset": "TaiwanStockInfo",                                          "data_id": ""},
  "TaiwanFuturesDaily_TX_calendar.json":                               {"dataset": "TaiwanFuturesDaily",                                       "data_id": "TX", "skip_store": true, "_note": "env-gate only;不入 _store 避免跟 fetch_spot 單日 fixture key collision — R4-P1"},
  "TaiwanStockPrice_2330_2026-01-01_2026-06-26.json":                  {"dataset": "TaiwanStockPrice",                                         "data_id": "2330"},
  "TaiwanStockInstitutionalInvestorsBuySellWide_2330_2026-06-26.json": {"dataset": "TaiwanStockInstitutionalInvestorsBuySellWide",             "data_id": "2330"},
  "TaiwanStockMarginPurchaseShortSale_2330_2026-06-26.json":           {"dataset": "TaiwanStockMarginPurchaseShortSale",                       "data_id": "2330"},
  "TaiwanStockKBar_2330_2026-06-26.json":                              {"dataset": "TaiwanStockKBar",                                          "data_id": "2330"},
  "taiwan_stock_trading_daily_report_2330_2026-06-12_2026-06-26.json": {"dataset": "taiwan_stock_trading_daily_report",                        "data_id": "2330"},
  "taiwan_stock_trading_daily_report_secid_agg_2330_BROKER001_2026-06-26.json": {"dataset": "taiwan_stock_trading_daily_report_secid_agg",     "data_id": "2330", "securities_trader_id": "BROKER001"},
  "TaiwanStockMarketValue_2026-06-26.json":                            {"dataset": "TaiwanStockMarketValue",                                   "data_id": ""},
  "taiwan_stock_tick_snapshot_2026-06-26.json":                        {"dataset": "taiwan_stock_tick_snapshot",                               "data_id": ""},
  "TaiwanOptionDaily_TXO_2026-04-01_2026-06-26.json":                  {"dataset": "TaiwanOptionDaily",                                        "data_id": "TXO"},
  "TaiwanOptionOpenInterestLargeTraders_TXO_2026-05-26_2026-06-26.json":{"dataset": "TaiwanOptionOpenInterestLargeTraders",                    "data_id": "TXO"},
  "TaiwanFuturesDaily_TX_2026-06-26.json":                             {"dataset": "TaiwanFuturesDaily",                                       "data_id": "TX"},
  "TaiwanOptionFinalSettlementPrice_TXO.json":                         {"dataset": "TaiwanOptionFinalSettlementPrice",                         "data_id": "TXO"},
  "TaiwanOptionInstitutionalInvestors_TXO_2026-06-26.json":            {"dataset": "TaiwanOptionInstitutionalInvestors",                       "data_id": "TXO"},
  "TaiwanOptionInstitutionalInvestorsAfterHours_TXO_2026-06-26.json":  {"dataset": "TaiwanOptionInstitutionalInvestorsAfterHours",             "data_id": "TXO"}
}
```

**`backend/services/finmind_fake.py`**(R3-P0-PARSE — drop heuristic,改讀 MANIFEST):
```python
"""FakeFinMindClient — 繼承 FinMindClient,_get override 讀 fixture by explicit MANIFEST。

R3-P0-PARSE 修正:不再用 filename heuristic,改讀 fixtures/MANIFEST.json explicit map。
              零 parsing 歧義,零 silent MISS。

Lookup 流程:
1. _get(url, params) → 取 (dataset, data_id) — dataset 走 params['dataset'] OR url path-tail fallback
2. 查 _store[(dataset, data_id)] → preload window rows
3. 若 params 有 start/end/date,in-memory date filter rows by row['date'] in {target dates}
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from services.finmind import FinMindClient

logger = logging.getLogger(__name__)

_FIXTURE_DIR = Path(os.getenv("FAKE_FINMIND_FIXTURES_DIR",
                              str(Path(__file__).resolve().parent.parent / "tests_e2e" / "fixtures")))


class FakeFinMindClient(FinMindClient):
    def __init__(self) -> None:
        super().__init__()  # FinMindClient.__init__ 已 detect FAKE_FINMIND=1
        manifest_path = _FIXTURE_DIR / "MANIFEST.json"
        if not manifest_path.exists():
            raise FileNotFoundError(
                f"fake-finmind MANIFEST missing: {manifest_path}. "
                "請新增 MANIFEST.json 對映 filename → {dataset, data_id}。"
            )
        manifest: dict[str, dict[str, str]] = json.loads(manifest_path.read_text(encoding="utf-8"))

        # By (dataset, data_id) → list[dict]
        self._store: dict[tuple[str, str], list[dict]] = {}
        for fname, key in manifest.items():
            p = _FIXTURE_DIR / fname
            if not p.exists():
                raise FileNotFoundError(f"MANIFEST 列了但 fixture 不存在:{p}")
            if key.get("skip_store"):
                # R4-P1:某些 fixture(如 TaiwanFuturesDaily_TX_calendar)由 env-gate 直接 fs read,
                #       不能進 _store,否則跟同 (dataset, data_id) 的單日 fixture 撞 key 互蓋
                continue
            rows = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(rows, dict) and "data" in rows:
                rows = rows["data"]
            store_key = (key["dataset"], key.get("data_id", ""))
            if store_key in self._store:
                raise ValueError(
                    f"MANIFEST 對 {store_key} 有 ≥ 2 條 fixture 對映 — 互蓋 risk(R4-P1)。"
                    " 加 skip_store:true 或合併 fixture。"
                )
            self._store[store_key] = rows
        logger.info("FakeFinMindClient preloaded %d entries to _store", len(self._store))

    async def close(self) -> None:
        return None

    async def _get(self, url: str, params: dict) -> list:
        # path-tail fallback for endpoints w/o dataset query param
        dataset = params.get("dataset") or url.rsplit("/", 1)[-1]
        data_id = params.get("data_id", "")
        start = params.get("start_date", "")
        end = params.get("end_date", "")
        single_date = params.get("date", "")

        rows = self._store.get((dataset, data_id))
        if rows is None and data_id:
            rows = self._store.get((dataset, ""))  # 退一步試 universe-level fixture
        if rows is None:
            logger.info("fake-finmind MISS dataset=%s data_id=%s start=%s end=%s",
                        dataset, data_id, start, end)
            return []

        # In-memory date filter
        target_dates: set[str] = set()
        if start and end:
            from datetime import date as _d, timedelta
            d0, d1 = _d.fromisoformat(start), _d.fromisoformat(end)
            while d0 <= d1:
                target_dates.add(d0.isoformat()); d0 += timedelta(days=1)
        elif single_date:
            target_dates.add(single_date)

        if not target_dates:
            return rows  # no date filter — return whole payload

        return [r for r in rows if r.get("date") in target_dates]
```

**MANIFEST consistency gate** — Phase 3 必先寫的 unit test(避免 fixture / MANIFEST / 真實 _get 三方 drift):
```python
# backend/tests/test_fake_finmind_manifest.py(新增,gates Phase 3)
"""驗證 fixtures/MANIFEST.json 跟真實 service 層 _get 呼叫 (dataset, data_id) 對得上。

FAILURE MODE:fixture 沒列進 MANIFEST,或 MANIFEST 對映錯 (dataset, data_id),
            Phase 3 跑 SC-3/4/5 會 silent [] MISS。本 test 為 explicit gate。
"""
import json
from pathlib import Path


def test_manifest_includes_every_fixture():
    fixtures = Path("backend/tests_e2e/fixtures")
    manifest = json.loads((fixtures / "MANIFEST.json").read_text(encoding="utf-8"))
    actual_files = {p.name for p in fixtures.glob("*.json") if p.name not in ("MANIFEST.json",)}
    listed_files = set(manifest.keys())
    extra_in_dir = actual_files - listed_files
    extra_in_manifest = listed_files - actual_files
    assert not extra_in_dir, f"fixtures 沒列進 MANIFEST: {extra_in_dir}"
    assert not extra_in_manifest, f"MANIFEST 列了但 fixture 不存在: {extra_in_manifest}"


def test_manifest_keys_match_real_get_call_shapes():
    """對每個 manifest 條目,確認 dataset 名在 services/ 內真有 _get literal 引用。

    R4-P2 修正:不再 stub,寫實際 grep-based check。typo dataset 在 MANIFEST 內會
              silent MISS Phase 3 SC-3/4/5,本 test 為強制 gate。
    """
    import re
    fixtures = Path("backend/tests_e2e/fixtures")
    manifest = json.loads((fixtures / "MANIFEST.json").read_text(encoding="utf-8"))
    services_dir = Path("backend/services")
    src = "\n".join(p.read_text(encoding="utf-8") for p in services_dir.glob("finmind*.py"))
    # 抓 "dataset": "Xxx" / 'dataset': 'Xxx' literal 形式
    literal_datasets = set(re.findall(r'["\']dataset["\']\s*:\s*["\']([A-Za-z_][\w]*)["\']', src))
    # R5-P1 fix:URL-tail form `f"{_FINMIND_BASE}/<name>"` — taiwan_stock_trading_daily_report /
    #          ..._secid_agg / taiwan_stock_tick_snapshot 等只此形式;對應 FakeFinMindClient._get
    #          的 url.rsplit('/', 1)[-1] fallback
    url_datasets = set(re.findall(r'_FINMIND_BASE\}/([a-z][\w]*)', src))
    real_datasets = literal_datasets | url_datasets
    manifest_datasets = {v["dataset"] for v in manifest.values()}
    unknown_in_manifest = manifest_datasets - real_datasets
    assert not unknown_in_manifest, (
        f"MANIFEST 列了 {unknown_in_manifest} 但 services/finmind*.py 沒 _get 用到 — "
        "dataset 名拼錯或 fixture 已失效"
    )


def test_manifest_no_store_key_collision():
    """R4-P1 強制:non-skip-store 條目 (dataset, data_id) 不可碰撞。"""
    manifest = json.loads(Path("backend/tests_e2e/fixtures/MANIFEST.json").read_text(encoding="utf-8"))
    non_skip = [v for v in manifest.values() if not v.get("skip_store")]
    keys = [(v["dataset"], v.get("data_id", "")) for v in non_skip]
    assert len(keys) == len(set(keys)), f"_store key collision: {keys}"
```

**`backend/main.py`** lifespan(R2-P2-1 移前置 + R2-P0-3 暴露 fake_today):
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # R2-P2-1: FAIL-LOUD 早於 load_symbols / 任何 import
    fake = os.getenv("FAKE_FINMIND", "")
    if fake not in ("", "0", "1"):
        raise RuntimeError(f"invalid FAKE_FINMIND={fake!r} — only ''/'0'/'1' allowed")
    from routes.symbols import load_symbols
    import services.finmind as fm_mod
    await load_symbols()
    yield
    if fm_mod._client is not None:
        await fm_mod._client.close()


@app.get("/api/_meta/mode")
async def get_mode() -> dict:
    return {
        "fake": os.getenv("FAKE_FINMIND") == "1",
        "fake_today": os.getenv("FAKE_TODAY", ""),
        "fixtures_dir": os.getenv("FAKE_FINMIND_FIXTURES_DIR", "<default>"),
    }
```

**驗證**(三段 — R2-P0-1 + F21):
- Fast smoke:`FAKE_FINMIND=1 python -c "from services.finmind_fake import FakeFinMindClient; c=FakeFinMindClient(); assert isinstance(c, __import__('services.finmind', fromlist=['FinMindClient']).FinMindClient); assert hasattr(c, 'fetch_chip_summary'); print('ok')"`
- Integration:`FAKE_FINMIND=1 FAKE_TODAY=2026-06-26 python -m uvicorn main:app --port 8000 &; curl http://127.0.0.1:8000/api/_meta/mode` 應回 `{"fake":true,"fake_today":"2026-06-26",...}`
- Fail-loud:`FAKE_FINMIND=true python -m uvicorn main:app --port 8000` 應 lifespan startup RuntimeError

---

### SC-3 ~ SC-6:對齊 v2(已 fully addressed 由 round 2)

只有 SC-6 N4 更新(R2-P2-2 三步流程版,replace 原 N4 整段):

```ts
test("N4: 三 mode 切換時對應 mode 元件實際被 unmount", async ({ page }) => {
  await page.goto("/");
  // 確認 default equity 有 mount
  await expect(page.getByTestId("chip-brokers-panel")).toBeVisible();
  // 切 options → assert chip-brokers 不在
  await page.getByRole("button", { name: "選擇權" }).click();
  await expect(page.getByTestId("options-max-pain-card")).toBeVisible();
  await expect(page.getByTestId("chip-brokers-panel")).toHaveCount(0);
  // 切 market → assert options 不在
  await page.getByRole("button", { name: "大盤" }).click();
  await expect(page.getByTestId("market-heatmap")).toBeVisible();
  await expect(page.getByTestId("options-max-pain-card")).toHaveCount(0);
  // 切回 equity → assert market 不在
  await page.getByRole("button", { name: "個股" }).click();
  await expect(page.getByTestId("chip-brokers-panel")).toBeVisible();
  await expect(page.getByTestId("market-heatmap")).toHaveCount(0);
});
```

---

### SC-7: Backend API contract pytest

**`backend/tests_e2e/conftest.py`**(R2-P0-4 加 CHIP_DATA_DIR scoping):
```python
from __future__ import annotations
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True, scope="function")
def _e2e_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_FINMIND", "1")
    monkeypatch.setenv("FAKE_TODAY", "2026-06-26")             # R2-P0-3
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))         # R2-P0-4 防 cache 污染
    import services.finmind as fm
    monkeypatch.setattr(fm, "_client", None)


@pytest.fixture
async def client():
    from main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

其他 `test_api_*.py` snippets 同 v2(F11 fix + F17 fix + F18 fix 都已收進)。

---

### SC-8: no_trading_day(date 改 2026-06-27 = Sat,R2-P0-5)

```python
# backend/tests_e2e/test_api_no_trading_day.py
async def test_options_max_pain_no_trading_day(client):
    # R3-P0-URL-SHAPE 修正:真實 route 是 /api/options/max_pain + ?contract= query(非 path)
    r = await client.get("/api/options/max_pain?contract=TXO202607&date=2026-06-27")  # Sat
    assert r.status_code == 200
    body = r.json()
    assert body.get("no_trading_day") is True
    assert body.get("as_of_date") == "2026-06-26"   # T-1 = 週五
```

```ts
// e2e/specs/no-trading-day.spec.ts — R3-P0-URL-ROUTING:App.tsx 不讀 URL param,改 addInitScript(localStorage) + DateField.fill
import { test, expect } from "@playwright/test";
import { installFixtureClock } from "../helpers/clock";

test("NTD1: options page 選 Sat 日期 → 顯示無交易日", async ({ page }) => {
  await installFixtureClock(page);                                                  // 凍 browser today
  await page.addInitScript(() => localStorage.setItem("mode", "options"));          // App.tsx:72 只讀 localStorage
  await page.goto("/");
  await page.getByLabel("選擇日期").fill("2026-06-27");                             // DateField aria-label;Sat 日
  await expect(page.getByText("無交易日")).toBeVisible();
  await expect(page.getByTestId("options-max-pain-card")).toContainText("無交易日");
});
```

**URL audit 紀律**(R3-P0-URL-SHAPE lesson):Phase 2 寫 SC test snippet 時,**backend URL 必 grep `backend/routes/*.py @router.get` 對照真實 path / Query;不准憑記憶寫**。Frontend hook URL 對 `frontend/src/lib/*-api.ts`。

---

### SC-9: Visual baseline + bootstrap workflow(R2-P1-3)

`e2e/specs/visual.spec.ts` 同 v2(`installFixtureClock` + `skipOnWin32`)。

**新增 `.github/workflows/e2e-update-snapshots.yml`**(workflow_dispatch only):
```yaml
name: e2e-update-snapshots
on:
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { token: ${{ secrets.GITHUB_TOKEN }} }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - uses: actions/cache@v4
        with: { path: ~/.cache/ms-playwright, key: playwright-${{ runner.os }}-chromium-v1.49.0 }
      - run: pip install -r backend/requirements.txt
      - run: cd frontend && npm ci
      - run: cd e2e && npm ci && npx playwright install --with-deps chromium
      - run: cd e2e && npm run update-snapshots
        env: { FAKE_FINMIND: "1", FAKE_TODAY: "2026-06-26", CHIP_DATA_DIR: "./e2e/.cache" }
      - uses: peter-evans/create-pull-request@v6
        with:
          title: "chore(e2e): refresh visual baselines"
          body: "Auto-generated. Review PNG diffs in Files changed."
          branch: e2e/refresh-visual-baselines
          add-paths: e2e/specs/**/*.png
```

`e2e/README.md` 加章節:
```markdown
## Bootstrapping visual baselines (Win32 dev)
Visual baseline 只在 Linux 生成。Win32 本機可選兩條:
1. CI 路線:trigger workflow `e2e-update-snapshots`,審 auto-PR
2. Docker 本機:`docker run --rm -v $(pwd):/work -w /work mcr.microsoft.com/playwright:v1.49.0-jammy bash -c "cd e2e && npm ci && npx playwright install chromium && npm run update-snapshots"`
```

---

### SC-10: GitHub Actions CI(R2-P0-3/R2-P0-4 同步加 env)

```yaml
name: e2e
on: { push: , pull_request: { branches: [main] } }

jobs:
  backend-api-contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: "pip" }
      - run: pip install -r backend/requirements.txt
      - run: cd backend && python -m pytest tests_e2e/ -v --tb=short
        env:
          FAKE_FINMIND: "1"
          FAKE_TODAY: "2026-06-26"             # R2-P0-3
          FINMIND_TOKEN: fake

  frontend-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: "pip" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm", cache-dependency-path: "frontend/package-lock.json" }
      - uses: actions/cache@v4
        with: { path: ~/.cache/ms-playwright, key: playwright-${{ runner.os }}-chromium-v1.49.0 }
      - run: pip install -r backend/requirements.txt
      - run: cd frontend && npm ci
      - run: cd e2e && npm ci && npx playwright install --with-deps chromium
      - run: cd e2e && npm test
        env:
          FAKE_FINMIND: "1"
          FAKE_TODAY: "2026-06-26"             # R2-P0-3
          CHIP_DATA_DIR: "./e2e/.cache"        # R2-P0-4
          FINMIND_TOKEN: fake
          CI: "true"
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: e2e/playwright-report/, retention-days: 14 }
```

---

### SC-11: hard cap(R2-P1-2 用 fs + globalSetup)

`e2e/specs/live-contract.spec.ts` 頂部:
```ts
// LIVE TESTS HARD CAP: 3 — 防 SC scope creep
// helpers/live-guard.ts 在 globalSetup 階段 fs.readFileSync + regex 計 test(),> 3 throw
```

`helpers/live-guard.ts` 已在 SC-1 §3 給完整實作。

---

## 4. Data Flow (v3 — 加 clock indirection 層)

```
[Playwright test in e2e/specs/]
  ↓ HTTP GET http://127.0.0.1:5173/api/chip/2330?date=2026-06-26
[Vite dev server :5173] → proxy /api → :8000
[FastAPI app :8000 — FAKE_FINMIND=1, FAKE_TODAY=2026-06-26, CHIP_DATA_DIR=./e2e/.cache]
  ↓ routes/chip.py → services.finmind.get_finmind() → FakeFinMindClient instance
[FakeFinMindClient._get(url, params) override]
  ↓ preload dict lookup by (dataset, data_id) → in-memory date filter when start==end
[Real fetch_*'s transform pipeline 全程走過 — cache_version 驗證 / parse / dedup / merge]
  ↓ services.clock.today() 讀 FAKE_TODAY="2026-06-26"(R2-P0-3 — 防 wall-clock fixture 漂移)
[Response: {institutional: {...}, top_brokers: [...]}]
  ↓ frontend hook 同既有 path
[React render → Playwright assertion]
```

**No bypass 修正(R2-P2-4 changelog 同步)**:_get-layer stub 覆蓋 `FinMindClient` 全 18 fetch_* + `finmind_realtime.py` 三處 `client._get`;**`trading_calendar._fetch_raw_dates_from_finmind` + `routes/symbols.py::load_symbols` 仍各自 env-gate 讀 fixture**(§2 修改表)。

---

## 5. 邊界與安全

- **FAKE_FINMIND lifespan 前置 fail-loud**(R2-P2-1):invalid value 無法啟動,不靠 lazy detection
- **FAKE_TODAY env**(R2-P0-3):services/clock.py 統一 today() — 17 處 swap,bdy 永遠跟 fixture 日期對齊
- **CHIP_DATA_DIR scope**(R2-P0-4):tests_e2e tmp_path / Playwright .cache / CI runner cache —**真假料 cache 完全隔離**
- **`/api/_meta/mode` probe**:Playwright globalSetup 強制驗證(F6)
- **Fixture 不含 secrets**:都是公開市場資料
- **`e2e/` 獨立 npm root + cross-env**:不污染 frontend lockfile + Windows 相容
- **Visual baseline 純 PNG binary commit**:**不裝 LFS**(F27)
- **Playwright context isolation**(F23):預設每 test 新 context,單 test 內 reload 保 localStorage
- **Clock-pin 政策統一**(F8 + R2-P0-3):browser 端 `page.clock.install` + backend 端 `FAKE_TODAY`,同凍 `2026-06-26T13:30+08:00`
- **No fixture for empty days**(R2-P1-4):週六/週日依 `_get` fallback `return []`,不需單獨 fixture

---

## 6. Selector 契約 (`e2e/helpers/selectors.ts`)

(TESTIDS / ROLES 同 v2,**附 footer enforcement statement** R2-P2-3:)

```ts
// FOOTER (R2-P2-3):
// 這 10 root data-testid 是 spec 契約。改名 / 移除 / 拆 wrapper 等動作必須:
//   1. 同 PR 改 e2e/helpers/selectors.ts 對應 const
//   2. 同 PR 改受影響的 e2e/specs/*.spec.ts
//   3. CI E2E suite 是 enforcement gate;PR 紅 ≠ 接受
// (Phase 5 視情況加 CI lint `rg "data-testid=\"chip-brokers-panel\"" frontend/src/components/` 強制存在)
```

---

## 7. Open Decisions(rounds 0+1+2 後最終鎖定)

| Decision | 選擇 | 來源 |
|---|---|---|
| Fixture trading-day | **2026-06-26 (Fri)** + 2026-06-27 (Sat empty) | R2-P0-5 修正(原 2026-06-27 是 Sat 不是 Fri) |
| Date pin 必檢 | 任何鎖死 calendar date 前必 `date.fromisoformat('YYYY-MM-DD').strftime('%A')` 驗 | R2-P0-5 lesson |
| FinMind 切換 | `FAKE_FINMIND=1` + lifespan 前置嚴格驗證 | R2-P2-1 |
| FAKE_TODAY | `2026-06-26`(只 fake-mode 啟用) | R2-P0-3 |
| FAKE stub 層 | `_get` override + class 繼承 + **explicit MANIFEST.json**(R3-P0-PARSE 從 heuristic 退) + preload+slice | R2-P0-1 + R2-P0-2 + R3-P0-PARSE |
| Clock swap 範圍 | **20 處**:services ×17 + routes ×3(chip.py ×1, options.py ×2 含 timebomb 修正) | R2-P0-3 + R3-P1-CLOCK-ROUTES |
| NoOpBucket 位置 | `services/rate_limiter.py`,tests/conftest.py re-export(R3-P1-NOOPBUCKET — 不准 production 反向 import tests) | R3-P1-NOOPBUCKET |
| URL 來源紀律 | Backend URL 必 grep `backend/routes/*.py @router.get` 對照;frontend URL 必 grep `frontend/src/lib/*-api.ts`;**不准憑記憶寫**(R3-P0-URL-SHAPE / R3-P0-URL-ROUTING 教訓) | R3-P0-URL-SHAPE / R3-P0-URL-ROUTING |
| 非 client httpx 旁路 | trading_calendar / symbols 各自 env-gate(共用 fixture) | F1 |
| CHIP_DATA_DIR | tests_e2e tmp / Playwright `./e2e/.cache` / CI 同 | R2-P0-4 |
| Backend 測試位置 | `backend/tests_e2e/` 獨立 | Phase 0 |
| Visual baseline | colocated path + Linux only + Win32 skip + 獨立 workflow_dispatch 生成 | F19 + R2-P1-3 |
| Visual LFS | **不裝** | F27 |
| CI 策略 | parallel jobs 全跑完 | Phase 0 |
| `e2e/` npm root | 獨立 + cross-env | F5 |
| Live cap | 3,fs.readFileSync + regex,globalSetup | R2-P1-2 |
| Fixture rotation | 每季 + release 前;owner = repo maintainer | F22 |
| Polling-race | `installFixtureClock` 統一 helper | F8 + R2-P0-3 |
| TaiwanCalendar fixture | rename `TaiwanFuturesDaily_TX_calendar.json`,reuse `_get` TX 路徑 | R2-P1-1 |
| empty no_trading_day fixture | drop;依 `_get` 自然 `return []` | R2-P1-4 |
| N4 mutual exclusivity | 三步序列:equity→options→market→equity,每步 assert 對應 mode unmount | R2-P2-2 |

---

## 8. Known Risks

| Risk | Mitigation |
|---|---|
| Win32 env-var syntax 在 PowerShell 失效 | cross-env(F5) |
| `reuseExistingServer` 撞真 dev server | `reuseExistingServer: false` + globalSetup probe(F6) |
| Fixture rotation cost | 每季 + release 前;`FAKE_TODAY` 凍 today 解 day drift(F22 + R2-P0-3) |
| Playwright install CDN | actions/cache(F25) |
| CI < 5 min 緊 | timing budget 量化 ≈ 3.5 min(F25);若 Phase 5 超,split slow tests |
| SymbolSearch role 不確定 | OR-fallback selector,Phase 2 grep verify 後 narrow(F14) |
| FakeFinMindClient inheritance bug | SC-2 verify 用 isinstance + hasattr 強制檢查(R2-P0-1) |
| _get stub 不覆蓋的旁路 | trading_calendar / symbols 在原檔 env-gate;新增 httpx 旁路時跟 pattern(F1 + R2-P0-2) |
| services/clock.py swap 20 處風險 | TDD `[red]` 寫 service unit test `assert today() returns date.fromisoformat(FAKE_TODAY) when env set`;然後再 `[green]` swap(Phase 3)。**特別 anchor**:`backend/tests/test_options_routes_clock.py` 驗證 `_resolve_contract('TXO202607')` 在 `FAKE_TODAY=2026-06-26` + wall-clock 已過 7/15 情境下仍回 dict 非 None(R3-P1-CLOCK-ROUTES timebomb 鎖) |
| MANIFEST drift(fixture 沒列 / 列錯 dataset)| `backend/tests/test_fake_finmind_manifest.py` 強制 gate:fixtures 跟 MANIFEST 互檢 + 對映真實 service `_get` 呼叫的 (dataset, data_id);Phase 3 紅 → 強制更新 MANIFEST 才能進 green |
| Invented URL 在 Phase 2 復發 | URL 來源紀律(§7):snippet 寫 URL 必 grep `backend/routes/*.py @router.get` / `frontend/src/lib/*-api.ts` 對照真實 router/client 才能定稿 |

---

## Changelog

- **v1 (2026-06-29)**:初版。
- **v2 (2026-06-30)**:對應 round-1 28 條 accepted findings 全處理。
- **v6 (2026-06-30)**:對應 round-5 1 條 accepted finding(R5-P1-MANIFEST-GREP-INCOMPLETE):test_manifest_keys_match_real_get_call_shapes regex union URL-tail form,涵蓋 `taiwan_stock_trading_daily_report` 等 3 個 path-tail dataset。
- **v5 (2026-06-30)**:對應 round-4 2 條 accepted findings:
  - MANIFEST schema 加 `skip_store: true` 解 (TaiwanFuturesDaily, TX) calendar vs single-day key collision(R4-P1)
  - FakeFinMindClient.__init__ 加 explicit collision raise(防同 _store key 互蓋)
  - `test_fake_finmind_manifest.py` 第二段 stub 改寫成真實 grep-based dataset literal check + 加 collision gate test(R4-P2)
- **v4 (2026-06-30)**:對應 round-3 5 條 accepted findings 全處理(/feat option [2] tech_pivot)。改動 ~5%:
  - `_parse_filename` 啟發式 drop,改 explicit `fixtures/MANIFEST.json` filename→{dataset,data_id} 對映 + `test_fake_finmind_manifest.py` gate(R3-P0-PARSE)
  - SC-8 backend URL 改 `/api/options/max_pain?contract=TXO202607&date=...`(R3-P0-URL-SHAPE)
  - SC-8 frontend 改 `addInitScript(localStorage) + DateField.fill` pattern(R3-P0-URL-ROUTING)
  - `NoOpBucket` 移 `services/rate_limiter.py`,tests/conftest.py re-export(R3-P1-NOOPBUCKET)
  - Clock swap 加 routes/chip.py + routes/options.py × 2(timebomb 修正,R3-P1-CLOCK-ROUTES);總 swap 17 → 20
  - 新增 URL audit 紀律 §7 + 3 條新 Known Risks §8
- **v3 (2026-06-30)**:對應 round-2 14 條 accepted findings 全處理。重大架構修正:
  - FakeFinMindClient **繼承 FinMindClient** + `__init__` 在 FAKE_FINMIND=1 跳 httpx / token(R2-P0-1)
  - `_get` override 用「preload + in-memory date slice」覆蓋 per-day fan-out(R2-P0-2)
  - 新增 `services/clock.py::today()` + FAKE_TODAY env,**17 處 `date.today()` swap**(R2-P0-3)
  - `CHIP_DATA_DIR` scope 進 3 處(tests_e2e tmp / Playwright .cache / CI)防 cache 污染(R2-P0-4)
  - **修正日期 calendar 錯誤**:2026-06-27 是週六不是週五;trading day 改 2026-06-26,no-trading-day 改 2026-06-27(R2-P0-5)
  - trading_calendar fixture rename `TaiwanFuturesDaily_TX_calendar.json` 對齊真實 dataset(R2-P1-1)
  - live-guard 用 fs.readFileSync + globalSetup(R2-P1-2)
  - 加 `e2e-update-snapshots.yml` 給 visual baseline bootstrap(R2-P1-3)
  - drop empty_no_trading_day fixture(R2-P1-4)
  - lifespan 前置 fail-loud 替代 lazy(R2-P2-1)
  - N4 改三步序列防 tautology(R2-P2-2)
  - §6 selector contract 加 enforcement footer(R2-P2-3)
  - Changelog + §4 修正「_get 一次解」誇大表述(R2-P2-4)
  - SC-8 snippet 補 installFixtureClock + 4-hook guard(R2-P2-5)
