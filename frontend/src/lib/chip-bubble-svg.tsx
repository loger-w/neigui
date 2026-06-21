// Butterfly (mirror) bubble chart: sell bubbles left, buy bubbles right.
// Pure functions exported for testing; component uses automatic JSX transform.

import { memo, useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { BrokerTrade } from "./chip-data";
import { CHIP } from "./chip-theme";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Map volume to a circle radius between minR and maxR (sqrt scale). */
export function bubbleRadius(
  volume: number,
  maxVolume: number,
  minR: number,
  maxR: number,
): number {
  if (maxVolume <= 0 || volume <= 0) return minR;
  const t = Math.sqrt(volume / maxVolume); // sqrt so area is proportional
  return minR + t * (maxR - minR);
}


// ---------------------------------------------------------------------------
// Tooltip callback payload
// ---------------------------------------------------------------------------

export interface BubbleHoverPayload {
  broker: string;
  volume: number;
  price: number;
  side: "buy" | "sell";
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
} as const;

const MIN_R = 3;
const MAX_R = 22;
const VOLUME_THRESHOLD = 5; // ignore volumes <= 5

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BubbleChartProps {
  trades: BrokerTrade[];
  width: number;
  height: number;
  closePrice?: number;
  /** When set, only show this broker's bubbles. */
  selectedBroker?: string | null;
  /** Hover callback for tooltip (null = mouse left). */
  onBubbleHover?: (payload: BubbleHoverPayload | null, x: number, y: number) => void;
  /** Click callback — selects the clicked broker. */
  onBubbleClick?: (broker: string) => void;
}

interface Bubble {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke: string;
  key: string;
  payload: BubbleHoverPayload;
}

export const BubbleChartSvg = memo(function BubbleChartSvg({
  trades,
  width,
  height,
  closePrice,
  selectedBroker,
  onBubbleHover,
  onBubbleClick,
}: BubbleChartProps) {
  // --- All hooks MUST be called before any conditional return ---

  const layoutTrades = useMemo(() => {
    if (trades.length <= 100) return trades;
    return [...trades]
      .sort((a, b) => Math.max(b.buy, b.sell) - Math.max(a.buy, a.sell))
      .slice(0, 100);
  }, [trades]);

  const bubblesRef = useRef<Bubble[]>([]);
  const rafId = useRef(0);

  const hitTest = useCallback(
    (clientX: number, clientY: number, svgRect: DOMRect) => {
      const mx = clientX - svgRect.left;
      const my = clientY - svgRect.top;
      let nearest: Bubble | null = null;
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
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<SVGRectElement>) => {
      const clientX = e.clientX;
      const clientY = e.clientY;
      const svg = e.currentTarget.ownerSVGElement;
      const svgRect = svg?.getBoundingClientRect();
      if (!svgRect) return;
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        const hit = hitTest(clientX, clientY, svgRect);
        if (hit) {
          onBubbleHover?.(hit.payload, clientX, clientY);
        } else {
          onBubbleHover?.(null, 0, 0);
        }
      });
    },
    [hitTest, onBubbleHover],
  );

  const handleMouseLeave = useCallback(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    onBubbleHover?.(null, 0, 0);
  }, [onBubbleHover]);

  const handleClick = useCallback(
    (e: ReactMouseEvent<SVGRectElement>) => {
      const svg = e.currentTarget.ownerSVGElement;
      const svgRect = svg?.getBoundingClientRect();
      if (!svgRect) return;
      const hit = hitTest(e.clientX, e.clientY, svgRect);
      if (hit) onBubbleClick?.(hit.payload.broker);
    },
    [hitTest, onBubbleClick],
  );

  // --- End hooks section ---

  if (layoutTrades.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ fontFamily: FONT }}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill={COLOR.text}
          fontSize={13}
        >
          No trade data
        </text>
      </svg>
    );
  }

  // -- Derive data ranges from ALL trades (stable axes) --------------------
  const prices: number[] = [];
  const volumes: number[] = [];
  for (const t of layoutTrades) {
    prices.push(t.price);
    if (t.buy > VOLUME_THRESHOLD) volumes.push(t.buy);
    if (t.sell > VOLUME_THRESHOLD) volumes.push(t.sell);
  }
  if (volumes.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ fontFamily: FONT }}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill={COLOR.text}
          fontSize={13}
        >
          No significant volume
        </text>
      </svg>
    );
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
  const sY = (price: number) =>
    PADDING.top + ((yHigh - price) / (yHigh - yLow)) * cH;

  // -- Price tick levels ---------------------------------------------------
  const priceSet = [...new Set(prices)].sort((a, b) => a - b);
  let priceTicks: number[];
  if (priceSet.length <= 8) {
    priceTicks = priceSet;
  } else {
    const step = Math.ceil(priceSet.length / 7);
    priceTicks = priceSet.filter((_, i) => i % step === 0);
    if (priceTicks[priceTicks.length - 1] !== priceSet[priceSet.length - 1]) {
      priceTicks.push(priceSet[priceSet.length - 1]);
    }
  }

  // -- Volume tick levels (mirrored on both sides) -------------------------
  const volStep = niceStep(maxVolume, 4);
  const volTicks: number[] = [];
  for (let v = volStep; v <= maxVolume; v += volStep) {
    volTicks.push(v);
  }
  if (volTicks.length === 0 || volTicks[volTicks.length - 1] < maxVolume) {
    volTicks.push((volTicks.length === 0 ? 0 : volTicks[volTicks.length - 1]) + volStep);
  }
  const volMax = volTicks[volTicks.length - 1];

  // -- Build bubble data (butterfly: sell left, buy right) -----------------
  const bubbles: Bubble[] = [];
  let idx = 0;
  for (const t of visibleTrades) {
    if (t.buy > VOLUME_THRESHOLD) {
      bubbles.push({
        cx: centerX + (t.buy / volMax) * halfW,
        cy: sY(t.price),
        r: bubbleRadius(t.buy, maxVolume, MIN_R, MAX_R),
        fill: COLOR.buyFill,
        stroke: COLOR.buyStroke,
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
        stroke: COLOR.sellStroke,
        key: `s-${t.broker_id}-${t.price}-${idx}`,
        payload: { broker: t.broker, volume: t.sell, price: t.price, side: "sell" },
      });
    }
    idx++;
  }

  bubblesRef.current = bubbles;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ fontFamily: FONT }}
    >
      {/* Horizontal grid lines at price ticks */}
      {priceTicks.map((p) => (
        <line
          key={`g-${p}`}
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={sY(p)}
          y2={sY(p)}
          stroke={COLOR.grid}
          strokeWidth={1}
        />
      ))}

      {/* Center vertical divider */}
      <line
        x1={centerX}
        x2={centerX}
        y1={PADDING.top}
        y2={height - PADDING.bottom}
        stroke={COLOR.centerLine}
        strokeWidth={1}
      />

      {/* Y-axis price labels */}
      {priceTicks.map((p) => (
        <text
          key={`yl-${p}`}
          x={PADDING.left - 6}
          y={sY(p) + 4}
          textAnchor="end"
          fill={COLOR.text}
          fontSize={11}
        >
          {p}
        </text>
      ))}

      {/* X-axis volume labels — mirrored on both sides */}
      {volTicks.map((v) => {
        const offset = (v / volMax) * halfW;
        return (
          <g key={`xl-${v}`}>
            {/* Left (sell) side */}
            <text
              x={centerX - offset}
              y={height - PADDING.bottom + 16}
              textAnchor="middle"
              fill={COLOR.text}
              fontSize={11}
            >
              {v}
            </text>
            {/* Right (buy) side */}
            <text
              x={centerX + offset}
              y={height - PADDING.bottom + 16}
              textAnchor="middle"
              fill={COLOR.text}
              fontSize={11}
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* Side labels at bottom */}
      <text
        x={PADDING.left + 4}
        y={height - PADDING.bottom + 16}
        textAnchor="start"
        fill={COLOR.sellStroke}
        fontSize={11}
        fontWeight={600}
      >
        {"← 賣"}
      </text>
      <text
        x={width - PADDING.right - 4}
        y={height - PADDING.bottom + 16}
        textAnchor="end"
        fill={COLOR.buyStroke}
        fontSize={11}
        fontWeight={600}
      >
        {"買 →"}
      </text>

      {/* Close price dashed line */}
      {closePrice != null && closePrice >= yLow && closePrice <= yHigh && (
        <line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={sY(closePrice)}
          y2={sY(closePrice)}
          stroke={COLOR.closeLine}
          strokeWidth={1}
          strokeDasharray="6 4"
        />
      )}

      {/* Bubbles — no per-element event handlers; overlay rect does hit testing */}
      {bubbles.map((b) => (
        <circle
          key={b.key}
          cx={b.cx}
          cy={b.cy}
          r={b.r}
          fill={b.fill}
          stroke={b.stroke}
          strokeWidth={1}
          pointerEvents="none"
        />
      ))}

      {/* Invisible overlay for mouse interaction (single handler instead of per-bubble) */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ cursor: "pointer" }}
      />
    </svg>
  );
});

// ---------------------------------------------------------------------------
// Utility: compute a "nice" step for axis ticks
// ---------------------------------------------------------------------------

function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice: number;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3) nice = 2;
  else if (norm <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}
