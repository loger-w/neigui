import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SymbolSearch } from "./components/SymbolSearch";
import { ChipBrokersPanel } from "./components/ChipBrokersPanel";
import { ChipKlineChart } from "./components/ChipKlineChart";
import { useChipData } from "./hooks/useChipData";
import { useChipBubble } from "./hooks/useChipBubble";
const ChipBubbleView = lazy(() => import("./components/ChipBubbleView").then((m) => ({ default: m.ChipBubbleView })));
function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
export default function App() {
    const [symbol, setSymbol] = useState("");
    const [symbolName, setSymbolName] = useState(null);
    const [date, setDate] = useState(todayStr);
    const [tab, setTab] = useState("overview");
    const [selectedBrokerIds, setSelectedBrokerIds] = useState(() => new Set());
    const userPickedDate = useRef(false);
    const { summary, history, loading, error, refresh: refreshChip } = useChipData(symbol, date);
    const bubbleHook = useChipBubble(symbol, date);
    useEffect(() => {
        if (userPickedDate.current)
            return;
        if (!history?.candles?.length)
            return;
        const lastCandleDate = history.candles[history.candles.length - 1].date;
        if (lastCandleDate < date) {
            setDate(lastCandleDate);
        }
    }, [history, date]);
    const dayTotalLots = useMemo(() => {
        if (!summary?.date)
            return 0;
        const c = history?.candles.find((c) => c.date === summary.date);
        if (c)
            return c.volume;
        return summary.top_brokers.reduce((s, b) => s + b.buy + b.sell, 0);
    }, [history, summary]);
    const handlePickDate = useCallback((d) => {
        if (d === date)
            return;
        const lastCandle = history?.candles?.[history.candles.length - 1];
        userPickedDate.current = lastCandle ? d !== lastCandle.date : true;
        setDate(d);
    }, [date, history]);
    const handleToggleBroker = useCallback((id, _name) => {
        setSelectedBrokerIds((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }, []);
    const handleClearAllBrokers = useCallback(() => {
        setSelectedBrokerIds(new Set());
    }, []);
    const refresh = () => {
        refreshChip();
        if (tab === "bubble")
            bubbleHook.refresh();
    };
    const isLoading = loading || bubbleHook.loading;
    const handlePick = (sym, name) => {
        setSymbol(sym);
        setSymbolName(name);
        setSelectedBrokerIds(new Set());
        userPickedDate.current = false;
    };
    const closePrice = useMemo(() => {
        const c = history?.candles.find((c) => c.date === date);
        return c?.close ?? history?.candles?.[history.candles.length - 1]?.close;
    }, [history, date]);
    return (_jsxs("div", { className: "h-full flex flex-col overflow-hidden", children: [_jsxs("header", { className: "shrink-0 px-6 pt-5 pb-3 border-b border-line", children: [_jsx("div", { className: "flex items-center justify-between mb-3", children: _jsx("h1", { className: "text-2xl text-ink font-semibold", children: "\u7C4C\u78BC\u5206\u6790" }) }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-[220px]", children: _jsx(SymbolSearch, { onPick: handlePick }) }), symbol && (_jsxs("div", { className: "flex items-baseline gap-1.5 text-sm", children: [_jsx("span", { className: "text-ink font-medium", children: symbol }), symbolName && _jsx("span", { className: "text-ink-muted", children: symbolName })] })), _jsx("input", { type: "date", value: date, onChange: (e) => { userPickedDate.current = true; setDate(e.target.value); }, className: "bg-bg-deep border border-line text-ink px-2.5 py-1.5 text-sm outline-none focus:border-accent tabular-nums" }), _jsx("button", { type: "button", onClick: refresh, disabled: isLoading || !symbol, className: "px-3 py-1.5 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-40 disabled:cursor-default transition-colors cursor-pointer", children: isLoading ? "載入中..." : "重新整理" })] }), _jsxs("div", { className: "flex mt-3 gap-0 border-b border-line -mb-[1px]", children: [_jsx("button", { type: "button", onClick: () => setTab("overview"), className: `px-4 py-2 text-sm transition-colors cursor-pointer ${tab === "overview"
                                    ? "text-accent border-b-2 border-accent font-medium"
                                    : "text-ink-dim hover:text-ink"}`, children: "\u7C4C\u78BC\u7E3D\u89BD" }), _jsx("button", { type: "button", onClick: () => setTab("bubble"), className: `px-4 py-2 text-sm transition-colors cursor-pointer ${tab === "bubble"
                                    ? "text-accent border-b-2 border-accent font-medium"
                                    : "text-ink-dim hover:text-ink"}`, children: "\u6CE1\u6CE1\u5716" })] })] }), (error || bubbleHook.error) && (_jsx("div", { className: "shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line", children: error || bubbleHook.error })), _jsxs("div", { className: "flex-1 min-h-0 overflow-hidden", children: [_jsx("div", { hidden: tab !== "overview", className: "h-full", children: _jsxs("div", { className: "h-full grid grid-cols-[1fr_420px] overflow-hidden", children: [_jsx("div", { className: "h-full overflow-hidden border-r border-line", children: _jsx(ChipKlineChart, { history: history, symbol: symbol, selectedDate: date, selectedBrokerIds: selectedBrokerIds, onPickDate: handlePickDate, onClearAllBrokers: handleClearAllBrokers }) }), _jsx("div", { className: "h-full overflow-hidden", children: _jsx(ChipBrokersPanel, { summary: summary, dayTotalLots: dayTotalLots, selectedBrokerIds: selectedBrokerIds, onToggleBroker: handleToggleBroker, onClearAllBrokers: handleClearAllBrokers }) })] }) }), _jsx("div", { hidden: tab !== "bubble", className: "h-full", children: _jsx(Suspense, { fallback: _jsx("div", { className: "h-full flex items-center justify-center text-ink-dim text-sm", children: "\u8F09\u5165\u6CE1\u6CE1\u5716\u5143\u4EF6..." }), children: _jsx(ChipBubbleView, { symbol: symbol, bubbleData: bubbleHook.data, closePrice: closePrice }) }) })] })] }));
}
