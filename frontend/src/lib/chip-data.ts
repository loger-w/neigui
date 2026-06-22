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

/**
 * Build {buyRows, sellRows} for the bubble-view side panel.
 *
 * When `selectedBroker` is null, returns the top `maxRows` overall by volume.
 * When `selectedBroker` is set, the filter is applied FIRST and then sliced —
 * so a small-volume broker's price levels are not lost behind a global top-N
 * cap that they couldn't make.
 */
export function buildTradeRows(
  trades: BrokerTrade[],
  selectedBroker: string | null,
  maxRows: number,
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
  buys.sort((a, b) => b.volume - a.volume);
  sells.sort((a, b) => b.volume - a.volume);
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
