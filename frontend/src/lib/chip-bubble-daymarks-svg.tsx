// 多日泡泡圖的「每日開 / 收」背景標示層(SC-4,mod/kline-date-bubble-days-ux)。
// 與蝴蝶泡泡共用同一個 SVG canvas:Y 軸 reuse 泡泡的 price scale(由父傳
// yLow/yHigh),X 軸獨立為 trading_dates 均分槽位。純背景脈絡層 —
// pointer-events="none" 不參與 hit test,泡泡座標一律不受影響。
//
// 槽位定義來自 trading_dates(不是 candles):資料 lag 導致某日缺 candle 時,
// 該欄仍佔位、仍標日期,只是不畫 K 身 —— 欄位對不上日期比少畫一根更難察覺。

import { memo, useMemo } from "react";
import type { DailyCandle } from "./chip-data";
import { CHIP } from "./chip-theme";

/** 價格標籤三態:欄寬夠 → 貼在開 / 收 y 兩側;中等 → 堆在底部日期上方;
 *  太窄 → 不畫(只留 K 身 + 稀疏日期,edge 2)。 */
export type DayMarkLabelMode = "beside" | "stacked" | "none";

export interface DayMarkSlot {
  date: string;
  /** M/D(去前導零)。 */
  label: string;
  /** 欄中心 x(px)。 */
  x: number;
  slotW: number;
  /** trading_dates 有日但 history 缺該日 → null(edge 1)。 */
  candle: DailyCandle | null;
  /** 開或收落在 yLow..yHigh 之外(broker fallback 軸)→ true,只畫日期(edge 4)。 */
  oob: boolean;
  /** 缺 candle 或越界 → null(該欄不畫 K 身)。 */
  openY: number | null;
  closeY: number | null;
  /** 同上:可畫時才有值。 */
  dir: "up" | "down" | "flat" | null;
  labelMode: DayMarkLabelMode;
  showDate: boolean;
}

// 標籤分級門檻(px)。beside 需容得下「開 xxx.xx」+ K 身 + 「收 xxx.xx」。
const BESIDE_MIN_SLOT = 96;
const STACKED_MIN_SLOT = 50;
// 日期標籤最小間距 = STACKED_MIN_SLOT(同一組可讀性門檻,不另立常數)。
const BODY_MAX_W = 10;
const BODY_W_FRAC = 0.25;
const TICK_LEN = 6;
const LABEL_GAP = 3;
const BODY_OPACITY = 0.6;
const DATE_BASELINE_GAP = 4;
const STACK_CLOSE_DY = 14;
const STACK_OPEN_DY = 26;
const FONT_SIZE = "0.6875rem";

/** "YYYY-MM-DD" → "M/D"(去前導零)。年份由 K 線日期軸 / badge 補足。 */
export function formatDayMarkLabel(date: string): string {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${m}/${d}`;
}

/** 價格文字格式 — 與 K 線 fmtPrice 同規則(≥100 取整 / ≥10 一位 / 其餘兩位),
 *  同一畫面兩處價格不該有兩種小數位。 */
function fmtPrice(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export interface LayoutDayMarksInput {
  dates: string[];
  candles: DailyCandle[];
  yLow: number;
  yHigh: number;
  paddingLeft: number;
  paddingTop: number;
  chartWidth: number;
  chartHeight: number;
}

export function layoutDayMarks({
  dates, candles, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight,
}: LayoutDayMarksInput): DayMarkSlot[] {
  if (dates.length === 0) return [];
  const byDate = new Map<string, DailyCandle>();
  for (const c of candles) byDate.set(c.date, c);

  const slotW = chartWidth / dates.length;
  const labelMode: DayMarkLabelMode =
    slotW >= BESIDE_MIN_SLOT ? "beside" : slotW >= STACKED_MIN_SLOT ? "stacked" : "none";
  const stride = slotW >= STACKED_MIN_SLOT ? 1 : Math.ceil(STACKED_MIN_SLOT / slotW);

  const yRange = yHigh - yLow;
  const yOf = (price: number): number => paddingTop + ((yHigh - price) / yRange) * chartHeight;

  return dates.map((date, i) => {
    const candle = byDate.get(date) ?? null;
    // yRange <= 0 = 退化軸(單一價位且無 pad):畫不出縱向刻度,一律當越界處理。
    const drawable =
      candle !== null &&
      yRange > 0 &&
      candle.open >= yLow && candle.open <= yHigh &&
      candle.close >= yLow && candle.close <= yHigh;
    const oob = candle !== null && !drawable;
    return {
      date,
      label: formatDayMarkLabel(date),
      x: paddingLeft + slotW * i + slotW / 2,
      slotW,
      candle,
      oob,
      openY: drawable ? yOf(candle!.open) : null,
      closeY: drawable ? yOf(candle!.close) : null,
      dir: drawable
        ? candle!.close > candle!.open ? "up" : candle!.close < candle!.open ? "down" : "flat"
        : null,
      labelMode,
      showDate: i % stride === 0,
    };
  });
}

const DIR_COLOR = {
  up: CHIP.bull,
  down: CHIP.bear,
  flat: CHIP.inkDim,
} as const;

export interface DayMarksLayerProps extends LayoutDayMarksInput {
  /** SVG 全高與底部 padding — 日期標籤置底(避開左上 window badge / brush hint /
   *  截圖 annotation,W8)。 */
  height: number;
  paddingBottom: number;
}

export const DayMarksLayer = memo(function DayMarksLayer({
  dates, candles, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight,
  height, paddingBottom,
}: DayMarksLayerProps) {
  // brush 拖曳每幀 re-render:槽位聚合不得進 render body(recessive layer 樣板 5)。
  const slots = useMemo(
    () => layoutDayMarks({
      dates, candles, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight,
    }),
    [dates, candles, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight],
  );
  if (slots.length === 0) return null;

  const dateY = height - paddingBottom - DATE_BASELINE_GAP;

  return (
    <g data-testid="bubble-day-marks" pointerEvents="none">
      {slots.map((s) => {
        const drawBody = s.openY !== null && s.closeY !== null && s.dir !== null;
        const bodyW = Math.min(BODY_MAX_W, s.slotW * BODY_W_FRAC);
        const color = s.dir ? DIR_COLOR[s.dir] : CHIP.inkDim;
        const top = drawBody ? Math.min(s.openY!, s.closeY!) : 0;
        const bodyH = drawBody ? Math.max(Math.abs(s.closeY! - s.openY!), 1) : 0;
        const showPrices = drawBody && s.labelMode !== "none";
        return (
          <g key={s.date} data-date={s.date} data-oob={s.oob ? "true" : "false"}>
            {drawBody && (
              <>
                <rect
                  x={s.x - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={bodyH}
                  fill={color}
                  opacity={BODY_OPACITY}
                />
                {/* 開盤刻度在左、收盤刻度在右(與 K 線 OHLC bar 同語法) */}
                <line
                  x1={s.x - bodyW / 2 - TICK_LEN}
                  x2={s.x - bodyW / 2}
                  y1={s.openY!}
                  y2={s.openY!}
                  stroke={color}
                  strokeWidth={1}
                  opacity={BODY_OPACITY}
                />
                <line
                  x1={s.x + bodyW / 2}
                  x2={s.x + bodyW / 2 + TICK_LEN}
                  y1={s.closeY!}
                  y2={s.closeY!}
                  stroke={color}
                  strokeWidth={1}
                  opacity={BODY_OPACITY}
                />
              </>
            )}
            {s.showDate && (
              <text
                x={s.x}
                y={dateY}
                textAnchor="middle"
                fill={CHIP.inkDim}
                fontSize={FONT_SIZE}
                fontFamily={CHIP.font}
              >
                {s.label}
              </text>
            )}
            {showPrices && s.labelMode === "beside" && (
              <>
                <text
                  x={s.x - bodyW / 2 - TICK_LEN - LABEL_GAP}
                  y={s.openY! + 3}
                  textAnchor="end"
                  fill={CHIP.inkMuted}
                  fontSize={FONT_SIZE}
                  fontFamily={CHIP.font}
                >
                  {`開 ${fmtPrice(s.candle!.open)}`}
                </text>
                <text
                  x={s.x + bodyW / 2 + TICK_LEN + LABEL_GAP}
                  y={s.closeY! + 3}
                  textAnchor="start"
                  fill={CHIP.inkMuted}
                  fontSize={FONT_SIZE}
                  fontFamily={CHIP.font}
                >
                  {`收 ${fmtPrice(s.candle!.close)}`}
                </text>
              </>
            )}
            {showPrices && s.labelMode === "stacked" && (
              <>
                <text
                  x={s.x}
                  y={dateY - STACK_OPEN_DY}
                  textAnchor="middle"
                  fill={CHIP.inkMuted}
                  fontSize={FONT_SIZE}
                  fontFamily={CHIP.font}
                >
                  {`開 ${fmtPrice(s.candle!.open)}`}
                </text>
                <text
                  x={s.x}
                  y={dateY - STACK_CLOSE_DY}
                  textAnchor="middle"
                  fill={CHIP.inkMuted}
                  fontSize={FONT_SIZE}
                  fontFamily={CHIP.font}
                >
                  {`收 ${fmtPrice(s.candle!.close)}`}
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
});
