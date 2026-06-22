// Types and data-transform functions for chip (籌碼) data.
export function splitBrokers(brokers) {
    const buyers = brokers.filter((b) => b.net > 0).sort((a, b) => b.net - a.net);
    const sellers = brokers
        .filter((b) => b.net < 0)
        .sort((a, b) => a.net - b.net);
    return { buyers, sellers };
}
export function aggregateByBroker(trades) {
    const map = new Map();
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
export function fmtVol(n) {
    return n.toLocaleString();
}
export function aggregateByPrice(trades) {
    const map = new Map();
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
/**
 * Rank brokers by (buy + sell) descending, top 15.
 * daytradeRate = min(buy, sell) / max(buy, sell), but only when:
 *   - dayTotalLots > 0
 *   - broker total ≥ 1% of dayTotalLots
 *   - max(buy, sell) > 0
 * Otherwise null (UI displays "—").
 */
export function topByVolume(brokers, dayTotalLots) {
    const threshold = dayTotalLots > 0
        ? Math.max(1, Math.floor(dayTotalLots * 0.01))
        : Infinity;
    return brokers
        .map((b) => {
        const total = b.buy + b.sell;
        const maxAbs = Math.max(b.buy, b.sell);
        const daytradeRate = dayTotalLots > 0 && total >= threshold && maxAbs > 0
            ? Math.min(b.buy, b.sell) / maxAbs
            : null;
        return { ...b, total, daytradeRate };
    })
        .sort((a, b) => b.total - a.total)
        .slice(0, 15);
}
