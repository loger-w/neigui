---
name: finmind-conventions
description: FinMind 接入慣例與配額真相。接新 FinMind dataset、寫 probe 腳本、設計 fan-out endpoint、評估冷載入成本、排查成串 502/503(配額燒乾徵兆)、寫 backend test 碰到 FinMindClient 時先讀。含 Bearer 認證、共用 window 設計、6000 req/hr 配額、conftest test 基建。
---

# FinMind 接入慣例

## 認證與 token

- **Sponsor tier 必須用 `Authorization: Bearer <token>` header**,**不是** `?token=` query。`?token=` 會回 400 "Token is illegal"。Probe / 直 httpx 呼叫都要套。`FinMindClient._get` 已是這個 pattern,跟著用。(Trigger:新接 FinMind dataset、寫一次性 probe 腳本時)
- **JWT 過期是日常事件**:token 的 `exp` claim 是 unix epoch,內嵌在 JWT payload。要備好「token 過期 → 真實環境驗證 blocked」的 fallback 設計(hand-built fixture + 標 known risk + real-env 驗證 deferred 路線,對應 /feat Phase 6 的 infra_fail 標準 case)。(Trigger:進入 real-env 驗證前)

## 配額真相(2026-07-03 實測)

- **真瓶頸 = 每小時 6000 requests(rolling window),不是 per-second rate**:一檔冷 `history/major`(days=540)~360 req → **每小時只能冷載入 ~16 檔**;燒乾後全面 402 → 前端 502(HTTPStatusError)/ 503(JSONDecodeError 是 ValueError 子類)。
- `FINMIND_RATE_LIMIT_PER_SEC` code 預設 40(`services/finmind.py::get_finmind_rate_limiter`):拉高只會燒配額更快 + abort 前已燒的更多。**結構性解法是砍每檔 request 數,不是調 rate**。
- **檢查配額**:`GET api.web.finmindtrade.com/v2/user_info`(Bearer)看 `user_count / api_request_limit`。counter 有 5-8s 批次延遲 + rolling window aging 噪音,當驗證 side-channel 用時要先量 idle drift。
- **user_count 只計 `/api/v4/data` dataset 呼叫**(2026-07-17 實測):`taiwan_stock_tick_snapshot` 等即時 snapshot 端點與 `user_info` 本身**都不計數** — sampler 可任意頻率打 user_info 零成本;market/options 的 snapshot 輪詢不吃 6000/hr 配額。
- **判讀「常駐消耗」前先做在場證明**(2026-07-17 /bug prd-idle-finmind-drain 教訓):確保零瀏覽分頁 + 零 probe 後看 user_count 能否歸零(rolling window 1 小時排空,app 無 daemon 時應見連續平零)。當時的「~1 req/s 常駐」實為殭屍 fan-out(已修)+ 瀏覽/probe 活動誤歸因;app 內 keeper 全 TWSE、backfill 的 FinMind 面一次性,無常駐 FinMind 迴圈。
- Trigger:出現成串 502/503 / 設計新 fan-out endpoint / 評估冷載入成本 / 懷疑配額異常消耗時。

## Fan-out 設計(2026-07-14 warrant-broker-flow 沉澱)

- **Probe-first**:fan-out 前先對「最具代表性的單一 data_id」打 1 request 探可得性(如成交金額最大權證的分點報表),0 rows = 該日資料未上料 → 直接換候選日,省掉整包白燒(cap 200 場景省 199 req)。樣板 `services/warrant_flow.py::get_flow` 步驟 3e。Trigger:設計任何「多 data_id × 同日」fan-out 時。
- **fan-out 失敗語意用 `asyncio.TaskGroup` 不用 gather**:gather 首錯 propagate 後其餘 in-flight 照打(結果全丟 = 白燒配額);TaskGroup 首錯自動 cancel siblings。`except* httpx.HTTPError as eg: raise eg.exceptions[0]`。Trigger:「任一失敗整包放棄」語意的 fan-out。
- **候選日自適應**:資料上料時點未知(如權證分點「當晚幾點」)不要 hardcode 起點 — 從 today 起試 + probe 偵測 + 空結果不落 cache(晚間上料自動吃到),消除對未知時點的依賴。代價 = 每查詢 ≤2 request。Trigger:接 T+1 lag 且上料時點不明的 dataset。

## 共用 window 設計

- `services/finmind.py::fetch_taiwan_option_daily_window` 是「一份 250-day window 給三個 endpoint 共用」的範本。新 chip endpoint 跟著:
  - 用 `_run_once(f"window_{cache_key}", ...)` inflight dedup
  - Invalidation 必須在 `_run_once` coroutine 內、dedup 之後、實際 fetch 之前
  - parse cache 用 `_invalidate_chip_parse_caches(end_date)` pattern delete(`utils.cache.chip_cache_dir().iterdir()` 單次掃)
- Refresh 流前端要設「全 hook refresh 一起跑」(`mp.refresh(); ow.refresh(); pcr.refresh(); inst.refresh()`),**不要**用 `queryClient.invalidateQueries` cascade — cascade 不會帶 `refresh=true` 到後端,sibling 撞 parse cache 拿到 stale。

## Service module 呼叫 FinMind

- **新 service module 走 FinMind 要 wrap `get_finmind()` per-module**:寫成 `def get_finmind(): from services.finmind import get_finmind as _real; return _real()`(`services/market_universe.py` 是樣板),test `monkeypatch.setattr(mu, "get_finmind", ...)` 才能 patch 不影響其他 service module。**禁止直接 `from services.finmind import get_finmind`** 進 service module(test fixture 就無法獨立 swap)。(Trigger:新 service module 需呼叫 FinMind 時)

## Backend test 基建

- `backend/tests/conftest.py` 統一處理 `FinMindClient` singleton reset + `FINMIND_TOKEN` env + `CHIP_DATA_DIR` env + `NoOpBucket` 跳過 rate limiter。每個新 test 檔**不**要再寫 `_reset_singleton`,直接用 conftest 的 autouse。`bypass_finmind_rate_limiter` 是 opt-in fixture(非 autouse)。(Trigger:新增 backend test 檔時)
