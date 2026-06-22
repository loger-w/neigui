import { describe, it, expect } from "vitest";
import { splitBrokers, aggregateByPrice, aggregateByBroker, fmtVol, topByVolume, buildTradeRows } from "./chip-data";
import type { TopBroker, BrokerTrade } from "./chip-data";

function mkBroker(name: string, buy: number, sell: number): TopBroker {
  return {
    name, broker_id: name, buy, sell, net: buy - sell,
    avg_buy_price: 0, avg_sell_price: 0,
  };
}

describe("topByVolume", () => {
  it("sorts by total (buy+sell) desc", () => {
    const result = topByVolume(
      [mkBroker("A", 100, 100), mkBroker("B", 500, 500), mkBroker("C", 50, 50)],
      100_000,
    );
    expect(result.map((b) => b.name)).toEqual(["B", "A", "C"]);
  });

  it("computes daytradeRate = min/max when above 1% threshold", () => {
    // 35000 day total → threshold = 350 lots; X total = 600 ≥ 350
    const result = topByVolume([mkBroker("X", 400, 200)], 35_000);
    expect(result[0].daytradeRate).toBeCloseTo(0.5, 3);
  });

  it("returns null daytradeRate when below 1% threshold", () => {
    // 35000 → threshold 350; X total 300 < 350
    const result = topByVolume([mkBroker("X", 200, 100)], 35_000);
    expect(result[0].daytradeRate).toBeNull();
  });

  it("returns null daytradeRate when dayTotalLots is 0", () => {
    const result = topByVolume([mkBroker("X", 100, 100)], 0);
    expect(result[0].daytradeRate).toBeNull();
  });

  it("returns null daytradeRate when both buy and sell are 0", () => {
    const result = topByVolume([mkBroker("X", 0, 0)], 100_000);
    expect(result[0].daytradeRate).toBeNull();
  });

  it("limits result to 15", () => {
    const brokers = Array.from({ length: 30 }, (_, i) =>
      mkBroker(`B${i}`, 1000 - i * 10, 0),
    );
    expect(topByVolume(brokers, 100_000)).toHaveLength(15);
  });

  it("includes total field equal to buy + sell", () => {
    const result = topByVolume([mkBroker("X", 300, 200)], 1_000_000);
    expect(result[0].total).toBe(500);
  });
});

describe("splitBrokers", () => {
  const brokers: TopBroker[] = [
    { name: "A", broker_id: "A1", buy: 100, sell: 20, net: 80, avg_buy_price: 100, avg_sell_price: 101 },
    { name: "B", broker_id: "B1", buy: 10, sell: 50, net: -40, avg_buy_price: 99, avg_sell_price: 100 },
    { name: "C", broker_id: "C1", buy: 30, sell: 10, net: 20, avg_buy_price: 100, avg_sell_price: 100 },
    { name: "D", broker_id: "D1", buy: 5, sell: 60, net: -55, avg_buy_price: 98, avg_sell_price: 99 },
  ];

  it("separates buyers (net>0) from sellers (net<0)", () => {
    const { buyers, sellers } = splitBrokers(brokers);
    expect(buyers.map((b) => b.name)).toEqual(["A", "C"]);
    expect(sellers.map((b) => b.name)).toEqual(["D", "B"]);
  });

  it("sorts buyers desc by net, sellers asc by net", () => {
    const { buyers, sellers } = splitBrokers(brokers);
    expect(buyers[0].net).toBeGreaterThan(buyers[1].net);
    expect(sellers[0].net).toBeLessThan(sellers[1].net);
  });
});

describe("aggregateByPrice", () => {
  const trades: BrokerTrade[] = [
    { broker: "X", broker_id: "X1", price: 100, buy: 50, sell: 10 },
    { broker: "Y", broker_id: "Y1", price: 100, buy: 30, sell: 20 },
    { broker: "X", broker_id: "X1", price: 101, buy: 10, sell: 40 },
  ];

  it("aggregates buy/sell by price, sorted desc", () => {
    const result = aggregateByPrice(trades);
    expect(result).toEqual([
      { price: 101, buy: 10, sell: 40 },
      { price: 100, buy: 80, sell: 30 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateByPrice([])).toEqual([]);
  });
});

describe("aggregateByBroker", () => {
  const trades: BrokerTrade[] = [
    { broker: "X", broker_id: "X1", price: 100, buy: 50, sell: 10 },
    { broker: "X", broker_id: "X1", price: 101, buy: 30, sell: 20 },
    { broker: "Y", broker_id: "Y1", price: 100, buy: 10, sell: 40 },
  ];

  it("aggregates buy/sell by broker with weighted average prices", () => {
    const result = aggregateByBroker(trades);
    const x = result.find((b) => b.name === "X")!;
    expect(x.totalBuy).toBe(80);
    expect(x.totalSell).toBe(30);
    expect(x.avgBuyPrice).toBeCloseTo((100 * 50 + 101 * 30) / 80, 0);
  });
});

describe("fmtVol", () => {
  it("formats with locale separators", () => {
    expect(fmtVol(1234567)).toContain("1");
    expect(fmtVol(0)).toBe("0");
  });
});

describe("buildTradeRows", () => {
  function mkTrade(broker: string, price: number, buy: number, sell: number): BrokerTrade {
    return { broker, broker_id: broker, price, buy, sell };
  }

  it("with no selection: returns top-N by volume across all brokers", () => {
    const trades = [
      mkTrade("A", 100, 500, 0),
      mkTrade("B", 101, 200, 0),
      mkTrade("C", 102, 10, 0),
    ];
    const { buyRows } = buildTradeRows(trades, null, 2);
    expect(buyRows).toEqual([
      { broker: "A", volume: 500, price: 100 },
      { broker: "B", volume: 200, price: 101 },
    ]);
  });

  // Bug fix: filter must happen BEFORE the top-N slice. Previously the slice
  // ran over ALL trades first; small-volume rows for the selected broker
  // (e.g. 康和新竹 buy=1 at 2500) got cut behind the global top-200 cap and
  // disappeared after the per-broker filter step.
  it("with selection: small-volume rows for the broker survive the top-N cap", () => {
    const trades: BrokerTrade[] = [];
    // 250 noise brokers each with one big buy that would dominate top-200
    for (let i = 0; i < 250; i++) {
      trades.push(mkTrade(`noise${i}`, 200 + i, 999, 0));
    }
    // small broker with 4 modest price levels
    trades.push(mkTrade("康和新竹", 2495, 0, 15));
    trades.push(mkTrade("康和新竹", 2500, 1, 1));
    trades.push(mkTrade("康和新竹", 2505, 154, 1));
    trades.push(mkTrade("康和新竹", 2510, 2, 2));

    const { buyRows, sellRows } = buildTradeRows(trades, "康和新竹", 200);
    const buyVols = buyRows.map((r) => r.volume).sort((a, b) => a - b);
    const sellVols = sellRows.map((r) => r.volume).sort((a, b) => a - b);
    // All non-zero rows for the broker survive: buys at 2500/2505/2510 (1/154/2),
    // sells at 2495/2500/2505/2510 (15/1/1/2). None hidden by the global cap.
    expect(buyVols).toEqual([1, 2, 154]);
    expect(sellVols).toEqual([1, 1, 2, 15]);
    expect(buyRows.every((r) => r.broker === "康和新竹")).toBe(true);
    expect(sellRows.every((r) => r.broker === "康和新竹")).toBe(true);
  });

  it("sorts rows by volume descending after filter", () => {
    const trades = [
      mkTrade("X", 10, 5, 0),
      mkTrade("X", 11, 100, 0),
      mkTrade("X", 12, 50, 0),
    ];
    const { buyRows } = buildTradeRows(trades, "X", 10);
    expect(buyRows.map((r) => r.volume)).toEqual([100, 50, 5]);
  });
});
