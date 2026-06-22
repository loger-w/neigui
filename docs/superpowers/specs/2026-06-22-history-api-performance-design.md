# History API 效能優化設計文件

**日期**: 2026-06-22
**狀態**: Implemented
**範圍**: `/api/chip/{symbol}/history` 端點效能優化 + 前端快取

---

## 問題摘要

`/api/chip/{symbol}/history` 端點首次載入約 14 秒，其他端點（bubble、summary）只需 1.8 秒。根因是 `_fetch_major_series` 中 SecIdAgg 批次呼叫失敗時的逐日 fallback 迴圈是序列執行，以及 SecIdAgg 呼叫被放在 Phase 2（等 Phase 1 完成後才開始）。

---

## 優化項目

### 1. A3 — GZipMiddleware（優先順序：第一）

**目標**: 壓縮所有 JSON response，減少網路傳輸時間。

**改動**:
- 檔案: `backend/main.py`
- 新增一行 `app.add_middleware(GZipMiddleware, minimum_size=1000)`
- 匯入 `from starlette.middleware.gzip import GZipMiddleware`

**Middleware 順序**: GZipMiddleware 加在 CORSMiddleware **之後**（Starlette middleware LIFO，後加的先執行）。這確保 CORS headers 先被加上，再壓縮 response body。

**預估效果**: JSON 壓縮率 70-85%，~20KB → 3-6KB。台灣到 Railway US 的 RTT ~150-200ms，減少 transfer size 可省 1 個 RTT（~150-200ms）。

**驗證方式**:
- `curl -H "Accept-Encoding: gzip" -I <backend-url>/api/chip/2330/history`
- 確認 response 含有 `Content-Encoding: gzip`

**測試**:
- 單元測試：驗證 response 含 `Content-Encoding: gzip`（request 帶 `Accept-Encoding: gzip` 時）
- 單元測試：驗證不帶 Accept-Encoding 時 response 不壓縮
- 單元測試：驗證小 response（<1000 bytes）不壓縮

---

### 2. A2+A1 — 消除瀑布流 + 平行化 fallback（優先順序：第二）

**目標**: 
- A2: 把 SecIdAgg 批次呼叫從 Phase 2 移入 Phase 1 的 `asyncio.gather`，消除等待瀑布
- A1: 把 fallback 的逐日序列迴圈改為 `asyncio.gather` 平行執行

**改動檔案**: `backend/services/finmind.py`

#### A2 部分：消除瀑布流

**現狀** (`_do_fetch_history`, L229-265):
```
Phase 1: asyncio.gather(candles, institutional, margin)  — 3 個平行 API call
   ↓ 等待完成
Phase 2: _fetch_major_series(symbol, trading_dates)       — SecIdAgg + fallback
```

**改為**:
```
Phase 1: asyncio.gather(candles, institutional, margin, secid_agg)  — 4 個平行 API call
   ↓ 等待完成
Phase 2: _fetch_major_series(symbol, trading_dates, pre_fetched_secid=by_date)  — 只處理 fallback
```

具體改動：

1. 在 `_do_fetch_history` 的 `asyncio.gather`（L234）中加入 SecIdAgg 呼叫：
   ```python
   candles_raw, inst_raw, margin_raw, secid_raw = await asyncio.gather(
       self._get(...TaiwanStockPrice...),
       self._get(...InstitutionalInvestors...),
       self._get(...MarginPurchaseShortSale...),
       self._safe_get_secid_agg(symbol, s, e),
   )
   ```

2. 新增 `_safe_get_secid_agg` helper method：
   ```python
   async def _safe_get_secid_agg(self, symbol: str, start: str, end: str) -> list:
       try:
           return await self._get(
               f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report_secid_agg",
               {"data_id": symbol, "start_date": start, "end_date": end},
           )
       except Exception as exc:
           logger.warning("SecIdAgg batch fetch failed: %s", exc)
           return []
   ```

3. 解析 `secid_raw` 為 `by_date` dict，傳入 `_fetch_major_series`：
   ```python
   by_date: dict[str, list] = {}
   for r in secid_raw:
       d = r.get("date", "")
       if d not in by_date:
           by_date[d] = []
       by_date[d].append(r)
   ```

4. 修改 `_fetch_major_series` 簽名，接收 `pre_fetched_by_date`：
   ```python
   async def _fetch_major_series(
       self, symbol: str, trading_dates: list[str],
       pre_fetched_by_date: dict[str, list] | None = None,
   ) -> list[dict]:
   ```

5. **移除 `_fetch_major_series` 內部的 SecIdAgg 呼叫**（原 L305-318 的 try/except 區塊）。改為直接使用 `pre_fetched_by_date` 參數。若 `pre_fetched_by_date` 為 `None`，則以空 dict 作為 `by_date`：
   ```python
   by_date = pre_fetched_by_date if pre_fetched_by_date is not None else {}
   ```

#### A1 部分：平行化 fallback

**現狀** (`_fetch_major_series`, L321-341):
```python
for d in uncached_dates:
    rows = by_date.get(d, [])
    if rows:
        major_net = _compute_major_net_agg(rows)
    else:
        day_raw = await self._get(...)  # 序列！每個等 rate limiter
        major_net = _compute_major_net(day_raw)
    ...
```

**改為**: 分兩步 — 先用 SecIdAgg 結果處理有資料的日期，再把缺失的日期用 `asyncio.gather` 平行 fallback：

```python
# Step 1: 處理 SecIdAgg 有資料的日期（純計算，無 I/O）
fallback_dates = []
for d in uncached_dates:
    rows = by_date.get(d, [])
    if rows:
        major_net = _compute_major_net_agg(rows)
        entry = {"date": d, "major_net": major_net}
        if d != today:
            self._write_cache(f"{symbol}_{d}_major", entry)
        cached_results[d] = entry
    else:
        fallback_dates.append(d)

# Step 2: 平行 fallback（如果有缺失的日期）
if fallback_dates:
    async def fetch_one(d: str) -> tuple[str, dict, bool]:
        try:
            day_raw = await self._get(
                f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report",
                {"data_id": symbol, "date": d},
            )
            major_net = _compute_major_net(day_raw)
            return d, {"date": d, "major_net": major_net}, True
        except Exception as exc:
            logger.warning("Fallback failed for %s %s: %s", symbol, d, exc)
            return d, {"date": d, "major_net": 0}, False

    results = await asyncio.gather(*[fetch_one(d) for d in fallback_dates])
    for d, entry, got_data in results:
        if d != today and got_data:
            self._write_cache(f"{symbol}_{d}_major", entry)
        cached_results[d] = entry
```

**不加 Semaphore** — `TokenBucket.acquire_async()` 已經做了流量控制，多加一層 Semaphore 是冗餘。

#### 加入 SecIdAgg 觀測 log

在 Phase 1 完成後加入：
```python
logger.info(
    "SecIdAgg coverage for %s: %d/%d dates",
    symbol, len(by_date), len(trading_dates),
)
```

**預估效果**:
- 正常路徑（SecIdAgg 成功）：省 200-300ms（消除瀑布）
- 異常路徑（SecIdAgg 失敗，60 天 fallback）：從 ~12s 降至 ~2-3s（平行化 + HTTP 重疊）

**測試**:
- 單元測試：mock SecIdAgg 全成功 → 驗證無 fallback API call
- 單元測試：mock SecIdAgg 全失敗 → 驗證 fallback 全走、結果正確
- 單元測試：mock SecIdAgg 部分成功 → 驗證只有缺失的日期走 fallback
- 單元測試：驗證 rate limiter 被正確調用
- 單元測試：驗證快取被正確寫入

---

### 3. B2 — 前端客戶端快取（優先順序：第三）

**目標**: 在 `api.ts` 的 `get()` 函數加入 Map 快取，避免切換股票時重複拉取。

**改動檔案**: `frontend/src/lib/api.ts`

**設計**:

```typescript
const _cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 100;

function cacheKey(path: string, params?: Record<string, string>): string {
  const p = { ...params };
  delete p.refresh;  // refresh 不進 cache key
  const qs = new URLSearchParams(p).toString();
  return qs ? `${path}?${qs}` : path;
}
```

**快取邏輯** 加在 `get()` 函數中：

1. 如果 params 包含 `refresh=true`：
   - 清除該 key 的快取
   - 直接 fetch backend
   - 寫入快取

2. 如果 cache hit 且 TTL 未過期：
   - 直接回傳快取資料

3. 否則：
   - fetch backend
   - 寫入快取
   - Eviction：如果 `_cache.size > CACHE_MAX_ENTRIES`，刪除 insertion-order 最舊的條目：
     ```typescript
     if (_cache.size > CACHE_MAX_ENTRIES) {
       const oldest = _cache.keys().next().value;
       if (oldest !== undefined) _cache.delete(oldest);
     }
     ```
   - 不做 LRU（access-order），insertion-order eviction 對 5 分鐘 TTL + 100 entries 的規模足夠

**TTL 策略**:
- 5 分鐘對盤後資料充足（資料不變）
- 盤中最多看到 5 分鐘前的資料，對 2-5 人的工具可接受
- 使用者可手動 refresh 繞過快取

**測試**:
- 單元測試：驗證 cache hit 不發 fetch
- 單元測試：驗證 TTL 過期後重新 fetch
- 單元測試：驗證 refresh=true 清除快取
- 單元測試：驗證 CACHE_MAX_ENTRIES 限制
- 單元測試：驗證 cache key 不含 refresh 參數

---

## 不做的事項

| 項目 | 理由 |
|------|------|
| A0 in-memory cache | Railway 不休眠，磁碟快取正常，60 次小 JSON 讀取 ~10-20ms，不是瓶頸 |
| 調高 rate limit | FinMind 未公開硬限制，風險不可控。先觀察 log 再決定 |
| HTTP/2 | 需要額外依賴 `h2`，收益不確定，不在此次範圍 |
| React Query / SWR | Over-engineering for 2-5 users |

---

## 執行順序

1. **A3**: GZipMiddleware → 部署 → 驗證
2. **A2+A1**: 消除瀑布 + 平行化 fallback → 部署 → 驗證
3. **B2**: 前端快取 → 部署 → 驗證

每步完成後都要：
- 跑測試
- 本地啟動 server 驗證功能
- 確認 typecheck 通過
