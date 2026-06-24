import { describe, it, expect } from "vitest";
import { klineScaleY } from "./chip-kline-svg";
import { bubbleRadius } from "./chip-bubble-svg";
import { instBarHeight } from "./chip-inst-bar-svg";
import { splitBrokers, aggregateByPrice, aggregateByBroker } from "./chip-data";
import type { TopBroker, BrokerTrade } from "./chip-data";

describe("klineScaleY", () => {
  it("maps max price to padTop", () => {
    const scale = klineScaleY(1000, 1100, 10, 400);
    expect(scale(1100)).toBe(10);
  });
  it("maps min price to padTop + chartHeight", () => {
    const scale = klineScaleY(1000, 1100, 10, 400);
    expect(scale(1000)).toBe(410);
  });
  it("maps midpoint correctly", () => {
    const scale = klineScaleY(1000, 1100, 10, 400);
    // padTop + (1 - 0.5) * chartHeight = 10 + 200 = 210
    expect(scale(1050)).toBe(210);
  });
});

describe("bubbleRadius", () => {
  it("returns minR for zero volume", () => {
    expect(bubbleRadius(0, 400, 5, 30)).toBe(5);
  });
  it("returns maxR for max volume", () => {
    expect(bubbleRadius(400, 400, 5, 30)).toBe(30);
  });
  it("scales proportionally (sqrt area-based)", () => {
    const r = bubbleRadius(200, 400, 5, 30);
    // sqrt(200/400) = sqrt(0.5) ≈ 0.7071, so 5 + 0.7071 * 25 ≈ 22.68
    expect(r).toBeCloseTo(22.68, 0);
  });
});

describe("instBarHeight", () => {
  it("scales positive value", () => {
    expect(instBarHeight(5000, 10000, 100)).toBe(50);
  });
  it("scales negative value (uses abs)", () => {
    expect(instBarHeight(-5000, 10000, 100)).toBe(50);
  });
  it("returns 0 for zero value", () => {
    expect(instBarHeight(0, 10000, 100)).toBe(0);
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
    expect(buyers[0]!.net).toBeGreaterThan(buyers[1]!.net);
    expect(sellers[0]!.net).toBeLessThan(sellers[1]!.net);
  });

  it("top-15 sum represents major net correctly", () => {
    const { buyers, sellers } = splitBrokers(brokers);
    const buyTotal = buyers.slice(0, 15).reduce((s, b) => s + b.net, 0);
    const sellTotal = sellers.slice(0, 15).reduce((s, b) => s + b.net, 0);
    expect(buyTotal).toBe(100); // 80 + 20
    expect(sellTotal).toBe(-95); // -55 + -40
    expect(buyTotal + sellTotal).toBe(5);
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
    const y = result.find((b) => b.name === "Y")!;
    expect(y.totalBuy).toBe(10);
    expect(y.totalSell).toBe(40);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateByBroker([])).toEqual([]);
  });
});
