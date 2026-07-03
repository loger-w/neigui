// 分價量長條圖 — 每個價位的買/賣張數橫向對比。
// 中線左=賣(綠)、中線右=買(紅),供網頁與 bot 共用。
import { memo } from "react";
import type { PriceAgg } from "./chip-data";
import { CHIP } from "./chip-theme";

export interface PriceBarProps {
  data: PriceAgg[];   // already sorted by price desc
  width: number;
  height: number;
}

const BUY_FILL = "rgba(232, 90, 79, 0.6)";
const SELL_FILL = "rgba(127, 201, 154, 0.5)";
const CENTER_STROKE = CHIP.lineStrong;
const TEXT_FILL = CHIP.inkDim;
const FONT = CHIP.font;

const PAD_L = 64;   // price label width
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 24;   // room for legend labels
const ROW_GAP = 1;  // gap between rows

export const PriceBarSvg = memo(function PriceBarSvg({
  data,
  width,
  height,
}: PriceBarProps) {
  if (!data || data.length === 0) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="0.875rem"
          fontFamily={FONT}
          fill={TEXT_FILL}
        >
          no data
        </text>
      </svg>
    );
  }

  const bodyH = height - PAD_T - PAD_B;
  const barAreaW = width - PAD_L - PAD_R;
  const centerX = PAD_L + barAreaW / 2;
  const halfW = barAreaW / 2;

  const rowH = Math.max(1, (bodyH - (data.length - 1) * ROW_GAP) / data.length);
  const maxVol = Math.max(1, ...data.map((d) => Math.max(d.buy, d.sell)));

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      {/* center vertical line */}
      <line
        x1={centerX}
        y1={PAD_T}
        x2={centerX}
        y2={PAD_T + bodyH}
        stroke={CENTER_STROKE}
        strokeWidth={1}
      />

      {/* rows */}
      {data.map((d, i) => {
        const y = PAD_T + i * (rowH + ROW_GAP);
        const barH = Math.max(1, rowH - 1);
        const buyW = (d.buy / maxVol) * halfW;
        const sellW = (d.sell / maxVol) * halfW;
        const textY = y + rowH / 2;
        const fontSize = Math.min(12, Math.max(8, rowH - 2));

        return (
          <g key={d.price}>
            {/* price label */}
            <text
              x={PAD_L - 6}
              y={textY}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={fontSize}
              fontFamily={FONT}
              fill={TEXT_FILL}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {d.price}
            </text>

            {/* sell bar (left of center) */}
            {sellW > 0 && (
              <rect
                x={centerX - sellW}
                y={y}
                width={sellW}
                height={barH}
                fill={SELL_FILL}
              />
            )}

            {/* buy bar (right of center) */}
            {buyW > 0 && (
              <rect
                x={centerX}
                y={y}
                width={buyW}
                height={barH}
                fill={BUY_FILL}
              />
            )}
          </g>
        );
      })}

      {/* legend labels at bottom */}
      <text
        x={centerX - 12}
        y={height - 6}
        textAnchor="end"
        fontSize="0.75rem"
        fontFamily={FONT}
        fill={TEXT_FILL}
      >
        {"← 賣"}
      </text>
      <text
        x={centerX + 12}
        y={height - 6}
        textAnchor="start"
        fontSize="0.75rem"
        fontFamily={FONT}
        fill={TEXT_FILL}
      >
        {"買 →"}
      </text>
    </svg>
  );
});
