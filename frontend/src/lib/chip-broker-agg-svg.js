import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 分點 aggregate 柱狀圖 — 第 6 列 sub-chart。
 * 與 InstBarSvg 視覺一致 (net bar: 正紅↑ / 負綠↓),
 * 唯一差異:label 字色改為紫色 (ma20) 標示「分點 aggregate」。
 */
import { memo } from "react";
import { CHIP } from "./chip-theme";
import { KLINE_PAD_L, KLINE_PAD_R } from "./chip-kline-svg";
import { instBarHeight } from "./chip-inst-bar-svg";
const BULL = CHIP.bull;
const BEAR = CHIP.bear;
const ZERO = CHIP.lineStrong;
const SEL = CHIP.ma5;
const LABEL_COLOR = CHIP.ma20;
const FONT = CHIP.font;
function fmtLots(lots) {
    const sign = lots > 0 ? "+" : "";
    return `${sign}${lots.toLocaleString("en-US")}`;
}
export const BrokerAggBarSvg = memo(function BrokerAggBarSvg({ data, width, height, label, hoverIndex, selectedIndex, }) {
    const midY = height / 2;
    const halfH = midY - 2;
    const maxAbs = data.length > 0 ? Math.max(...data.map(Math.abs), 1) : 1;
    const plotW = width - KLINE_PAD_L - KLINE_PAD_R;
    const barW = data.length > 0 ? Math.max(1, (plotW / data.length) * 0.7) : 1;
    const step = data.length > 0 ? plotW / data.length : 1;
    const valIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length
        ? hoverIndex
        : data.length - 1;
    const valRaw = data[valIdx] ?? 0;
    const valColor = valRaw >= 0 ? BULL : BEAR;
    return (_jsxs("svg", { width: width, height: height, children: [_jsx("line", { x1: KLINE_PAD_L, x2: width - KLINE_PAD_R, y1: midY, y2: midY, stroke: ZERO, strokeWidth: 1 }), data.map((v, i) => {
                const h = instBarHeight(v, maxAbs, halfH);
                if (h === 0)
                    return null;
                const cx = KLINE_PAD_L + step * i + step / 2;
                const y = v >= 0 ? midY - h : midY;
                return (_jsx("rect", { x: cx - barW / 2, y: y, width: barW, height: h, fill: v >= 0 ? BULL : BEAR }, i));
            }), _jsxs("text", { y: 22, fontSize: 22, fontFamily: FONT, style: { fontVariantNumeric: "tabular-nums" }, children: [_jsx("tspan", { x: 4, fill: LABEL_COLOR, fontWeight: 600, children: label }), _jsxs("tspan", { dx: 8, fill: valColor, children: [fmtLots(valRaw), " \u5F35"] })] }), hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length && (_jsx("line", { x1: KLINE_PAD_L + step * hoverIndex + step / 2, y1: 0, x2: KLINE_PAD_L + step * hoverIndex + step / 2, y2: height, stroke: CHIP.inkDim, strokeWidth: 1, strokeDasharray: "4 3" })), selectedIndex != null && selectedIndex >= 0 && selectedIndex < data.length && (_jsx("line", { "data-testid": "sel-cursor", x1: KLINE_PAD_L + step * selectedIndex + step / 2, y1: 0, x2: KLINE_PAD_L + step * selectedIndex + step / 2, y2: height, stroke: SEL, strokeWidth: 1 }))] }));
});
