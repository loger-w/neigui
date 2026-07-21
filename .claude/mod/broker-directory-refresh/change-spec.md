# Change spec — mod/broker-directory-refresh(spec F-1)

日期:2026-07-21。來源:`docs/specs/broker-flows-followups/spec.md` F-1(user 拍板);設計摘要 + refresh 失敗降級決策(catch → None,不 fallback 舊 cache)已於對話呈現,user 核准「直接開工」。前置盤點:`current-state.md`(同目錄)。規模 S:Phase 3 簡化,0 輪 reviewer。

## 成功條件(SC,對齊 spec F-1 驗收)

1. `refresh=True` → `fetch_securities_trader_info` 被呼叫,即使目錄 cache 新鮮;`refresh=False` 維持 cache 命中 0 fetch。既有 `test_directory_cached_24h` **不得動**。
2. refresh 路徑 dedup key(`broker_directory_r1`)不與非 refresh 路徑(`broker_directory_r0`)互吃。
3. 配額註記:refresh 多燒 1 request/次 → design v3 §8(`.claude/feat/broker-daily-flows/design.md`)補一行。
4. 既有 broker 測試全綠(`pytest -q tests/test_broker_flows.py`,baseline 43 passed 含 routes)。

## 不能破壞的既有行為白名單

- `test_directory_cached_24h`:search 路徑 24h cache 語意,測試零改動。
- `refresh=False` 全路徑零變化(cache 命中 / TTL 過期重抓 / 降級)。
- 目錄降級三案:`search_traders` 503、非法 id 404(降級窗口)、fetch error → broker_name 退 id。
- flows 側 dedup(`bflow_*_r*`)、stale-today 頂替、空結果不落 cache 語意。
- `search_traders` 不長 refresh 面(spec 拍板)。

## 決策記錄

- refresh 重抓失敗 → 沿用 catch → None 降級,**不** fallback 舊 cache(目標場景「新分點不在舊目錄」下 fallback 會照樣 404;None 降級讓 flows 繼續嘗試)。User 核准(2026-07-21 對話)。
- refresh 成功照舊落 cache(`_do_fetch` 既有路徑),後續 24h 非 refresh 請求受益。

## Diff 級(單檔 + 測試;三類標記)

- 🔴 `backend/services/broker_flows.py`
  - `_get_directory_or_none()` → `_get_directory_or_none(refresh: bool = False)`:`if not refresh:` 包住 cache 新鮮檢查;dedup key `f"broker_directory_r{int(refresh)}"`;docstring 更新(移除「無 refresh 參數」註記,保留 R10 降級說明)。
  - `get_daily_flows` 步驟 2:`_get_directory_or_none(refresh)`。
- 🔴 `backend/tests/test_broker_flows.py`(紅先行)
  - `_FakeFM` 加 `info_delay` 參數(dedup race 測試用,預設 0 不影響既有案)。
  - 新測試 1:`refresh=True` 目錄強制重抓(fresh cache 下 info_calls 1→2),且後續 `refresh=False` 吃 refresh 寫回的 cache(info_calls 停在 2)。
  - 新測試 2:並發 `_get_directory_or_none(True)` × `_get_directory_or_none(False)`(冷 cache + info_delay)→ info_calls == 2(key 隔離)。
- 既有測試逐一判:**全部不該紅**(`refresh=True` 既有案 `test_daily_flows_refresh_bypasses_cache` 只斷言 report_calls;monkeypatch stub 收 `*args`)。
- 🔴 `frontend/src/lib/changelog.ts`:PATCH entry(使用者可感 bug fix — 重新整理救不回新分點;寫前讀 `changelog-conventions`)。
- 配額註記(SC-3):`.claude/feat/broker-daily-flows/design.md` §8 補一行(chore)。
- e2e 歸屬(e2e-conventions 判準表,spec 邊界預判豁免、自行再判):hook 回傳 shape 不變、UI 零視覺變化、`detail.error` 契約不變 → 內部行為豁免,commit 註 `[no-e2e: 回傳 shape 與 UI 不變,refresh 內部行為]`。

## Out of scope

- 前端改動(重新整理鈕已傳 refresh=true,鏈路自然通)。
- `search_traders` refresh 面。
- F-2(搜尋截斷提示)。

## Phase 5 自評記錄

- 對抗式 review(medium):無 P0/P1;P2 ×1(changelog 文案對純搜尋情境過度承諾 — 重新整理鈕僅在已選定分點時 render)→ accepted,文案改「檢視分點時按重新整理」。
- self_review_head: 見下行(自評收斂後回填)。
self_review_head: 172a8ee3367b83fd2b1076799bcf09e65e685502
