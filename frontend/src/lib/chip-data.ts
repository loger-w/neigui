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
