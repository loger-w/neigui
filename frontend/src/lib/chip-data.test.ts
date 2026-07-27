import { describe, it, expect } from "vitest";
import {
  splitBrokers,
  aggregateByPrice,
  aggregateByBroker,
  fmtVol,
  topByVolume,
  buildTradeRows,
  computeBrokerTotals,
  fmtAmount,
  summarizeTradesByPriceRange,
} from "./chip-data";
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
    expect(result[0]!.daytradeRate).toBeCloseTo(0.5, 3);
  });

  it("returns null daytradeRate when below 1% threshold", () => {
    // 35000 → threshold 350; X total 300 < 350
    const result = topByVolume([mkBroker("X", 200, 100)], 35_000);
    expect(result[0]!.daytradeRate).toBeNull();
  });

  it("returns null daytradeRate when dayTotalLots is 0", () => {
    const result = topByVolume([mkBroker("X", 100, 100)], 0);
    expect(result[0]!.daytradeRate).toBeNull();
  });

  it("returns null daytradeRate when both buy and sell are 0", () => {
    const result = topByVolume([mkBroker("X", 0, 0)], 100_000);
    expect(result[0]!.daytradeRate).toBeNull();
  });

  it("limits result to 15", () => {
    const brokers = Array.from({ length: 30 }, (_, i) =>
      mkBroker(`B${i}`, 1000 - i * 10, 0),
    );
    expect(topByVolume(brokers, 100_000)).toHaveLength(15);
  });

  it("includes total field equal to buy + sell", () => {
    const result = topByVolume([mkBroker("X", 300, 200)], 1_000_000);
    expect(result[0]!.total).toBe(500);
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
    const { buyRows } = buildTradeRows(trades, new Set<string>(), 2);
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

    const { buyRows, sellRows } = buildTradeRows(trades, new Set(["康和新竹"]), 200);
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
    const { buyRows } = buildTradeRows(trades, new Set(["X"]), 10);
    expect(buyRows.map((r) => r.volume)).toEqual([100, 50, 5]);
  });

  // F12 (user request): the bubble-view's right side trade list should
  // surface EVERY broker who traded today, including 1-張 (vol=1) ones. The
  // caller now passes Number.POSITIVE_INFINITY for maxRows so the cap no
  // longer trims the long tail.
  it("with no selection and uncapped maxRows: every non-zero buy/sell row is returned, including vol=1", () => {
    const trades: BrokerTrade[] = [];
    // 250 big-volume brokers (would have filled an old 200-row cap by themselves)
    for (let i = 0; i < 250; i++) {
      trades.push(mkTrade(`big-${i}`, 100, 1000 + i, 0));
    }
    // long tail of 1-張 brokers — these used to disappear behind the cap
    for (let i = 0; i < 50; i++) {
      trades.push(mkTrade(`tail-${i}`, 100, 1, 1));
    }

    const { buyRows, sellRows } = buildTradeRows(
      trades,
      new Set<string>(),
      Number.POSITIVE_INFINITY,
    );

    // 250 big buys + 50 tail buys → 300 buy rows.
    expect(buyRows).toHaveLength(300);
    // 50 tail sells only (big brokers had sell=0).
    expect(sellRows).toHaveLength(50);

    // Every 1-張 tail broker survives in buyRows AND sellRows.
    const buyVol1Count = buyRows.filter((r) => r.volume === 1).length;
    const sellVol1Count = sellRows.filter((r) => r.volume === 1).length;
    expect(buyVol1Count).toBe(50);
    expect(sellVol1Count).toBe(50);
  });

  // F2: independent sort spec per side (buy/sell). Default keeps current
  // behaviour (volume desc); explicit price asc/desc + volume asc supported.
  describe("with explicit sortSpec", () => {
    it("buySort=(price, desc): buyRows sorted by price high → low; sellRows unaffected", () => {
      const trades = [
        mkTrade("A", 100, 10, 50),
        mkTrade("B", 102, 5, 30),
        mkTrade("C", 101, 20, 10),
      ];
      const { buyRows, sellRows } = buildTradeRows(
        trades, new Set<string>(), 10,
        { key: "price", dir: "desc" },
      );
      expect(buyRows.map((r) => r.price)).toEqual([102, 101, 100]);
      // sellSort defaults to volume desc — no leak from buy.
      expect(sellRows.map((r) => r.volume)).toEqual([50, 30, 10]);
    });

    it("(price, asc): low → high", () => {
      const trades = [
        mkTrade("A", 100, 10, 0),
        mkTrade("B", 102, 5, 0),
        mkTrade("C", 101, 20, 0),
      ];
      const { buyRows } = buildTradeRows(
        trades, new Set<string>(), 10,
        { key: "price", dir: "asc" },
      );
      expect(buyRows.map((r) => r.price)).toEqual([100, 101, 102]);
    });

    it("(volume, asc): small → large", () => {
      const trades = [
        mkTrade("A", 100, 10, 0),
        mkTrade("B", 102, 5, 0),
        mkTrade("C", 101, 20, 0),
      ];
      const { buyRows } = buildTradeRows(
        trades, new Set<string>(), 10,
        { key: "volume", dir: "asc" },
      );
      expect(buyRows.map((r) => r.volume)).toEqual([5, 10, 20]);
    });

    it("sellSort independent of buySort", () => {
      const trades = [
        mkTrade("A", 100, 10, 50),
        mkTrade("B", 102, 5, 30),
        mkTrade("C", 101, 20, 10),
      ];
      const { buyRows, sellRows } = buildTradeRows(
        trades, new Set<string>(), 10,
        { key: "volume", dir: "desc" },   // buyRows: by vol desc
        { key: "price", dir: "asc" },     // sellRows: by price asc
      );
      expect(buyRows.map((r) => r.volume)).toEqual([20, 10, 5]);
      expect(sellRows.map((r) => r.price)).toEqual([100, 101, 102]);
    });

    it("tie-break by broker asc for stability when sort key is tied", () => {
      const trades = [
        mkTrade("C", 100, 10, 0),
        mkTrade("A", 100, 10, 0),
        mkTrade("B", 100, 10, 0),
      ];
      const { buyRows } = buildTradeRows(
        trades, new Set<string>(), 10,
        { key: "volume", dir: "desc" },
      );
      expect(buyRows.map((r) => r.broker)).toEqual(["A", "B", "C"]);
    });
  });

  // C6 A3 (🟢): 分點總買/賣張/金額 pure helper。
});

describe("computeBrokerTotals (C6 🟢)", () => {
  const mk = (broker_id: string, price: number, buy: number, sell: number): BrokerTrade =>
    ({ broker: broker_id, broker_id, price, buy, sell });

  it("empty selection: returns all zeros", () => {
    const r = computeBrokerTotals([mk("A", 100, 10, 0)], new Set<string>());
    expect(r).toEqual({ buyLots: 0, sellLots: 0, buyAmount: 0, sellAmount: 0 });
  });

  it("brokerId not in trades: returns all zeros", () => {
    const r = computeBrokerTotals([mk("A", 100, 10, 0)], new Set(["Z"]));
    expect(r).toEqual({ buyLots: 0, sellLots: 0, buyAmount: 0, sellAmount: 0 });
  });

  it("single-price single broker: exact amount = buy × 1000 × price", () => {
    const r = computeBrokerTotals([mk("A", 100, 5, 0)], new Set(["A"]));
    expect(r.buyLots).toBe(5);
    expect(r.sellLots).toBe(0);
    expect(r.buyAmount).toBe(500_000); // 5 × 1000 × 100
    expect(r.sellAmount).toBe(0);
  });

  it("multi-price single broker: sums buyLots + buyAmount across prices", () => {
    const trades: BrokerTrade[] = [
      mk("A", 100, 5, 0),   // 500,000
      mk("A", 102, 3, 0),   // 306,000
      mk("A", 101, 0, 4),   // 404,000 (sell)
    ];
    const r = computeBrokerTotals(trades, new Set(["A"]));
    expect(r.buyLots).toBe(8);
    expect(r.sellLots).toBe(4);
    expect(r.buyAmount).toBe(806_000);
    expect(r.sellAmount).toBe(404_000);
  });

  it("filters by broker_id: does NOT sum other brokers even at same price", () => {
    const trades: BrokerTrade[] = [
      mk("A", 100, 10, 0),
      mk("B", 100, 999, 999),
    ];
    const r = computeBrokerTotals(trades, new Set(["A"]));
    expect(r.buyLots).toBe(10);
    expect(r.buyAmount).toBe(1_000_000);
    expect(r.sellLots).toBe(0);
  });

  it("empty trades: returns all zeros", () => {
    expect(computeBrokerTotals([], new Set(["A"]))).toEqual({
      buyLots: 0, sellLots: 0, buyAmount: 0, sellAmount: 0,
    });
  });

  // SC-4(bubble-multi-broker):多選分點的合併統計 — header 買賣張/額為
  // 所有選中分點加總;未知 id 混入只計已知(選中分點可能已自 trades 消失)。
  it("multi-id selection: sums lots and amounts across every selected broker", () => {
    const trades: BrokerTrade[] = [
      mk("A", 100, 5, 0),   // buy 500,000
      mk("B", 200, 3, 2),   // buy 600,000 / sell 400,000
      mk("C", 100, 999, 999), // 未選中,不計
    ];
    const r = computeBrokerTotals(trades, new Set(["A", "B"]));
    expect(r.buyLots).toBe(8);
    expect(r.sellLots).toBe(2);
    expect(r.buyAmount).toBe(1_100_000);
    expect(r.sellAmount).toBe(400_000);
  });

  it("multi-id selection with an unknown id: counts only the known ones", () => {
    const r = computeBrokerTotals([mk("A", 100, 5, 0)], new Set(["A", "GONE"]));
    expect(r.buyLots).toBe(5);
    expect(r.buyAmount).toBe(500_000);
  });
});

describe("fmtAmount (C6 🟢)", () => {
  it("< 10,000: renders as `X,XXX 元`", () => {
    expect(fmtAmount(1234)).toBe("1,234 元");
    expect(fmtAmount(999)).toBe("999 元");
    expect(fmtAmount(0)).toBe("0 元");
  });

  it("10,000 ~ 100,000,000: renders as `X,XXX 萬` (integer 萬)", () => {
    expect(fmtAmount(10_000)).toBe("1 萬");
    expect(fmtAmount(50_000)).toBe("5 萬");
    expect(fmtAmount(10_000_000)).toBe("1,000 萬");
    expect(fmtAmount(99_999_999)).toBe("9,999 萬"); // < 億 cutoff (floor 9999.99…)
  });

  it(">= 100,000,000: renders as `X.XX 億` (2-decimal for tabular-nums alignment)", () => {
    expect(fmtAmount(100_000_000)).toBe("1.00 億");
    expect(fmtAmount(120_000_000)).toBe("1.20 億");
    expect(fmtAmount(105_000_000)).toBe("1.05 億");
    expect(fmtAmount(1_234_500_000)).toBe("12.35 億"); // rounded 2dp
  });
});

describe("summarizeTradesByPriceRange (C7 🟢)", () => {
  const mk = (broker_id: string, price: number, buy: number, sell: number): BrokerTrade =>
    ({ broker: broker_id, broker_id, price, buy, sell });

  it("empty trades: zeros + empty brokerIds", () => {
    const r = summarizeTradesByPriceRange([], 100, 105);
    expect(r).toEqual({
      priceMin: 100, priceMax: 105,
      priceLevelCount: 0, brokerIds: [], buyLots: 0, sellLots: 0,
    });
  });

  it("range covers 3 prices × 2 brokers: distinct count + sum", () => {
    const trades: BrokerTrade[] = [
      mk("A", 100, 10, 0),
      mk("A", 101, 5, 0),
      mk("B", 101, 0, 8),
      mk("B", 102, 3, 0),
      mk("C", 110, 999, 999), // outside range
    ];
    const r = summarizeTradesByPriceRange(trades, 100, 102);
    expect(r.priceLevelCount).toBe(3);       // 100, 101, 102
    expect(r.brokerIds.sort()).toEqual(["A", "B"]);
    expect(r.buyLots).toBe(18);              // 10+5+0+3
    expect(r.sellLots).toBe(8);
  });

  it("range fully below or above all trades: empty summary", () => {
    const trades: BrokerTrade[] = [mk("A", 100, 10, 0)];
    const rBelow = summarizeTradesByPriceRange(trades, 50, 60);
    expect(rBelow.priceLevelCount).toBe(0);
    expect(rBelow.brokerIds).toEqual([]);
    const rAbove = summarizeTradesByPriceRange(trades, 200, 300);
    expect(rAbove.priceLevelCount).toBe(0);
  });

  it("range inclusive on both ends", () => {
    const trades: BrokerTrade[] = [
      mk("A", 100, 1, 0),
      mk("B", 105, 2, 0),
    ];
    const r = summarizeTradesByPriceRange(trades, 100, 105);
    expect(r.brokerIds.sort()).toEqual(["A", "B"]);
    expect(r.buyLots).toBe(3);
  });
});

describe("buildTradeRows — id-based filter(bubble-multi-broker)", () => {
  // 該變 assertion(原 C1 R3 name-based 已翻案):選取契約改以 broker_id 為
  // key(收割 next-time.md deferred 項)— 同名不同 id 是不同分點,單選一個 id
  // 不再吸入同名它行;要合併就把兩個 id 都放進集合。
  describe("same broker_name across different broker_id", () => {
    const trades: BrokerTrade[] = [
      { broker: "凱基-台北", broker_id: "9800", price: 100, buy: 50, sell: 0 },
      { broker: "凱基-台北", broker_id: "9801", price: 101, buy: 30, sell: 0 },
      { broker: "永豐-台北", broker_id: "9200", price: 100, buy: 20, sell: 0 },
    ];

    it("filter is id-based: one id selects only that id's rows despite name collision", () => {
      const { buyRows } = buildTradeRows(trades, new Set(["9800"]), 10);
      expect(buyRows).toHaveLength(1);
      expect(buyRows[0]).toEqual({ broker: "凱基-台北", volume: 50, price: 100 });
    });

    it("selecting both colliding ids merges their rows", () => {
      const { buyRows } = buildTradeRows(trades, new Set(["9800", "9801"]), 10);
      expect(buyRows.map((r) => r.volume).sort((a, b) => b - a)).toEqual([50, 30]);
    });
  });

  // SC-4:多選集合過濾 — 明細合併涵蓋所有選中分點、排除未選;filter 先於
  // top-N cap(沿用單選時代的 bug fix 語意)。
  it("multi-id selection merges rows from every selected broker and excludes others", () => {
    const trades: BrokerTrade[] = [
      { broker: "甲", broker_id: "A", price: 100, buy: 5, sell: 1 },
      { broker: "乙", broker_id: "B", price: 101, buy: 0, sell: 7 },
      { broker: "丙", broker_id: "C", price: 102, buy: 999, sell: 999 },
    ];
    const { buyRows, sellRows } = buildTradeRows(trades, new Set(["A", "B"]), 10);
    expect(buyRows).toEqual([{ broker: "甲", volume: 5, price: 100 }]);
    expect(sellRows.map((r) => r.broker).sort()).toEqual(["乙", "甲"]);
  });

  it("multi-id filter applies before the top-N cap (small rows survive)", () => {
    const trades: BrokerTrade[] = [];
    for (let i = 0; i < 250; i++) {
      trades.push({ broker: `n${i}`, broker_id: `n${i}`, price: 200 + i, buy: 999, sell: 0 });
    }
    trades.push({ broker: "小甲", broker_id: "SA", price: 100, buy: 1, sell: 0 });
    trades.push({ broker: "小乙", broker_id: "SB", price: 101, buy: 2, sell: 0 });
    const { buyRows } = buildTradeRows(trades, new Set(["SA", "SB"]), 200);
    expect(buyRows.map((r) => r.volume).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
