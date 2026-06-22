import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// 日K線圖(candlestick + MA + volume) — 籌碼頁用。
// 顏色 inline hex,不用 CSS var / Tailwind class。
import { memo } from "react";
import { CHIP } from "./chip-theme";
const CHIP_THEME = {
    bg: "#14110c",
    ...CHIP,
};
// ── exported layout constants (ChipKlineChart 需要算 hoverIndex) ────────────
export const KLINE_PAD_L = 12;
export const KLINE_PAD_R = 58;
// ── pure geometry (可單獨測試) ──────────────────────────────────────────────
/** 回傳 price→y 映射函式。padTop = chart area 頂部留白 px。 */
export function klineScaleY(minPrice, maxPrice, padTop, chartHeight) {
    const range = maxPrice - minPrice || 1;
    return (price) => padTop + (1 - (price - minPrice) / range) * chartHeight;
}
// ── MA 計算 ─────────────────────────────────────────────────────────────────
function calcMA(closes, period) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            result.push(null);
        }
        else {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++)
                sum += closes[j];
            result.push(sum / period);
        }
    }
    return result;
}
// ── format helpers ─────────────────────────────────────────────────────────
function fmtNum(v) {
    return v.toLocaleString("en-US");
}
function fmtPrice(v) {
    return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}
export const KlineChartSvg = memo(KlineChartSvgImpl);
function KlineChartSvgImpl({ candles, width, height, hoverIndex, onHoverIndex, selectedIndex, onClickIndex, }) {
    if (candles.length === 0)
        return null;
    const t = CHIP_THEME;
    // layout — labels on right side
    const padL = KLINE_PAD_L;
    const padR = KLINE_PAD_R;
    const padT = 40; // extra top for OHLCV info row (2x font)
    const padB = 6; // no date labels at bottom
    const volRatio = 0.2; // 成交量佔總高度的比例
    const volGap = 4;
    const chartH = height * (1 - volRatio) - padT - padB - volGap;
    const volH = height * volRatio;
    const volTop = height - volH;
    // price range (含 wick)
    let pMin = Infinity;
    let pMax = -Infinity;
    for (const c of candles) {
        if (c.low < pMin)
            pMin = c.low;
        if (c.high > pMax)
            pMax = c.high;
    }
    // MA 也要納入 range — 先算出來
    const closes = candles.map((c) => c.close);
    const ma5 = calcMA(closes, 5);
    const ma20 = calcMA(closes, 20);
    for (const v of ma5)
        if (v !== null) {
            if (v < pMin)
                pMin = v;
            if (v > pMax)
                pMax = v;
        }
    for (const v of ma20)
        if (v !== null) {
            if (v < pMin)
                pMin = v;
            if (v > pMax)
                pMax = v;
        }
    // 上下各加 2% 讓 wick 不貼邊
    const pPad = (pMax - pMin) * 0.02 || 1;
    pMin -= pPad;
    pMax += pPad;
    const yScale = klineScaleY(pMin, pMax, padT, chartH);
    // X scale — 每根 candle 等寬
    const n = candles.length;
    const xRange = width - padL - padR;
    const slotW = xRange / n;
    const bodyW = Math.max(1, slotW * 0.6);
    const xOf = (i) => padL + slotW * i + slotW / 2;
    // volume scale
    const maxVol = Math.max(1, ...candles.map((c) => c.volume));
    const volScaleY = (v) => volTop + (1 - v / maxVol) * volH;
    // ── grid lines ──────────────────────────────────────────────────────────
    const priceRange = pMax - pMin;
    const rawStep = priceRange / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const candidates = [1, 2, 5, 10, 20, 50];
    let gridStep = mag;
    for (const c of candidates) {
        if (c * mag >= rawStep) {
            gridStep = c * mag;
            break;
        }
    }
    const gridLines = [];
    const gridStart = Math.ceil(pMin / gridStep) * gridStep;
    for (let p = gridStart; p <= pMax; p += gridStep)
        gridLines.push(p);
    // ── MA polyline points ─────────────────────────────────────────────────
    const maLine = (arr) => {
        const segs = [];
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (v !== null)
                segs.push(`${xOf(i)},${yScale(v)}`);
        }
        return segs.join(" ");
    };
    // ── OHLCV info row ─────────────────────────────────────────────────────
    const infoIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < n
        ? hoverIndex
        : n - 1;
    const infoCandle = candles[infoIdx];
    const prevClose = infoIdx > 0 ? candles[infoIdx - 1].close : infoCandle.open;
    const change = infoCandle.close - prevClose;
    const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    const changeColor = change >= 0 ? t.bull : t.bear;
    const changeSign = change >= 0 ? "+" : "";
    const changeArrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
    // ── mouse interaction ──────────────────────────────────────────────────
    const handleMouseMove = (e) => {
        if (!onHoverIndex)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const idx = Math.floor((mouseX - padL) / slotW);
        if (idx >= 0 && idx < n) {
            onHoverIndex(idx);
        }
        else {
            onHoverIndex(null);
        }
    };
    const handleMouseLeave = () => {
        if (onHoverIndex)
            onHoverIndex(null);
    };
    const handleClick = (e) => {
        if (!onClickIndex)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const idx = Math.floor((mouseX - padL) / slotW);
        if (idx < 0 || idx >= n)
            return;
        onClickIndex(idx);
    };
    return (_jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${width} ${height}`, width: width, height: height, style: { background: t.bg }, children: [gridLines.map((p) => (_jsxs("g", { children: [_jsx("line", { x1: padL, y1: yScale(p), x2: width - padR, y2: yScale(p), stroke: t.line, strokeWidth: 0.5 }), _jsx("text", { x: width - padR + 4, y: yScale(p) + 4, textAnchor: "start", fill: t.inkDim, fontSize: 11, fontFamily: t.font, style: { fontVariantNumeric: "tabular-nums" }, children: fmtPrice(p) })] }, p))), _jsx("line", { x1: padL, y1: volTop - volGap / 2, x2: width - padR, y2: volTop - volGap / 2, stroke: t.line, strokeWidth: 0.5 }), candles.map((c, i) => {
                const x = xOf(i) - bodyW / 2;
                const y = volScaleY(c.volume);
                const h = height - y;
                const fill = c.close >= c.open ? t.bull : t.bear;
                const isHovered = hoverIndex != null && i === hoverIndex;
                return (_jsx("rect", { x: x, y: y, width: bodyW, height: Math.max(0, h), fill: fill, fillOpacity: isHovered ? 0.9 : 0.5 }, `v${i}`));
            }), candles.map((c, i) => {
                const x = xOf(i);
                const isUp = c.close >= c.open;
                const bodyTop = yScale(isUp ? c.close : c.open);
                const bodyBot = yScale(isUp ? c.open : c.close);
                const bodyH = Math.max(1, bodyBot - bodyTop);
                const color = isUp ? t.bull : t.bear;
                return (_jsxs("g", { children: [_jsx("line", { x1: x, y1: yScale(c.high), x2: x, y2: yScale(c.low), stroke: color, strokeWidth: 1 }), isUp ? (_jsx("rect", { x: x - bodyW / 2, y: bodyTop, width: bodyW, height: bodyH, fill: color })) : (_jsx("rect", { x: x - bodyW / 2, y: bodyTop, width: bodyW, height: bodyH, fill: t.bg, stroke: color, strokeWidth: 1 }))] }, `c${i}`));
            }), ma5.some((v) => v !== null) && (_jsx("polyline", { points: maLine(ma5), fill: "none", stroke: t.ma5, strokeWidth: 1.2, opacity: 0.85 })), ma20.some((v) => v !== null) && (_jsx("polyline", { points: maLine(ma20), fill: "none", stroke: t.ma20, strokeWidth: 1.2, opacity: 0.85 })), hoverIndex != null && hoverIndex >= 0 && hoverIndex < n && (_jsx("line", { x1: xOf(hoverIndex), y1: padT, x2: xOf(hoverIndex), y2: height, stroke: t.inkDim, strokeWidth: 1, strokeDasharray: "4 3" })), _jsxs("text", { y: padT - 6, fontSize: 22, fontFamily: t.font, style: { fontVariantNumeric: "tabular-nums" }, children: [_jsx("tspan", { x: padL + 4, fill: t.inkDim, children: infoCandle.date.replace(/-/g, "/") }), _jsx("tspan", { dx: 8, fill: t.inkDim, children: "\u958B" }), _jsx("tspan", { dx: 2, fill: t.ink, children: fmtPrice(infoCandle.open) }), _jsx("tspan", { dx: 8, fill: t.inkDim, children: "\u9AD8" }), _jsx("tspan", { dx: 2, fill: t.ink, children: fmtPrice(infoCandle.high) }), _jsx("tspan", { dx: 8, fill: t.inkDim, children: "\u4F4E" }), _jsx("tspan", { dx: 2, fill: t.ink, children: fmtPrice(infoCandle.low) }), _jsx("tspan", { dx: 8, fill: t.inkDim, children: "\u6536" }), _jsx("tspan", { dx: 2, fill: t.ink, children: fmtPrice(infoCandle.close) }), _jsxs("tspan", { dx: 8, fill: changeColor, children: [changeArrow, changeSign, fmtPrice(Math.abs(change))] }), _jsxs("tspan", { dx: 4, fill: changeColor, children: [changeSign, changePct.toFixed(2), "%"] }), _jsx("tspan", { dx: 8, fill: t.inkDim, children: "\u91CF" }), _jsxs("tspan", { dx: 2, fill: t.ink, children: [fmtNum(infoCandle.volume), " \u5F35"] })] }), _jsx("text", { x: padL + 4, y: padT + 14, fontSize: 20, fontFamily: t.font, fill: t.ma5, children: "MA5" }), _jsx("text", { x: padL + 44, y: padT + 14, fontSize: 20, fontFamily: t.font, fill: t.ma20, children: "MA20" }), selectedIndex != null && selectedIndex >= 0 && selectedIndex < n && (_jsxs("g", { "data-testid": "sel-cursor", children: [_jsx("line", { x1: xOf(selectedIndex), y1: 0, x2: xOf(selectedIndex), y2: height, stroke: t.ma5, strokeWidth: 2 }), _jsx("rect", { x: xOf(selectedIndex) + 4, y: 1, width: 72, height: 14, fill: t.bg, stroke: t.ma5, strokeWidth: 1 }), _jsx("text", { x: xOf(selectedIndex) + 8, y: 12, fontSize: 11, fill: t.ma5, fontFamily: t.font, children: candles[selectedIndex].date })] })), _jsx("rect", { "data-testid": "overlay", x: 0, y: 0, width: width, height: height, fill: "transparent", onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave, onClick: handleClick, style: { cursor: "crosshair" } })] }));
}
