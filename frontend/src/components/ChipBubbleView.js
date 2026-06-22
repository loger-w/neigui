import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { aggregateByPrice, fmtVol } from "../lib/chip-data";
import { BubbleChartSvg } from "../lib/chip-bubble-svg";
import { PriceBarSvg } from "../lib/chip-price-bar-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { BrokerSearch } from "./BrokerSearch";
const MAX_TRADE_ROWS = 200;
export function ChipBubbleView({ bubbleData, closePrice, symbol }) {
    const [selectedBroker, setSelectedBroker] = useState(null);
    // Reset selection ONLY on symbol change (NOT on date / bubbleData change)
    useEffect(() => {
        setSelectedBroker(null);
    }, [symbol]);
    const uniqueBrokerCount = useMemo(() => new Set(bubbleData?.trades.map((t) => t.broker) ?? []).size, [bubbleData]);
    const bubbleRef = useRef(null);
    const priceBarRef = useRef(null);
    const tooltipRef = useRef(null);
    const bubbleSize = useContainerSize(bubbleRef);
    const priceBarSize = useContainerSize(priceBarRef);
    const handleBubbleHover = useCallback((payload, x, y) => {
        const el = tooltipRef.current;
        if (!el)
            return;
        if (!payload) {
            el.hidden = true;
            return;
        }
        el.hidden = false;
        el.style.left = `${Math.min(x + 12, window.innerWidth - 200)}px`;
        el.style.top = `${Math.min(y - 10, window.innerHeight - 100)}px`;
        const nameEl = el.querySelector("[data-tt=name]");
        const detailEl = el.querySelector("[data-tt=detail]");
        const priceEl = el.querySelector("[data-tt=price]");
        if (nameEl)
            nameEl.textContent = payload.broker;
        if (detailEl)
            detailEl.textContent = `${payload.side === "buy" ? "買" : "賣"}: ${payload.volume} 張`;
        if (priceEl)
            priceEl.textContent = `價格: ${payload.price}`;
    }, []);
    const handleBubbleClick = useCallback((broker) => {
        if (broker === null) {
            setSelectedBroker(null);
        }
        else {
            setSelectedBroker((prev) => (prev === broker ? null : broker));
        }
    }, []);
    const allPriceAggs = useMemo(() => {
        if (!bubbleData)
            return [];
        return aggregateByPrice(bubbleData.trades);
    }, [bubbleData]);
    const priceAggs = useMemo(() => {
        if (!bubbleData || !selectedBroker)
            return allPriceAggs;
        const filtered = bubbleData.trades.filter((t) => t.broker === selectedBroker);
        if (filtered.length === 0)
            return allPriceAggs;
        const filteredAggs = aggregateByPrice(filtered);
        const filteredPrices = new Set(filteredAggs.map((a) => a.price));
        return allPriceAggs.map((a) => filteredPrices.has(a.price)
            ? filteredAggs.find((f) => f.price === a.price)
            : { price: a.price, buy: 0, sell: 0 });
    }, [bubbleData, selectedBroker, allPriceAggs]);
    const { buyRows, sellRows } = useMemo(() => {
        if (!bubbleData)
            return { buyRows: [], sellRows: [] };
        const b = [];
        const s = [];
        for (const t of bubbleData.trades) {
            if (t.buy > 0)
                b.push({ broker: t.broker, volume: t.buy, price: t.price });
            if (t.sell > 0)
                s.push({ broker: t.broker, volume: t.sell, price: t.price });
        }
        b.sort((a, c) => c.volume - a.volume);
        s.sort((a, c) => c.volume - a.volume);
        return { buyRows: b.slice(0, MAX_TRADE_ROWS), sellRows: s.slice(0, MAX_TRADE_ROWS) };
    }, [bubbleData]);
    const filteredBuyRows = useMemo(() => {
        if (!selectedBroker)
            return buyRows;
        return buyRows.filter((r) => r.broker === selectedBroker);
    }, [buyRows, selectedBroker]);
    const filteredSellRows = useMemo(() => {
        if (!selectedBroker)
            return sellRows;
        return sellRows.filter((r) => r.broker === selectedBroker);
    }, [sellRows, selectedBroker]);
    return (_jsxs("div", { className: "h-full grid grid-cols-[1fr_400px] gap-0 overflow-hidden", children: [_jsxs("div", { className: "h-full flex flex-col min-h-0 border-r border-line overflow-hidden", children: [_jsxs("div", { className: "shrink-0 h-10 px-3 border-b border-line bg-bg-deep/30 flex items-center gap-3", children: [_jsx(BrokerSearch, { trades: bubbleData?.trades ?? [], value: selectedBroker, onChange: setSelectedBroker }), _jsx("span", { className: "text-xs text-ink-dim", children: selectedBroker ? (_jsxs(_Fragment, { children: ["\u5DF2\u7BE9\u9078 ", _jsx("span", { className: "text-[#f0b429] font-medium", children: "1" }), " \u500B\u5206\u9EDE"] })) : (_jsxs(_Fragment, { children: ["\u4ECA\u65E5\u5171 ", _jsx("span", { className: "text-[#b794f4] font-medium", children: uniqueBrokerCount }), " \u500B\u5206\u9EDE"] })) })] }), _jsx("div", { ref: bubbleRef, className: "flex-1 min-h-0 overflow-hidden", children: !bubbleData ? (_jsx("div", { className: "h-full flex items-center justify-center text-ink-dim font-serif italic text-sm", children: "\u8ACB\u641C\u5C0B\u80A1\u7968\u4EE3\u865F\u4EE5\u8F09\u5165\u6CE1\u6CE1\u5716" })) : bubbleSize.width > 0 && bubbleSize.height > 0 ? (_jsx(BubbleChartSvg, { trades: bubbleData.trades, width: bubbleSize.width, height: bubbleSize.height, closePrice: closePrice, selectedBroker: selectedBroker, onBubbleHover: handleBubbleHover, onBubbleClick: handleBubbleClick })) : null })] }), _jsxs("div", { className: "h-full flex flex-col overflow-hidden", children: [_jsx("div", { ref: priceBarRef, className: "h-[180px] shrink-0 border-b border-line", children: priceBarSize.width > 0 && priceAggs.length > 0 && (_jsx(PriceBarSvg, { data: priceAggs, width: priceBarSize.width, height: 180 })) }), _jsxs("div", { className: "flex-1 min-h-0 grid grid-cols-2 divide-x divide-line", children: [_jsx(TradeList, { rows: filteredBuyRows, side: "buy", selectedBroker: selectedBroker, onSelect: handleBubbleClick }), _jsx(TradeList, { rows: filteredSellRows, side: "sell", selectedBroker: selectedBroker, onSelect: handleBubbleClick })] })] }), _jsxs("div", { ref: tooltipRef, hidden: true, style: {
                    position: "fixed",
                    background: "#1d1812",
                    border: "1px solid #4a4234",
                    color: "#ede4d3",
                    fontFamily: '"Inter Tight", system-ui, sans-serif',
                    fontSize: 13,
                    padding: "8px 12px",
                    borderRadius: 6,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    pointerEvents: "none",
                    zIndex: 50,
                    whiteSpace: "nowrap",
                    lineHeight: 1.5,
                }, children: [_jsx("div", { "data-tt": "name", style: { fontWeight: 600 } }), _jsx("div", { "data-tt": "detail" }), _jsx("div", { "data-tt": "price" })] })] }));
}
const TradeList = memo(function TradeList({ rows, side, selectedBroker, onSelect, }) {
    const isBuy = side === "buy";
    const colorClass = isBuy ? "text-accent" : "text-bear";
    const bgClass = isBuy ? "bg-accent/[0.04]" : "bg-bear/[0.04]";
    const activeClass = isBuy ? "bg-accent/[0.08]" : "bg-bear/[0.08]";
    return (_jsxs("div", { className: "flex flex-col overflow-hidden", children: [_jsxs("div", { className: `shrink-0 px-2 py-1.5 text-sm ${colorClass} ${bgClass} border-b border-line font-medium grid grid-cols-[1fr_56px_56px]`, children: [_jsx("span", { children: "\u5206\u9EDE" }), _jsx("span", { className: "text-right", children: "\u5F35\u6578" }), _jsx("span", { className: "text-right", children: "\u50F9\u4F4D" })] }), _jsx("div", { className: "flex-1 overflow-y-auto min-h-0 scroll-editorial", children: rows.map((r, i) => (_jsxs("button", { type: "button", onClick: () => onSelect(r.broker), className: `w-full grid grid-cols-[1fr_56px_56px] text-xs px-2 py-1 border-b border-line/20 cursor-pointer transition-colors ${selectedBroker === r.broker
                        ? `${activeClass} text-ink`
                        : "hover:bg-bg-deep/50 text-ink-muted"}`, children: [_jsx("span", { className: "text-left truncate", children: r.broker }), _jsx("span", { className: `text-right tabular-nums ${colorClass}`, children: fmtVol(r.volume) }), _jsx("span", { className: "text-right tabular-nums", children: r.price })] }, `${side[0]}${i}`))) })] }));
});
