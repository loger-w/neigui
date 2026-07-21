// 分點反查 types + 金額縮寫(feat/broker-daily-flows design v3 §3.1)

export interface FlowStockRow {
  stock_id: string;
  stock_name: string;
  buy_lots: number;
  sell_lots: number;
  net_lots: number;
  net_amount: number;
}

export interface BrokerFlowsPayload {
  broker_id: string;
  broker_name: string;
  requested_date: string;
  as_of_date: string;
  no_trading_day: boolean;
  stock_count: number;
  fetched_at: string;
  buy_top: FlowStockRow[];
  sell_top: FlowStockRow[];
}

export interface TraderHit {
  broker_id: string;
  broker_name: string;
}

/** 元 → 千/萬/億中文縮寫(design R1:market-format.formatAmount 是百萬 M
 * 口徑,不重用)。億=兩位小數;萬 ≥100萬 取整、<100萬 一位小數;<1萬 千分位。 */
export function formatAmountZh(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  // 先在整數域 round 再除,避免 toFixed 浮點半值陷阱((4.005).toFixed(2) → "4.00")
  if (abs >= 1e8) return `${sign}${(Math.round(abs / 1e6) / 100).toFixed(2)}億`;
  if (abs >= 1e4) {
    const wan = abs / 1e4;
    return `${sign}${wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1)}萬`;
  }
  return `${sign}${abs.toLocaleString("en-US")}`;
}
