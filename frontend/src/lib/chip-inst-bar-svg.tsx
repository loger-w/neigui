/**
 * 法人買賣超柱狀圖 + 融資融券折線圖 — 純 SVG 子元件。
 *
 * 顏色 inline hex,不依賴 Tailwind/CSS var,resvg 可渲染。
 */
import { memo } from "react";
import { CHIP, svgLabelFont } from "./chip-theme";
import { KLINE_PAD_L, KLINE_PAD_R } from "./chip-kline-svg";

// -- theme constants (from shared chip-theme) --
const BULL = CHIP.bull;
const BEAR = CHIP.bear;
const TEXT = CHIP.inkDim;
const ZERO = CHIP.lineStrong;
const FONT = CHIP.font;

// -- pure util --

/** Bar pixel height (always >= 0). */
export function instBarHeight(
  value: number,
  maxAbsValue: number,
  halfHeight: number,
): number {
  if (maxAbsValue === 0) return 0;
  return (Math.abs(value) / maxAbsValue) * halfHeight;
}

/** Format lot value with sign and commas (data is already in 張). */
function fmtLots(lots: number): string {
  const sign = lots > 0 ? "+" : "";
  return `${sign}${lots.toLocaleString("en-US")}`;
}

// -- InstBarSvg --

export interface InstBarProps {
  data: number[];
  width: number;
  height: number;
  label?: string;
  hoverIndex?: number | null;
  selectedIndex?: number | null;
  /** CH-2b(mod/batch-ui-update):窗加總文案(parent 格式化,如「5日 +55 張」)。 */
  windowText?: string | null;
}

export const InstBarSvg = memo(function InstBarSvg({
  data,
  width,
  height,
  label,
  hoverIndex,
  selectedIndex,
  windowText,
}: InstBarProps) {
  if (data.length === 0) {
    return (
      <svg width={width} height={height}>
        {label && (
          <text x={4} y={22} fontSize={svgLabelFont(width)} fill={TEXT} fontFamily={FONT}>
            {label}
          </text>
        )}
      </svg>
    );
  }

  const midY = height / 2;
  const halfH = midY - 2; // leave 2 px margin top/bottom
  const maxAbs = Math.max(...data.map(Math.abs), 1);
  const plotW = width - KLINE_PAD_L - KLINE_PAD_R;
  const barW = Math.max(1, (plotW / data.length) * 0.7);
  const step = plotW / data.length;

  // value display: hover → selected → last (Bug #3 fix — keeps label aligned
  // with the user's picked date when the cursor leaves the chart).
  const valIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length
    ? hoverIndex
    : selectedIndex != null && selectedIndex >= 0 && selectedIndex < data.length
      ? selectedIndex
      : data.length - 1;
  const valRaw = data[valIdx]!;
  const valColor = valRaw >= 0 ? BULL : BEAR;

  return (
    <svg width={width} height={height}>
      {/* zero line */}
      <line
        x1={KLINE_PAD_L}
        x2={width - KLINE_PAD_R}
        y1={midY}
        y2={midY}
        stroke={ZERO}
        strokeWidth={1}
      />

      {/* bars */}
      {data.map((v, i) => {
        const h = instBarHeight(v, maxAbs, halfH);
        if (h === 0) return null;
        const cx = KLINE_PAD_L + step * i + step / 2;
        const y = v >= 0 ? midY - h : midY;
        return (
          <rect
            key={i}
            x={cx - barW / 2}
            y={y}
            width={barW}
            height={h}
            fill={v >= 0 ? BULL : BEAR}
          />
        );
      })}

      {label && (
        <text y={22} fontSize={svgLabelFont(width)} fontFamily={FONT}
          style={{ fontVariantNumeric: "tabular-nums" }}>
          <tspan x={4} fill={TEXT}>{label}</tspan>
          <tspan dx={8} fill={valColor}>{fmtLots(valRaw)} 張</tspan>
          {windowText && <tspan dx={8} fill={TEXT}>· {windowText}</tspan>}
        </text>
      )}

      {/* crosshair vertical line */}
      {hoverIndex != null && hoverIndex >= 0 && hoverIndex < data.length && (
        <line
          data-testid="sub-crosshair"
          x1={KLINE_PAD_L + step * hoverIndex + step / 2} y1={0}
          x2={KLINE_PAD_L + step * hoverIndex + step / 2} y2={height}
          stroke={CHIP.inkDim} strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {/* selected-day cursor (gold, persistent) */}
      {selectedIndex != null && selectedIndex >= 0 && selectedIndex < data.length && (
        <line
          data-testid="sel-cursor"
          x1={KLINE_PAD_L + step * selectedIndex + step / 2} y1={0}
          x2={KLINE_PAD_L + step * selectedIndex + step / 2} y2={height}
          stroke={CHIP.ma5} strokeWidth={1}
        />
      )}
    </svg>
  );
});

// -- MarginLineSvg --

export interface MarginLineProps {
  marginData: number[];
  shortData: number[];
  marginBalanceData?: number[];
  shortBalanceData?: number[];
  width: number;
  height: number;
  label?: string;
  hoverIndex?: number | null;
  selectedIndex?: number | null;
  /** CH-2b:窗加總文案(parent 格式化,如「5日 融資+60 融券+45 張」)。 */
  windowText?: string | null;
}

export const MarginLineSvg = memo(function MarginLineSvg({
  marginData,
  shortData,
  marginBalanceData,
  shortBalanceData,
  width,
  height,
  label,
  hoverIndex,
  selectedIndex,
  windowText,
}: MarginLineProps) {
  const len = Math.max(marginData.length, shortData.length);
  if (len === 0) {
    return (
      <svg width={width} height={height}>
        {label && (
          <text x={4} y={22} fontSize={svgLabelFont(width)} fill={TEXT} fontFamily={FONT}>
            {label}
          </text>
        )}
      </svg>
    );
  }

  const allVals = [...marginData, ...shortData].filter(
    (v) => v !== undefined,
  );
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const range = yMax - yMin || 1;
  const pad = 4; // px margin top/bottom
  const plotH = height - pad * 2;

  const plotW = width - KLINE_PAD_L - KLINE_PAD_R;
  const step = plotW / (len || 1);
  const scaleX = (i: number) => KLINE_PAD_L + step * i + step / 2;
  const scaleY = (v: number) => pad + plotH - ((v - yMin) / range) * plotH;

  const toPoints = (arr: number[]) =>
    arr.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(" ");

  // value display: hover → selected → last (Bug #3 fix).
  const valIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < len
    ? hoverIndex
    : selectedIndex != null && selectedIndex >= 0 && selectedIndex < len
      ? selectedIndex
      : len - 1;
  const marginVal = marginData[valIdx] ?? 0;
  const shortVal = shortData[valIdx] ?? 0;
  const mBal = marginBalanceData?.[valIdx] ?? 0;
  const sBal = shortBalanceData?.[valIdx] ?? 0;
  const ratio = mBal > 0 ? (sBal / mBal * 100).toFixed(1) : "0.0";

  return (
    <svg width={width} height={height}>
      {/* zero reference line (clamped to plot area) */}
      {yMin <= 0 && yMax >= 0 && (
        <line
          x1={KLINE_PAD_L}
          x2={width - KLINE_PAD_R}
          y1={scaleY(0)}
          y2={scaleY(0)}
          stroke={ZERO}
          strokeWidth={1}
        />
      )}

      {/* margin line (融資) */}
      {marginData.length > 1 && (
        <polyline
          fill="none"
          stroke={BULL}
          strokeWidth={1.2}
          points={toPoints(marginData)}
        />
      )}

      {/* short line (融券) */}
      {shortData.length > 1 && (
        <polyline
          fill="none"
          stroke={BEAR}
          strokeWidth={1.2}
          points={toPoints(shortData)}
        />
      )}

      {label && (
        <text y={22} fontSize={svgLabelFont(width)} fontFamily={FONT}
          style={{ fontVariantNumeric: "tabular-nums" }}>
          <tspan x={4} fill={TEXT}>{label}</tspan>
          <tspan dx={8} fill={BULL}>融資 {fmtLots(marginVal)} 張</tspan>
          <tspan dx={8} fill={BEAR}>融券 {fmtLots(shortVal)} 張</tspan>
          {marginBalanceData && <tspan dx={8} fill={TEXT}>券資比 {ratio}%</tspan>}
          {windowText && <tspan dx={8} fill={TEXT}>· {windowText}</tspan>}
        </text>
      )}

      {/* crosshair vertical line */}
      {hoverIndex != null && hoverIndex >= 0 && hoverIndex < len && (
        <line
          data-testid="sub-crosshair"
          x1={scaleX(hoverIndex)} y1={0}
          x2={scaleX(hoverIndex)} y2={height}
          stroke={CHIP.inkDim} strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {/* selected-day cursor (gold, persistent) */}
      {selectedIndex != null && selectedIndex >= 0 && selectedIndex < len && (
        <line
          data-testid="sel-cursor"
          x1={scaleX(selectedIndex)} y1={0}
          x2={scaleX(selectedIndex)} y2={height}
          stroke={CHIP.ma5} strokeWidth={1}
        />
      )}
    </svg>
  );
});
