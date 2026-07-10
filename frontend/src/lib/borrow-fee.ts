// 券差(當日沖銷券差借券費率)型別 — 對應 GET /api/daytrade-fee payload。

export interface BorrowFeeRow {
  market: "twse" | "tpex";
  stock_id: string;
  name: string;
  lending_shares: number;
  fee_rate: number; // 百分比值(3.5 = 3.5%)
  date: string;
}

export interface BorrowFeeData {
  as_of_date: string;
  no_trading_day?: boolean;
  partial?: string[];
  rows: BorrowFeeRow[];
  month_counts: Record<string, number>;
}

// 高費率標色門檻(%)— backend services/daytrade_fee.py 同名常數,
// 兩端測試互鎖同值(test_fee_highlight_threshold_value)。
export const FEE_HIGHLIGHT_THRESHOLD = 3.5;
