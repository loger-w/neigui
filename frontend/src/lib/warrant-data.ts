// 權證選擇器型別 — 對 backend routes/warrants.py payload(snake_case 原樣)。

export type IvDriftLabel = "declining" | "rising" | "stable" | "insufficient";

export interface WarrantTerm {
  warrant_id: string;
  name: string;
  kind: "call" | "put";
  market: "twse" | "tpex";
  underlying_id: string;
  underlying_name: string;
  strike: number | null;
  exercise_ratio: number | null;
  last_trading_date: string;
  maturity_date: string;
  is_reset: boolean;
  eod_close: number | null;
  eod_bid: number | null;
  eod_ask: number | null;
  underlying_eod_close: number | null;
  iv_prev: number | null;
  iv_drift: IvDriftLabel | null;
}

export interface WarrantQuote {
  price: number | null;
  best_bid: number | null;
  best_ask: number | null;
  best_bid_vol: number | null;
  best_ask_vol: number | null;
  moneyness: number | null;
  days_left: number;
  iv: number | null;
  delta: number | null;
  leverage: number | null;
  spread_ratio: number | null;
  spread_lev_ratio: number | null;
  theo_price: number | null;
  mispricing_pct: number | null;
  mispricing_label: "cheap" | "fair" | "expensive" | null;
  iv_percentile: number | null;
  quote_time: string | null;
}

/** 前端表格列 = 條款 + (盤中欄位,quotes 尚未到時為 undefined)+ 評分
 *  (WA-2 純前端計算,lib/warrant-score;null = 因子缺或重設型)。 */
export type WarrantRow = WarrantTerm & Partial<WarrantQuote> & { score?: number | null };

export interface WarrantsPayload {
  as_of_date: string | null;
  warrants: WarrantTerm[];
}

export interface WarrantQuotesPayload {
  stock_id: string;
  underlying_price: number | null;
  quote_date: string | null;
  quote_time: string | null;
  quotes: Record<string, WarrantQuote>;
}

