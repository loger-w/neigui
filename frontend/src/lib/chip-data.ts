// Types and data-transform functions for chip (籌碼) data.

export interface InstitutionalSide {
  buy: number;
  sell: number;
  net: number;
}

export interface MarginSide {
  balance: number;
  change: number;
  limit: number;
}

export interface ChipSummary {
  symbol: string;
  date: string;
  fetched_at: string;
  institutional: {
    foreign: InstitutionalSide;
    trust: InstitutionalSide;
    dealer: InstitutionalSide;
  };
  margin: {
    margin_purchase: MarginSide;
    short_sale: MarginSide;
    short_balance_ratio: number;
  };
  top_brokers: TopBroker[];
}

export interface TopBroker {
  name: string;
  broker_id: string;
  buy: number;
  sell: number;
  net: number;
  avg_buy_price: number;
  avg_sell_price: number;
}

/**
 * N-day aggregate of broker-level chips, ending at `date` (inclusive).
 * Backed by /api/chip/{symbol}/brokers_window. ChipBrokersPanel reads this
 * instead of `summary` so the right-side list reflects "past N trading days
 * cumulative" rather than just one trading day.
 *
 * `actual_days` = trading_dates.length and can be < window_days when the
 * anchor date is too early in history (panel UI shows "(實際 X 日)"). All
 * dollar / lot values are sums (lots), avg_*_price are share-weighted
 * averages across days. `total_traded_lots` is the same fallback formula as
 * dayTotalLots used by topByVolume's daytradeRate threshold.
 */
export interface ChipBrokersWindow {
  symbol: string;
  date: string;
  window_days: number;
  trading_dates: string[];
  actual_days: number;
  fetched_at: string;
  top_brokers: TopBroker[];
  margin: ChipSummary["margin"];
  institutional: ChipSummary["institutional"];
  total_traded_lots: number;
}

export interface BrokerTrade {
  broker: string;
  broker_id: string;
  price: number;
  buy: number;
  sell: number;
}

export interface ChipBubbleData {
  symbol: string;
  date: string;
  fetched_at: string;
  trades: BrokerTrade[];
}

export interface IntradayPoint {
  t: string;
  price: number;
}

export interface ChipIntraday {
  symbol: string;
  date: string;
  fetched_at: string;
  points: IntradayPoint[];
}

export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InstitutionalDaily {
  date: string;
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  major_net: number;
}

export interface MarginDaily {
  date: string;
  margin_balance: number;
  short_balance: number;
  margin_change: number;
  short_change: number;
}

export interface MajorDaily {
  date: string;
  major_net: number;
}

export interface ChipHistory {
  symbol: string;
  fetched_at: string;
  last_date: string;
  candles: DailyCandle[];
  institutional: InstitutionalDaily[];
  margin: MarginDaily[];
  major: MajorDaily[];
}

export function splitBrokers(brokers: TopBroker[]): {
  buyers: TopBroker[];
  sellers: TopBroker[];
} {
  const buyers = brokers.filter((b) => b.net > 0).sort((a, b) => b.net - a.net);
  const sellers = brokers
    .filter((b) => b.net < 0)
    .sort((a, b) => a.net - b.net);
  return { buyers, sellers };
}

export interface BrokerAgg {
  name: string;
  totalBuy: number;
  totalSell: number;
  avgBuyPrice: number;
  avgSellPrice: number;
}

export function aggregateByBroker(trades: BrokerTrade[]): BrokerAgg[] {
  const map = new Map<
    string,
    { b: number; s: number; bpSum: number; spSum: number; bCnt: number; sCnt: number }
  >();
  for (const t of trades) {
    let e = map.get(t.broker);
    if (!e) {
      e = { b: 0, s: 0, bpSum: 0, spSum: 0, bCnt: 0, sCnt: 0 };
      map.set(t.broker, e);
    }
    e.b += t.buy;
    e.s += t.sell;
    if (t.buy > 0) {
      e.bpSum += t.price * t.buy;
      e.bCnt += t.buy;
    }
    if (t.sell > 0) {
      e.spSum += t.price * t.sell;
      e.sCnt += t.sell;
    }
  }
  return [...map.entries()].map(([name, e]) => ({
    name,
    totalBuy: e.b,
    totalSell: e.s,
    avgBuyPrice: e.bCnt ? +(e.bpSum / e.bCnt).toFixed(1) : 0,
    avgSellPrice: e.sCnt ? +(e.spSum / e.sCnt).toFixed(1) : 0,
  }));
}

export interface PriceAgg {
  price: number;
  buy: number;
  sell: number;
}

export function fmtVol(n: number): string {
  return n.toLocaleString();
}

// C6 A3 (🟢): 分點總買/賣 pure helpers。
export interface BrokerTotals {
  buyLots: number;
  sellLots: number;
  /** 元 — 精確金額(row 已由 FinMind 按 (broker, price) pre-aggregate,
   *  乘 1000 (股/張) × price 即為成交金額,非估算)。 */
  buyAmount: number;
  sellAmount: number;
}

/**
 * Sum a single broker's total buy/sell lots + monetary amount across all
 * price levels. Returns zeros when brokerId is null or not found in trades.
 */
export function computeBrokerTotals(
  trades: BrokerTrade[],
  brokerId: string | null,
): BrokerTotals {
  if (!brokerId) return { buyLots: 0, sellLots: 0, buyAmount: 0, sellAmount: 0 };
  let buyLots = 0;
  let sellLots = 0;
  let buyAmount = 0;
  let sellAmount = 0;
  for (const t of trades) {
    if (t.broker_id !== brokerId) continue;
    buyLots += t.buy;
    sellLots += t.sell;
    buyAmount += t.buy * 1000 * t.price;
    sellAmount += t.sell * 1000 * t.price;
  }
  return { buyLots, sellLots, buyAmount, sellAmount };
}

// C7 A1 (🟢): Y 軸 brush summary pure helper。
export interface PriceRangeSummary {
  priceMin: number;
  priceMax: number;
  /** distinct price levels within [priceMin, priceMax] inclusive */
  priceLevelCount: number;
  /** unique broker_id values that traded in the range (deduped) */
  brokerIds: string[];
  buyLots: number;
  sellLots: number;
}

/**
 * Summarize the trades that fall within a price range (inclusive on both
 * ends). Used by the Y-axis brush to preview "hit N brokers in this band"
 * and expose `brokerIds` to onJumpToOverview for bulk selection.
 */
export function summarizeTradesByPriceRange(
  trades: BrokerTrade[],
  priceMin: number,
  priceMax: number,
): PriceRangeSummary {
  const inRange = trades.filter((t) => t.price >= priceMin && t.price <= priceMax);
  const prices = new Set<number>();
  const brokers = new Set<string>();
  let buyLots = 0;
  let sellLots = 0;
  for (const t of inRange) {
    prices.add(t.price);
    if (t.broker_id) brokers.add(t.broker_id);
    buyLots += t.buy;
    sellLots += t.sell;
  }
  return {
    priceMin,
    priceMax,
    priceLevelCount: prices.size,
    brokerIds: [...brokers],
    buyLots,
    sellLots,
  };
}

/**
 * Format 金額(元)into human string with tabular-nums-friendly widths:
 *  < 10,000        → `X,XXX 元`
 *  10,000 ~ 億      → `X,XXX 萬`(integer 萬)
 *  ≥ 100,000,000   → `X.XX 億`(2 decimals for alignment)
 */
export function fmtAmount(amount: number): string {
  if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(2)} 億`;
  }
  if (amount >= 10_000) {
    return `${Math.floor(amount / 10_000).toLocaleString()} 萬`;
  }
  return `${Math.round(amount).toLocaleString()} 元`;
}

export function aggregateByPrice(trades: BrokerTrade[]): PriceAgg[] {
  const map = new Map<number, { buy: number; sell: number }>();
  for (const t of trades) {
    let e = map.get(t.price);
    if (!e) {
      e = { buy: 0, sell: 0 };
      map.set(t.price, e);
    }
    e.buy += t.buy;
    e.sell += t.sell;
  }
  return [...map.entries()]
    .map(([price, e]) => ({ price, ...e }))
    .sort((a, b) => b.price - a.price);
}

export interface TradeRow {
  broker: string;
  volume: number;
  price: number;
}

export type TradeSortKey = "volume" | "price";
export type SortDir = "desc" | "asc";
export interface SortSpec {
  key: TradeSortKey;
  dir: SortDir;
}

export const DEFAULT_TRADE_SORT: SortSpec = { key: "volume", dir: "desc" };

function tradeComparator(spec: SortSpec): (a: TradeRow, b: TradeRow) => number {
  const mult = spec.dir === "desc" ? -1 : 1;
  return (a, b) => {
    const av = spec.key === "volume" ? a.volume : a.price;
    const bv = spec.key === "volume" ? b.volume : b.price;
    if (av !== bv) return (av - bv) * mult;
    // Stable tie-break: broker name ascending. Same order regardless of dir
    // so toggling asc/desc never reshuffles tied rows.
    if (a.broker < b.broker) return -1;
    if (a.broker > b.broker) return 1;
    return 0;
  };
}

/**
 * Build {buyRows, sellRows} for the bubble-view side panel.
 *
 * When `selectedBroker` is null, returns the top `maxRows` overall by the
 * given sort key. When `selectedBroker` is set, the filter is applied FIRST
 * and then sliced — so a small-volume broker's price levels are not lost
 * behind a global top-N cap that they couldn't make.
 *
 * `buySort` / `sellSort` are independent: changing one side does not
 * reshuffle the other.
 */
export function buildTradeRows(
  trades: BrokerTrade[],
  selectedBroker: string | null,
  maxRows: number,
  buySort: SortSpec = DEFAULT_TRADE_SORT,
  sellSort: SortSpec = DEFAULT_TRADE_SORT,
): { buyRows: TradeRow[]; sellRows: TradeRow[] } {
  const source = selectedBroker
    ? trades.filter((t) => t.broker === selectedBroker)
    : trades;
  const buys: TradeRow[] = [];
  const sells: TradeRow[] = [];
  for (const t of source) {
    if (t.buy > 0) buys.push({ broker: t.broker, volume: t.buy, price: t.price });
    if (t.sell > 0) sells.push({ broker: t.broker, volume: t.sell, price: t.price });
  }
  buys.sort(tradeComparator(buySort));
  sells.sort(tradeComparator(sellSort));
  return { buyRows: buys.slice(0, maxRows), sellRows: sells.slice(0, maxRows) };
}

// -- Broker history (F4) ----------------------------------------------------

export interface BrokerDaily {
  date: string;
  buy: number;
  sell: number;
  net: number;
}

export interface ChipBrokerHistory {
  symbol: string;
  fetched_at: string;
  last_date: string;
  /** Keyed by broker_id (FinMind `securities_trader_id`); the same value
   *  `top_brokers[].broker_id` carries. */
  brokers: Record<string, BrokerDaily[]>;
}

// -- Top-by-volume (F2) -----------------------------------------------------

export interface TopVolumeBroker extends TopBroker {
  total: number;
  daytradeRate: number | null;
}

/**
 * Rank brokers by (buy + sell) descending, top 15.
 * daytradeRate = min(buy, sell) / max(buy, sell), but only when:
 *   - dayTotalLots > 0
 *   - broker total ≥ 1% of dayTotalLots
 *   - max(buy, sell) > 0
 * Otherwise null (UI displays "—").
 */
export function topByVolume(
  brokers: TopBroker[],
  dayTotalLots: number,
): TopVolumeBroker[] {
  const threshold = dayTotalLots > 0
    ? Math.max(1, Math.floor(dayTotalLots * 0.01))
    : Infinity;
  return brokers
    .map((b) => {
      const total = b.buy + b.sell;
      const maxAbs = Math.max(b.buy, b.sell);
      const daytradeRate =
        dayTotalLots > 0 && total >= threshold && maxAbs > 0
          ? Math.min(b.buy, b.sell) / maxAbs
          : null;
      return { ...b, total, daytradeRate };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
}
