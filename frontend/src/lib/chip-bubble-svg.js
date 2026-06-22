import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Butterfly (mirror) bubble chart: sell bubbles left, buy bubbles right.
// Pure functions exported for testing; component uses automatic JSX transform.
import { memo, useCallback, useMemo, useRef } from "react";
import { CHIP } from "./chip-theme";
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/** Map volume to a circle radius between minR and maxR (sqrt scale). */
export function bubbleRadius(volume, maxVolume, minR, maxR) {
    if (maxVolume <= 0 || volume <= 0)
        return minR;
    const t = Math.sqrt(volume / maxVolume); // sqrt so area is proportional
    return minR + t * (maxR - minR);
}
// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const PADDING = { top: 12, right: 16, bottom: 32, left: 56 };
const FONT = CHIP.font;
const COLOR = {
    buyFill: "rgba(232, 90, 79, 0.45)",
    buyStroke: CHIP.bull,
    sellFill: "rgba(127, 201, 154, 0.4)",
    sellStroke: CHIP.bear,
    grid: CHIP.line,
    text: CHIP.inkDim,
    closeLine: "rgba(232, 90, 79, 0.5)",
    centerLine: CHIP.lineStrong,
};
const MIN_R = 3;
const MAX_R = 22;
const VOLUME_THRESHOLD = 5; // ignore volumes <= 5
export const BubbleChartSvg = memo(function BubbleChartSvg({ trades, width, height, closePrice, selectedBroker, onBubbleHover, onBubbleClick, }) {
    // --- All hooks MUST be called before any conditional return ---
    const layoutTrades = useMemo(() => {
        if (trades.length <= 100)
            return trades;
        return [...trades]
            .sort((a, b) => Math.max(b.buy, b.sell) - Math.max(a.buy, a.sell))
            .slice(0, 100);
    }, [trades]);
    const bubblesRef = useRef([]);
    const rafId = useRef(0);
    const hitTest = useCallback((clientX, clientY, svgRect) => {
        const mx = clientX - svgRect.left;
        const my = clientY - svgRect.top;
        let nearest = null;
        let minDist = Infinity;
        for (const b of bubblesRef.current) {
            const dx = mx - b.cx;
            const dy = my - b.cy;
            const distSq = dx * dx + dy * dy;
            if (distSq <= b.r * b.r && distSq < minDist) {
                nearest = b;
                minDist = distSq;
            }
        }
        return nearest;
    }, []);
    const handleMouseMove = useCallback((e) => {
        const clientX = e.clientX;
        const clientY = e.clientY;
        const svg = e.currentTarget.ownerSVGElement;
        const svgRect = svg?.getBoundingClientRect();
        if (!svgRect)
            return;
        if (rafId.current)
            cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
            rafId.current = 0;
            const hit = hitTest(clientX, clientY, svgRect);
            if (hit) {
                onBubbleHover?.(hit.payload, clientX, clientY);
            }
            else {
                onBubbleHover?.(null, 0, 0);
            }
        });
    }, [hitTest, onBubbleHover]);
    const handleMouseLeave = useCallback(() => {
        if (rafId.current)
            cancelAnimationFrame(rafId.current);
        rafId.current = 0;
        onBubbleHover?.(null, 0, 0);
    }, [onBubbleHover]);
    const handleClick = useCallback((e) => {
        const svg = e.currentTarget.ownerSVGElement;
        const svgRect = svg?.getBoundingClientRect();
        if (!svgRect)
            return;
        const hit = hitTest(e.clientX, e.clientY, svgRect);
        onBubbleClick?.(hit ? hit.payload.broker : null);
    }, [hitTest, onBubbleClick]);
    // --- End hooks section ---
    if (layoutTrades.length === 0) {
        return (_jsx("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, style: { fontFamily: FONT }, children: _jsx("text", { x: width / 2, y: height / 2, textAnchor: "middle", fill: COLOR.text, fontSize: 13, children: "No trade data" }) }));
    }
    // -- Derive data ranges from ALL trades (stable axes) --------------------
    const prices = [];
    const volumes = [];
    for (const t of layoutTrades) {
        prices.push(t.price);
        if (t.buy > VOLUME_THRESHOLD)
            volumes.push(t.buy);
        if (t.sell > VOLUME_THRESHOLD)
            volumes.push(t.sell);
    }
    if (volumes.length === 0) {
        return (_jsx("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, style: { fontFamily: FONT }, children: _jsx("text", { x: width / 2, y: height / 2, textAnchor: "middle", fill: COLOR.text, fontSize: 13, children: "No significant volume" }) }));
    }
    // -- Visible trades (filtered by selected broker) ------------------------
    // Use ALL trades when filtering so brokers outside the top-100 still appear
    const visibleTrades = selectedBroker
        ? trades.filter((t) => t.broker === selectedBroker)
        : layoutTrades;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const maxVolume = Math.max(...volumes);
    // Add a small padding to price range so bubbles don't touch edges
    const pricePad = maxPrice === minPrice ? 1 : (maxPrice - minPrice) * 0.08;
    const yLow = minPrice - pricePad;
    const yHigh = maxPrice + pricePad;
    // Chart inner area
    const cW = width - PADDING.left - PADDING.right;
    const cH = height - PADDING.top - PADDING.bottom;
    const halfW = cW / 2;
    const centerX = PADDING.left + halfW;
    // Scale function: price -> y pixel
    const sY = (price) => PADDING.top + ((yHigh - price) / (yHigh - yLow)) * cH;
    // -- Price tick levels ---------------------------------------------------
    const priceSet = [...new Set(prices)].sort((a, b) => a - b);
    let priceTicks;
    if (priceSet.length <= 8) {
        priceTicks = priceSet;
    }
    else {
        const step = Math.ceil(priceSet.length / 7);
        priceTicks = priceSet.filter((_, i) => i % step === 0);
        if (priceTicks[priceTicks.length - 1] !== priceSet[priceSet.length - 1]) {
            priceTicks.push(priceSet[priceSet.length - 1]);
        }
    }
    // -- Volume tick levels (mirrored on both sides) -------------------------
    const volStep = niceStep(maxVolume, 4);
    const volTicks = [];
    for (let v = volStep; v <= maxVolume; v += volStep) {
        volTicks.push(v);
    }
    if (volTicks.length === 0 || volTicks[volTicks.length - 1] < maxVolume) {
        volTicks.push((volTicks.length === 0 ? 0 : volTicks[volTicks.length - 1]) + volStep);
    }
    const volMax = volTicks[volTicks.length - 1];
    // -- Build bubble data (butterfly: sell left, buy right) -----------------
    const bubbles = [];
    let idx = 0;
    for (const t of visibleTrades) {
        const isSel = selectedBroker != null && t.broker === selectedBroker;
        if (t.buy > VOLUME_THRESHOLD) {
            bubbles.push({
                cx: centerX + (t.buy / volMax) * halfW,
                cy: sY(t.price),
                r: bubbleRadius(t.buy, maxVolume, MIN_R, MAX_R),
                fill: COLOR.buyFill,
                stroke: isSel ? CHIP.ma5 : COLOR.buyStroke,
                key: `b-${t.broker_id}-${t.price}-${idx}`,
                payload: { broker: t.broker, volume: t.buy, price: t.price, side: "buy" },
            });
        }
        if (t.sell > VOLUME_THRESHOLD) {
            bubbles.push({
                cx: centerX - (t.sell / volMax) * halfW,
                cy: sY(t.price),
                r: bubbleRadius(t.sell, maxVolume, MIN_R, MAX_R),
                fill: COLOR.sellFill,
                stroke: isSel ? CHIP.ma5 : COLOR.sellStroke,
                key: `s-${t.broker_id}-${t.price}-${idx}`,
                payload: { broker: t.broker, volume: t.sell, price: t.price, side: "sell" },
            });
        }
        idx++;
    }
    bubblesRef.current = bubbles;
    return (_jsxs("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, style: { fontFamily: FONT }, children: [priceTicks.map((p) => (_jsx("line", { x1: PADDING.left, x2: width - PADDING.right, y1: sY(p), y2: sY(p), stroke: COLOR.grid, strokeWidth: 1 }, `g-${p}`))), _jsx("line", { x1: centerX, x2: centerX, y1: PADDING.top, y2: height - PADDING.bottom, stroke: COLOR.centerLine, strokeWidth: 1 }), priceTicks.map((p) => (_jsx("text", { x: PADDING.left - 6, y: sY(p) + 4, textAnchor: "end", fill: COLOR.text, fontSize: 11, children: p }, `yl-${p}`))), volTicks.map((v) => {
                const offset = (v / volMax) * halfW;
                return (_jsxs("g", { children: [_jsx("text", { x: centerX - offset, y: height - PADDING.bottom + 16, textAnchor: "middle", fill: COLOR.text, fontSize: 11, children: v }), _jsx("text", { x: centerX + offset, y: height - PADDING.bottom + 16, textAnchor: "middle", fill: COLOR.text, fontSize: 11, children: v })] }, `xl-${v}`));
            }), closePrice != null && closePrice >= yLow && closePrice <= yHigh && (_jsx("line", { x1: PADDING.left, x2: width - PADDING.right, y1: sY(closePrice), y2: sY(closePrice), stroke: COLOR.closeLine, strokeWidth: 1, strokeDasharray: "6 4" })), bubbles.map((b) => {
                const isSel = b.stroke === CHIP.ma5;
                return (_jsx("circle", { cx: b.cx, cy: b.cy, r: b.r, fill: b.fill, stroke: b.stroke, strokeWidth: isSel ? 2 : 1, pointerEvents: "none" }, b.key));
            }), _jsx("rect", { x: 0, y: 0, width: width, height: height, fill: "transparent", onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave, onClick: handleClick, style: { cursor: "pointer" } })] }));
});
// ---------------------------------------------------------------------------
// Utility: compute a "nice" step for axis ticks
// ---------------------------------------------------------------------------
function niceStep(range, targetTicks) {
    if (range <= 0)
        return 1;
    const raw = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let nice;
    if (norm <= 1.5)
        nice = 1;
    else if (norm <= 3)
        nice = 2;
    else if (norm <= 7)
        nice = 5;
    else
        nice = 10;
    return nice * mag;
}
