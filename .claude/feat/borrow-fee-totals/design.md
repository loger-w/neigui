# Design v1 — 券差選股加總(borrow-fee-totals)

> Changelog:
> - v1(2026-07-28):初版。
> - v2(2026-07-28):Phase 1 review — R1 monthCount 缺 key 時整段「(N 次)」不
>   render(?? 1 fallback 會捏造次數);R2 文案統一全形括號 + 測試走 testid
>   textContent 比對;R3 edge 4 no-op 決策留痕;R4 monthTotalText 推導補明;
>   R5 「本月 = as_of 所在月」語意註記。

**Goal**:券差頁選定個股後顯示「本日標借合計」+「本月累計標借股數」。
**Architecture**:backend payload 加 `month_shares` map(additive);前端 summary 列
純 derived UI,無新 state / 無新 fetch。

---

## 1. Backend — `services/daytrade_fee.py::get_day`(SC-1、SC-3)

`month_dates` 迴圈旁並行累加股數(同資料源 all_rows,同日多筆自然相加):

```python
month_shares: dict[str, int] = {}
for r in all_rows:
    month_dates.setdefault(r["stock_id"], set()).add(r["date"])
    month_shares[r["stock_id"]] = month_shares.get(r["stock_id"], 0) + r["lending_shares"]

payload = {
    "as_of_date": as_of,
    "rows": day_rows,
    "month_counts": {sid: len(ds) for sid, ds in month_dates.items()},
    "month_shares": month_shares,
}
```

- 不動 cache(`_CACHE_VERSION` 維持 1 — cache 層存 normalized rows,payload 組裝在其後)。
- 回退鏈 / `no_trading_day` / `partial` / error contract 全不動。
- **「本月」語意(R5)**:= as_of 所在月(回退鏈落前月時為前月)— 沿用
  `month_counts` 既有語意,`no_trading_day` badge 已提示資料日,不另處理。
- 測試(`tests/test_daytrade_fee.py` 既有 monkeypatch 樣板):
  - 月加總手算:單股跨日多列 + 同日兩列(8046 型)→ `month_shares[sid]` = 全列相加。
  - payload key assertion:`month_shares` 存在且與 `month_counts` 同 key 集。
  - route 層(既有 route 測試檔)增 additive key assertion,其餘 assertion 不變。

## 2. Frontend 型別 — `lib/borrow-fee.ts`(SC-1 對接)

```ts
export interface BorrowFeeData {
  // ...既有欄位不動...
  /** 該股當月 lending_shares 加總(含同日多筆)。key 可能缺(跨月 / 資料缺口)。 */
  month_shares: Record<string, number>;
}
```

`useDaytradeFee` hook 透傳,不需改(泛型 payload)。既有 vitest 的 mock payload
補 `month_shares` 欄(機械化,型別逼出)。

## 3. Frontend UI — `BorrowFeePage.tsx`(SC-2、SC-3、SC-5、edge 1-3)

`selectedStock` 非 null 且 `data` 存在時,於 `BorrowFeeStockFilter` 區塊**正下方**
render summary 列:

```tsx
{data && selectedStock && (
  <p data-testid="borrow-fee-stock-summary" className="mt-2 text-sm text-ink-muted">
    本日標借合計 <span className="text-ink font-medium tabular-nums">{formatShares(dayTotal)}</span> 股
    <span className="mx-1.5 text-ink-dim">·</span>
    本月累計 <span className="text-ink font-medium tabular-nums">{monthTotalText}</span>
    {monthTotal !== null && " 股"}
    {monthCount !== null && (
      <span className="ml-1 text-ink-dim">({monthCount} 次)</span>
    )}
  </p>
)}
```

- `dayTotal` = `rows.reduce((s, r) => s + r.lending_shares, 0)`(rows 已是該股過濾後
  當日列;同日多筆自然合計;無列 → 0,edge 2)。
- `monthTotal` = `data.month_shares[selectedStock.stock_id] ?? null`。
- `monthTotalText = monthTotal !== null ? formatShares(monthTotal) : "—"`(R4;
  import 自 `borrow-fee-utils.ts`,SC-2 千分位要求落點)。
- **`monthCount` = `data.month_counts[selectedStock.stock_id] ?? null`;null →
  整段「(N 次)」不 render(R1)** — `month_shares` 與 `month_counts` 同 key 集,
  缺 key 必同缺;表格欄的 `?? 1` 前提(該列存在 ⇒ 至少 1 次)在 summary 缺 key
  情境不成立,fallback 會捏造次數。
- 文案標點一律**全形括號「(N 次)」**(R2,對齊 SC-2);測試以
  `getByTestId("borrow-fee-stock-summary")` 的 textContent 層級比對,不用整句
  getByText(span 切碎會 fragmentation 失敗)。
- **edge 4(partial tpex 低估)**:沿用既有 partial badge,summary 不另加文案 —
  刻意 no-op(R3 留痕)。
- 數字標色:`text-ink` 強度階,**不用 accent**(色彩語意鐵則;非互動資料)。
- 未選股不 render(SC-5:清除選股 → 列消失)。
- 測試(`BorrowFeePage.test.tsx` 既有 vi.spyOn 樣板):
  - 選股 → summary 出現,本日 / 本月手算值(含同日兩筆 case)、千分位格式。
  - 清除 → 消失;未選 → 不存在。
  - 該股今日無列(selectedStock 殘留)→ 本日 0、本月照顯。
  - `month_shares` 缺 key → 顯「—」且**不出現「(」次數段**(R1 鎖)。
  - regression:未選股全表 render 不變。

## 4. e2e — `e2e/specs/borrow-fee.spec.ts` 新 BF4(SC-4)

- FAKE fixture(`fixtures/borrow_fee/twse_202606.json`)手算:clock 凍結基準日
  2026-06-26 的 as_of 8046 當日僅一列 3,000;當月累計 2,000+12,000+3,000 = 17,000
  (06/24 兩列 + 06/26 一列)。以 8046 選股 → assert summary 含
  「本日標借合計 3,000 股」「本月累計 17,000 股(2 次)」(次數 = 2 個日期)。
  (實作時以 fixture 實際重算為準,含 tpex 檔若有 8046 同號需併計 — 寫 spec 前
  先跑手算 script 核值。)
- 痛點註解連 SC-3(同日多筆是 visibility-only 蓋不住的資料級語意)。

## 5. SC ↔ 章節對照

| SC | 章節 |
|---|---|
| SC-1 payload | §1、§2 |
| SC-2 summary UI | §3 |
| SC-3 同日多筆合計 | §1(backend 加總)、§3(dayTotal)、§4(e2e 手算) |
| SC-4 e2e BF4 | §4 |
| SC-5 regression | §3(未選股不 render)、§4(BF1-3 保綠) |

## Known Risks

(暫無 — Phase 1 review 後回填)
