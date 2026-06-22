import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 法人買賣超柱狀圖 + 融資融券折線圖 — 純 SVG 子元件。
 *
 * 顏色 inline hex,不依賴 Tailwind/CSS var,resvg 可渲染。
 */
import { memo } from "react";
import { CHIP } from "./chip-theme";
import { KLINE_PAD_L, KLINE_PAD_R } from "./chip-kline-svg";
// -- theme constants (from shared chip-theme) --
const BULL = CHIP.bull;
const BEAR = CHIP.bear;
const TEXT = CHIP.inkDim;
const ZERO = CHIP.lineStrong;
const FONT = CHIP.font;
// -- pure util --
/** Bar pixel height (always >= 0). */
export function instBarHeight(value, maxAbsValue, halfHeight) {
    if (maxAbsValue === 0)
        return 0;
    return (Math.abs(value) / maxAbsValue) * halfHeight;
}
/** Format lot value with sign and commas (data is already in 張). */
function fmtLots(lots) {
    const sign = lots > 0 ? "+" : "";
    return `${sign}${lots.toLocaleString("en-US")}`;
}
export const InstBarSvg = memo(function InstBarSvg({ data, width, height, label, hoverIndex, selectedIndex, }) {
    if (data.length === 0) {
        return (_jsx("svg", { width: width, height: height, children: label && (_jsx("text", { x: 4, y: 22, fontSize: 22, fill: TEXT, fontFamily: FONT, children: label })) }));
    }
    const midY = height / 2;
    const halfH = midY - 2; // leave 2 px margin top/bottom
    const maxAbs = Math.max(...data.map(Math.abs), 1);
    const plotW = width - KLINE_PAD_L - KLINE_PAD_R;
    const barW = Math.max(1, (plotW / data.length) * 0.7);
    const step = plotW / data.length;
    // value display: hovered index or last
    const valIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length
        ? hoverIndex
        : data.length - 1;
    const valRaw = data[valIdx];
    const valColor = valRaw >= 0 ? BULL : BEAR;
    return (_jsxs("svg", { width: width, height: height, children: [_jsx("line", { x1: KLINE_PAD_L, x2: width - KLINE_PAD_R, y1: midY, y2: midY, stroke: ZERO, strokeWidth: 1 }), data.map((v, i) => {
                const h = instBarHeight(v, maxAbs, halfH);
                if (h === 0)
                    return null;
                const cx = KLINE_PAD_L + step * i + step / 2;
                const y = v >= 0 ? midY - h : midY;
                return (_jsx("rect", { x: cx - barW / 2, y: y, width: barW, height: h, fill: v >= 0 ? BULL : BEAR }, i));
            }), label && (_jsxs("text", { y: 22, fontSize: 22, fontFamily: FONT, style: { fontVariantNumeric: "tabular-nums" }, children: [_jsx("tspan", { x: 4, fill: TEXT, children: label }), _jsxs("tspan", { dx: 8, fill: valColor, children: [fmtLots(valRaw), " \u5F35"] })] })), hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length && (_jsx("line", { x1: KLINE_PAD_L + step * hoverIndex + step / 2, y1: 0, x2: KLINE_PAD_L + step * hoverIndex + step / 2, y2: height, stroke: CHIP.inkDim, strokeWidth: 1, strokeDasharray: "4 3" })), selectedIndex != null && selectedIndex >= 0 && selectedIndex < data.length && (_jsx("line", { "data-testid": "sel-cursor", x1: KLINE_PAD_L + step * selectedIndex + step / 2, y1: 0, x2: KLINE_PAD_L + step * selectedIndex + step / 2, y2: height, stroke: CHIP.ma5, strokeWidth: 1 }))] }));
});
export const MarginLineSvg = memo(function MarginLineSvg({ marginData, shortData, marginBalanceData, shortBalanceData, width, height, label, hoverIndex, selectedIndex, }) {
    const len = Math.max(marginData.length, shortData.length);
    if (len === 0) {
        return (_jsx("svg", { width: width, height: height, children: label && (_jsx("text", { x: 4, y: 22, fontSize: 22, fill: TEXT, fontFamily: FONT, children: label })) }));
    }
    const allVals = [...marginData, ...shortData].filter((v) => v !== undefined);
    const yMin = Math.min(...allVals);
    const yMax = Math.max(...allVals);
    const range = yMax - yMin || 1;
    const pad = 4; // px margin top/bottom
    const plotH = height - pad * 2;
    const plotW = width - KLINE_PAD_L - KLINE_PAD_R;
    const step = plotW / (len || 1);
    const scaleX = (i) => KLINE_PAD_L + step * i + step / 2;
    const scaleY = (v) => pad + plotH - ((v - yMin) / range) * plotH;
    const toPoints = (arr) => arr.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(" ");
    // value display: hovered index or last
    const valIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < len
        ? hoverIndex
        : len - 1;
    const marginVal = valIdx < marginData.length ? marginData[valIdx] : 0;
    const shortVal = valIdx < shortData.length ? shortData[valIdx] : 0;
    const mBal = marginBalanceData && valIdx < marginBalanceData.length ? marginBalanceData[valIdx] : 0;
    const sBal = shortBalanceData && valIdx < shortBalanceData.length ? shortBalanceData[valIdx] : 0;
    const ratio = mBal > 0 ? (sBal / mBal * 100).toFixed(1) : "0.0";
    return (_jsxs("svg", { width: width, height: height, children: [yMin <= 0 && yMax >= 0 && (_jsx("line", { x1: KLINE_PAD_L, x2: width - KLINE_PAD_R, y1: scaleY(0), y2: scaleY(0), stroke: ZERO, strokeWidth: 1 })), marginData.length > 1 && (_jsx("polyline", { fill: "none", stroke: BULL, strokeWidth: 1.2, points: toPoints(marginData) })), shortData.length > 1 && (_jsx("polyline", { fill: "none", stroke: BEAR, strokeWidth: 1.2, points: toPoints(shortData) })), label && (_jsxs("text", { y: 22, fontSize: 22, fontFamily: FONT, style: { fontVariantNumeric: "tabular-nums" }, children: [_jsx("tspan", { x: 4, fill: TEXT, children: label }), _jsxs("tspan", { dx: 8, fill: BULL, children: ["\u878D\u8CC7 ", fmtLots(marginVal), " \u5F35"] }), _jsxs("tspan", { dx: 8, fill: BEAR, children: ["\u878D\u5238 ", fmtLots(shortVal), " \u5F35"] }), marginBalanceData && _jsxs("tspan", { dx: 8, fill: TEXT, children: ["\u5238\u8CC7\u6BD4 ", ratio, "%"] })] })), hoverIndex != null && hoverIndex >= 0 && hoverIndex < len && (_jsx("line", { x1: scaleX(hoverIndex), y1: 0, x2: scaleX(hoverIndex), y2: height, stroke: CHIP.inkDim, strokeWidth: 1, strokeDasharray: "4 3" })), selectedIndex != null && selectedIndex >= 0 && selectedIndex < len && (_jsx("line", { "data-testid": "sel-cursor", x1: scaleX(selectedIndex), y1: 0, x2: scaleX(selectedIndex), y2: height, stroke: CHIP.ma5, strokeWidth: 1 }))] }));
});
