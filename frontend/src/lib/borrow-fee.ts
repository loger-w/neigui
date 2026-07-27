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
  /** 該股當月 lending_shares 加總(含同日多筆)。key 集 = month_counts;
   *  取值仍走 optional chain(前後端版本 skew 時 map 可能整個缺)。 */
  month_shares: Record<string, number>;
}

// 高費率標色門檻(%)— backend services/daytrade_fee.py 同名常數,
// 兩端測試互鎖同值(test_fee_highlight_threshold_value)。
export const FEE_HIGHLIGHT_THRESHOLD = 3.5;
