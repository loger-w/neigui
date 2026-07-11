// 券差表排序 / 格式化純函式(無 React 依賴,獨立單測)。

import type { BorrowFeeRow } from "./borrow-fee";

export type SortKey = "fee_rate" | "lending_shares" | "month_count" | "stock_id";
export type SortDir = "asc" | "desc";

export function sortRows(
  rows: BorrowFeeRow[],
  key: SortKey,
  dir: SortDir,
  monthCounts: Record<string, number>,
): BorrowFeeRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (r: BorrowFeeRow): number | string => {
    if (key === "month_count") return monthCounts[r.stock_id] ?? 1;
    if (key === "stock_id") return r.stock_id;
    return r[key];
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va !== vb) return va < vb ? -sign : sign;
    // tie-break:stock_id 升冪(排序方向無關,保持可預測)
    return a.stock_id < b.stock_id ? -1 : a.stock_id > b.stock_id ? 1 : 0;
  });
}

export interface StockOption {
  stock_id: string;
  name: string;
  market: BorrowFeeRow["market"];
}

// 當日單檔篩選的候選名單 = 當日 rows 的 distinct 標的(同股多筆取首見
// name/market),代號升冪。
export function distinctStocks(rows: BorrowFeeRow[]): StockOption[] {
  const seen = new Map<string, StockOption>();
  for (const r of rows) {
    if (!seen.has(r.stock_id)) {
      seen.set(r.stock_id, { stock_id: r.stock_id, name: r.name, market: r.market });
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.stock_id < b.stock_id ? -1 : a.stock_id > b.stock_id ? 1 : 0,
  );
}

// 匹配式對齊 SymbolSearch(代號 prefix / 名稱 substring);空 query 回全部
// 候選(當日名單全集,不沿用 SymbolSearch 的 20 筆 cap)。
export function matchStockOptions(options: StockOption[], query: string): StockOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) => o.stock_id.toLowerCase().startsWith(q) || o.name.toLowerCase().includes(q),
  );
}

export function formatShares(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatFee(n: number): string {
  return `${n.toFixed(2)}%`;
}
