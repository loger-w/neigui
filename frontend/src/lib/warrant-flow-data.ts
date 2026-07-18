// 權證買賣超分點 flow payload types + 純函式(design warrant-broker-flow v3 §3.1)
import { fmtAmount } from "./chip-data";

export interface WarrantFlowSideValue {
  /** 該 kind 有量權證成交額合計(未受 cap 限制,對齊「有量權證 N 檔」口徑) */
  trade_value: number;
  /** 外部人淨買賣 = −(發行商造市總公司席位 net);null = 無法對映,非 0 */
  external_net: number | null;
}

export interface WarrantFlowSummary {
  call: WarrantFlowSideValue;
  put: WarrantFlowSideValue;
}

export interface WarrantFlowBranchWarrant {
  warrant_id: string;
  name: string;
  kind: "call" | "put";
  buy_value: number;
  sell_value: number;
  net_value: number;
}

export interface WarrantFlowBranch {
  broker_id: string;
  broker_name: string;
  buy_value: number;
  sell_value: number;
  net_value: number;
  warrants: WarrantFlowBranchWarrant[];
}

export interface WarrantFlowWarrantRow {
  warrant_id: string;
  name: string;
  kind: "call" | "put";
  trading_money: number;
  /** RE-1:跨全分點 net 恆 0,故此處為外部淨額口徑;null = 無法對映 */
  external_net: number | null;
}

export interface WarrantFlowPayload {
  as_of_date: string | null;
  /** 僅顯式 date 查詢且回退時出現(backend design §2.4);UI 以資料日 badge 呈現 */
  no_trading_day?: boolean;
  truncated: boolean;
  total_traded: number;
  analyzed: number;
  unmapped_count: number;
  empty_reason: "no_warrants" | "no_volume" | null;
  summary: WarrantFlowSummary;
  top_buy_branches: WarrantFlowBranch[];
  top_sell_branches: WarrantFlowBranch[];
  warrants: WarrantFlowWarrantRow[];
}

// ---- 外部淨額時序(warrant-flow-net-history design v3 §3.1)----

export interface WarrantFlowHistoryDay {
  date: string;
  /** built = result cache 已建(值仍可為 null — no_volume / 對映失敗);missing = 未建槽 */
  status: "built" | "missing";
  call: WarrantFlowSideValue | null;
  put: WarrantFlowSideValue | null;
}

export interface WarrantFlowHistoryPayload {
  window: number;
  built: number;
  missing_count: number;
  backfilled: number;
  empty_reason: "no_warrants" | null;
  /** 舊→新;length 可 < window(掃描 cap 截斷) */
  days: WarrantFlowHistoryDay[];
}

/** bar 寬比例(0..1);max <= 0 防除零回 0;負值取 abs(賣超欄同一把尺) */
export function barRatio(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.abs(value) / max);
}

/** 金額格式:abs 後委派 fmtAmount(億/萬/元)— 方向由色彩與欄位語意表達,
 * 不輸出負號(impl-R1:fmtAmount 對負值會掉進「元」分支)。 */
export function formatValue(v: number): string {
  return fmtAmount(Math.abs(v));
}

/** 淨值格式:帶負號的 formatValue。「formatValue 吃 abs、caller 補負號」的
 * 隱含約定收斂到單一 helper,與 netClass 配套(code-review round 1)。 */
export function formatNet(v: number): string {
  return `${v < 0 ? "-" : ""}${formatValue(v)}`;
}
