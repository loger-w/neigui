// Butterfly (mirror) bubble chart: sell bubbles left, buy bubbles right.
// Pure functions exported for testing; component uses automatic JSX transform.

import {
  memo, useCallback, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BrokerTrade, IntradayPoint } from "./chip-data";
import { CHIP } from "./chip-theme";
import { IntradayLineLayer } from "./chip-intraday-line-svg";

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
  /** SC-7:tooltip 顯示「id 去dash名」需要 id;點擊契約仍以 broker name 為 key。 */
  brokerId: string;
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
  crosshair: "rgba(237, 228, 211, 0.35)",
  crosshairLabelBg: "rgba(15, 12, 8, 0.85)",
  crosshairLabelText: CHIP.ink,
} as const;

const MIN_R = 3;
const MAX_R = 22;
const VOLUME_THRESHOLD = 5; // ignore volumes <= 5

// Small helper: a full-size SVG showing a single centered hint message.
// Used for "no data" / "no volume" / "broker has no notable trades" states
// where we want to occupy the chart area without rendering bubbles.
function HintSvg({
  width,
  height,
  text,
}: {
  width: number;
  height: number;
  text: string;
}) {
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
        fontSize="0.8125rem"
      >
        {text}
      </text>
    </svg>
  );
}

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
  /** Click callback — broker name when clicking a bubble, null when clicking empty area. */
  onBubbleClick?: (broker: string | null) => void;
  /** Optional 1-min KBar close-price series (背景分時走勢線).
   *  Y 軸 reuse 此圖 price scale,X 軸獨立為時間 09:00→13:30。
   *  缺則不畫,既有行為不變(向下相容)。 */
  intradayPoints?: IntradayPoint[] | null;
  /** C7 A1: Y 軸 brush 選價位 range。overlay 在 Y 軸區域(x < PADDING.left)
   *  drag ≥ 4px 觸發 callback(min, max price)。單擊或短拖曳不觸發。 */
  onYBrush?: (priceMin: number, priceMax: number) => void;
  /** C7 A1: 已提交的 brush range,persistent band 顯示。null / undefined 不畫。 */
  brushRange?: { min: number; max: number } | null;
  /** C10 (🔴 Item 3): 過濾泡泡 — 只 render 價位在 [min, max] 內的 bubble。
   *  軸(prices / volumes)仍用全 trades 計算,filter 後泡泡位置不變,
   *  UX 感受為「淡出」而非「重排」。 */
  priceRange?: { min: number; max: number } | null;
}

// C7 A1 (🟢): Y 軸 brush drag min threshold(px)。防手誤與單擊誤觸。
const BRUSH_MIN_DRAG_PX = 4;

interface Bubble {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke: string;
  brokerId: string;
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
  intradayPoints,
  onYBrush,
  brushRange,
  priceRange,
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

  // Crosshair refs — ref-based DOM mutation 跟既有 tooltip 同 pattern,避開
  // RAF + memo 限制(高頻 mousemove 不走 React state)。Layout 變數每次
  // render 寫進 layoutRef 給 updateCrosshair 反算 price / volume 用。
  const crosshairVRef = useRef<SVGLineElement | null>(null);
  const crosshairHRef = useRef<SVGLineElement | null>(null);
  const crosshairXLabelRef = useRef<SVGTextElement | null>(null);
  const crosshairYLabelRef = useRef<SVGTextElement | null>(null);
  const crosshairXBgRef = useRef<SVGRectElement | null>(null);
  const crosshairYBgRef = useRef<SVGRectElement | null>(null);
  const layoutRef = useRef<{
    centerX: number;
    halfW: number;
    volMax: number;
    yLow: number;
    yHigh: number;
    cH: number;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
    width: number;
    height: number;
  } | null>(null);

  const hideCrosshair = useCallback(() => {
    for (const r of [
      crosshairVRef, crosshairHRef,
      crosshairXLabelRef, crosshairYLabelRef,
      crosshairXBgRef, crosshairYBgRef,
    ]) {
      r.current?.setAttribute("opacity", "0");
    }
  }, []);

  const updateCrosshair = useCallback((mx: number, my: number) => {
    const layout = layoutRef.current;
    const v = crosshairVRef.current;
    const h = crosshairHRef.current;
    const xL = crosshairXLabelRef.current;
    const yL = crosshairYLabelRef.current;
    const xBg = crosshairXBgRef.current;
    const yBg = crosshairYBgRef.current;
    if (!layout || !v || !h || !xL || !yL || !xBg || !yBg) return;
    const {
      centerX, halfW, volMax, yLow, yHigh, cH,
      paddingLeft, paddingRight, paddingTop, paddingBottom, width, height,
    } = layout;
    // Bounds: 只在 chart 區域內顯示
    if (
      my < paddingTop || my > height - paddingBottom ||
      mx < paddingLeft || mx > width - paddingRight
    ) {
      hideCrosshair();
      return;
    }
    // Vertical line at mx
    v.setAttribute("x1", String(mx));
    v.setAttribute("x2", String(mx));
    v.setAttribute("y1", String(paddingTop));
    v.setAttribute("y2", String(height - paddingBottom));
    v.setAttribute("opacity", "1");
    // Horizontal line at my
    h.setAttribute("x1", String(paddingLeft));
    h.setAttribute("x2", String(width - paddingRight));
    h.setAttribute("y1", String(my));
    h.setAttribute("y2", String(my));
    h.setAttribute("opacity", "1");
    // X label: 張數 = |mx - centerX| / halfW * volMax(中軸=0,左右對稱)
    const volume = halfW > 0 ? Math.round(Math.abs(mx - centerX) / halfW * volMax) : 0;
    xL.textContent = String(volume);
    xL.setAttribute("x", String(mx));
    xL.setAttribute("y", String(height - paddingBottom + 16));
    xL.setAttribute("opacity", "1");
    // Y label: 價位 = yHigh - (my - paddingTop) / cH * (yHigh - yLow)
    const yRange = yHigh - yLow;
    const price = cH > 0 && yRange > 0 ? yHigh - ((my - paddingTop) / cH) * yRange : yHigh;
    const priceStr = price.toFixed(1);
    yL.textContent = priceStr;
    yL.setAttribute("x", String(paddingLeft - 6));
    yL.setAttribute("y", String(my + 4));
    yL.setAttribute("opacity", "1");
    // Backgrounds (簡單矩形,sized to label)
    const xBgW = String(volume).length * 7 + 8;
    xBg.setAttribute("x", String(mx - xBgW / 2));
    xBg.setAttribute("y", String(height - paddingBottom + 5));
    xBg.setAttribute("width", String(xBgW));
    xBg.setAttribute("height", "14");
    xBg.setAttribute("opacity", "1");
    const yBgW = priceStr.length * 6 + 8;
    yBg.setAttribute("x", String(paddingLeft - 6 - yBgW));
    yBg.setAttribute("y", String(my - 7));
    yBg.setAttribute("width", String(yBgW));
    yBg.setAttribute("height", "14");
    yBg.setAttribute("opacity", "1");
  }, [hideCrosshair]);

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
      const mx = clientX - svgRect.left;
      const my = clientY - svgRect.top;
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        updateCrosshair(mx, my);
        const hit = hitTest(clientX, clientY, svgRect);
        if (hit) {
          onBubbleHover?.(hit.payload, clientX, clientY);
        } else {
          onBubbleHover?.(null, 0, 0);
        }
      });
    },
    [hitTest, onBubbleHover, updateCrosshair],
  );

  const handleMouseLeave = useCallback(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    hideCrosshair();
    onBubbleHover?.(null, 0, 0);
  }, [onBubbleHover, hideCrosshair]);

  const handleClick = useCallback(
    (e: ReactMouseEvent<SVGRectElement>) => {
      const svg = e.currentTarget.ownerSVGElement;
      const svgRect = svg?.getBoundingClientRect();
      if (!svgRect) return;
      const hit = hitTest(e.clientX, e.clientY, svgRect);
      onBubbleClick?.(hit ? hit.payload.broker : null);
    },
    [hitTest, onBubbleClick],
  );

  // C7 A1 (🟢): Y 軸 brush drag state。drag 進行中用 svg-local y 座標暫存,
  // pointerup 時反算 price via layoutRef 提供的 sY^-1,呼叫 onYBrush。
  const [dragBrush, setDragBrush] = useState<
    { startY: number; currentY: number } | null
  >(null);

  const yToPriceFromLayout = useCallback((y: number): number | null => {
    const layout = layoutRef.current;
    if (!layout) return null;
    const yRange = layout.yHigh - layout.yLow;
    if (yRange <= 0 || layout.cH <= 0) return null;
    // clamp y to chart body
    const clampedY = Math.max(
      layout.paddingTop,
      Math.min(y, layout.paddingTop + layout.cH),
    );
    return layout.yHigh - ((clampedY - layout.paddingTop) / layout.cH) * yRange;
  }, []);

  const handleBrushDown = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!onYBrush) return;
      const svg = e.currentTarget.ownerSVGElement;
      const svgRect = svg?.getBoundingClientRect();
      if (!svgRect) return;
      const localY = e.clientY - svgRect.top;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragBrush({ startY: localY, currentY: localY });
    },
    [onYBrush],
  );

  const handleBrushMove = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!dragBrush) return;
      const svg = e.currentTarget.ownerSVGElement;
      const svgRect = svg?.getBoundingClientRect();
      if (!svgRect) return;
      const localY = e.clientY - svgRect.top;
      setDragBrush({ startY: dragBrush.startY, currentY: localY });
    },
    [dragBrush],
  );

  const handleBrushUp = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!dragBrush || !onYBrush) {
        setDragBrush(null);
        return;
      }
      // 對齊 CLAUDE.md §E:先 guard 再 release,取代 try/catch 空塊。
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const distance = Math.abs(dragBrush.currentY - dragBrush.startY);
      if (distance < BRUSH_MIN_DRAG_PX) {
        // 抗誤觸:單擊或短拖曳不觸發
        setDragBrush(null);
        return;
      }
      const priceA = yToPriceFromLayout(dragBrush.startY);
      const priceB = yToPriceFromLayout(dragBrush.currentY);
      setDragBrush(null);
      if (priceA === null || priceB === null) return;
      const priceMin = Math.min(priceA, priceB);
      const priceMax = Math.max(priceA, priceB);
      onYBrush(priceMin, priceMax);
    },
    [dragBrush, onYBrush, yToPriceFromLayout],
  );

  const handleBrushCancel = useCallback(() => {
    setDragBrush(null);
  }, []);

  // --- End hooks section ---

  if (layoutTrades.length === 0) {
    return <HintSvg width={width} height={height} text="No trade data" />;
  }

  // Axes for the unfiltered top-100 view. F11: these are reused under broker
  // filter so positions never re-flow when the user toggles a broker.
  const layoutPrices: number[] = [];
  const layoutVolumes: number[] = [];
  for (const t of layoutTrades) {
    layoutPrices.push(t.price);
    if (t.buy > VOLUME_THRESHOLD) layoutVolumes.push(t.buy);
    if (t.sell > VOLUME_THRESHOLD) layoutVolumes.push(t.sell);
  }

  // Matched broker's trades — computed ONCE and reused by the F2 axis
  // fallback below and the F11 render source further down.
  const matchedBrokerTrades: BrokerTrade[] | null = selectedBroker
    ? trades.filter((t) => t.broker === selectedBroker)
    : null;

  // F2 fallback: when the global top-100 view would be empty (quiet day),
  // derive axes from the selected broker's own data so a broker search
  // still shows them — even sub-threshold.
  const useBrokerAxes = layoutVolumes.length === 0 && !!selectedBroker;

  let prices: number[];
  let volumes: number[];
  if (useBrokerAxes) {
    prices = [];
    volumes = [];
    for (const t of matchedBrokerTrades!) {
      prices.push(t.price);
      if (t.buy > 0) volumes.push(t.buy);
      if (t.sell > 0) volumes.push(t.sell);
    }
  } else {
    prices = layoutPrices;
    volumes = layoutVolumes;
  }

  // Empty-state — nothing to plot. Either the chosen axis source has no
  // significant volume (per-broker hint when filtering) or the global view
  // is empty and no broker is selected.
  if (volumes.length === 0) {
    return (
      <HintSvg
        width={width}
        height={height}
        text={
          selectedBroker
            ? `${selectedBroker} 今日無顯著成交量`
            : "No significant volume"
        }
      />
    );
  }

  // Render source: when filtering, render only the matched broker's trades
  // with threshold bypassed (sub-threshold and outside-top-100 brokers
  // still surface). Unfiltered: top-100 gated by VOLUME_THRESHOLD.
  // C10 (🔴 Item 3): priceRange 疊加過濾 — 只留 price ∈ [min, max]。軸仍
  // 用 layoutPrices/layoutVolumes,filter 後泡泡位置不變(視覺感受為淡出
  // 而非重排),對齊 F11 axes-stable 原則。
  const priceFilteredSource: BrokerTrade[] = selectedBroker
    ? matchedBrokerTrades!
    : layoutTrades;
  const renderTrades: BrokerTrade[] = priceRange
    ? priceFilteredSource.filter(
        (t) => t.price >= priceRange.min && t.price <= priceRange.max,
      )
    : priceFilteredSource;
  const threshold = selectedBroker ? 0 : VOLUME_THRESHOLD;

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
      priceTicks.push(priceSet[priceSet.length - 1]!);
    }
  }

  // -- Volume tick levels (mirrored on both sides) -------------------------
  const volStep = niceStep(maxVolume, 4);
  const volTicks: number[] = [];
  for (let v = volStep; v <= maxVolume; v += volStep) {
    volTicks.push(v);
  }
  if (volTicks.length === 0 || volTicks[volTicks.length - 1]! < maxVolume) {
    volTicks.push((volTicks.length === 0 ? 0 : volTicks[volTicks.length - 1]!) + volStep);
  }
  const volMax = volTicks[volTicks.length - 1]!;

  // -- Build bubble data (butterfly: sell left, buy right) -----------------
  // F1: no yellow CHIP.ma5 stroke for selected broker; the header chip
  // "已篩選 1 個分點" + only the matched broker's bubbles remaining onscreen
  // already communicates the filter state.
  // F11: `renderTrades` is already pre-filtered to the matched broker (and
  // threshold pre-set to 0) when a filter is active, so this loop renders
  // EVERY matched trade — even sub-threshold ones and brokers outside the
  // top-100. Axes were derived from `layoutTrades`, so each matched bubble
  // sits at the SAME pixel position it would in the unfiltered view — the
  // chart never re-flows on filter toggle.
  const bubbles: Bubble[] = [];
  let idx = 0;
  for (const t of renderTrades) {
    if (t.buy > threshold) {
      bubbles.push({
        cx: centerX + (t.buy / volMax) * halfW,
        cy: sY(t.price),
        r: bubbleRadius(t.buy, maxVolume, MIN_R, MAX_R),
        fill: COLOR.buyFill,
        stroke: COLOR.buyStroke,
        brokerId: t.broker_id,
        key: `b-${t.broker_id}-${t.price}-${idx}`,
        payload: { broker: t.broker, brokerId: t.broker_id, volume: t.buy, price: t.price, side: "buy" },
      });
    }
    if (t.sell > threshold) {
      bubbles.push({
        cx: centerX - (t.sell / volMax) * halfW,
        cy: sY(t.price),
        r: bubbleRadius(t.sell, maxVolume, MIN_R, MAX_R),
        fill: COLOR.sellFill,
        stroke: COLOR.sellStroke,
        brokerId: t.broker_id,
        key: `s-${t.broker_id}-${t.price}-${idx}`,
        payload: { broker: t.broker, brokerId: t.broker_id, volume: t.sell, price: t.price, side: "sell" },
      });
    }
    idx++;
  }

  bubblesRef.current = bubbles;

  // Layout snapshot for crosshair reverse-mapping (pixel → price / volume)
  layoutRef.current = {
    centerX, halfW, volMax, yLow, yHigh, cH,
    paddingLeft: PADDING.left, paddingRight: PADDING.right,
    paddingTop: PADDING.top, paddingBottom: PADDING.bottom,
    width, height,
  };

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
          fontSize="0.6875rem"
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
              fontSize="0.6875rem"
            >
              {v}
            </text>
            {/* Right (buy) side */}
            <text
              x={centerX + offset}
              y={height - PADDING.bottom + 16}
              textAnchor="middle"
              fill={COLOR.text}
              fontSize="0.6875rem"
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* Background intraday close-price line — Y reuse sY price scale,
          X 軸獨立(時間 09:00→13:30)。pointer-events: none,不擋互動。
          z-order:grid → time-line → close-dashed → bubbles。 */}
      {intradayPoints && (
        <IntradayLineLayer
          points={intradayPoints}
          yLow={yLow}
          yHigh={yHigh}
          paddingLeft={PADDING.left}
          paddingTop={PADDING.top}
          chartWidth={cW}
          chartHeight={cH}
        />
      )}

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
          data-broker-id={b.brokerId}
          pointerEvents="none"
        />
      ))}

      {/* Empty-state hint — 分點過濾 or price-range filter 打空時顯示。
          C10 (🔴 Item 3): priceRange 疊加後可能 0 bubble,需 fallback 提示。 */}
      {bubbles.length === 0 && (selectedBroker || priceRange) && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill={COLOR.text}
          fontSize="0.8125rem"
        >
          {priceRange
            ? `此價位區間 (${priceRange.min.toFixed(2)}–${priceRange.max.toFixed(2)}) 無成交`
            : `${selectedBroker} 今日無顯著成交量`}
        </text>
      )}

      {/* Crosshair — ref-managed via DOM mutation, opacity 0 by default,
          shown when mouse enters chart area. V/H 雙虛線 + 軸標籤(張數 / 價位)
          給 user 精確讀數。pointer-events: none 不擋 overlay 的 mouse events。 */}
      <g pointerEvents="none" data-testid="crosshair">
        <line
          ref={crosshairVRef}
          stroke={COLOR.crosshair}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0}
          x1={0} x2={0} y1={0} y2={0}
        />
        <line
          ref={crosshairHRef}
          stroke={COLOR.crosshair}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0}
          x1={0} x2={0} y1={0} y2={0}
        />
        <rect
          ref={crosshairXBgRef}
          fill={COLOR.crosshairLabelBg}
          rx={2}
          opacity={0}
          x={0} y={0} width={0} height={0}
        />
        <text
          ref={crosshairXLabelRef}
          textAnchor="middle"
          fill={COLOR.crosshairLabelText}
          fontSize="0.6875rem"
          opacity={0}
          x={0} y={0}
        />
        <rect
          ref={crosshairYBgRef}
          fill={COLOR.crosshairLabelBg}
          rx={2}
          opacity={0}
          x={0} y={0} width={0} height={0}
        />
        <text
          ref={crosshairYLabelRef}
          textAnchor="end"
          fill={COLOR.crosshairLabelText}
          fontSize="0.6875rem"
          opacity={0}
          x={0} y={0}
        />
      </g>

      {/* C7 A1 (🟢): brush band 顯示 —— drag 進行中用 dragBrush 暫存區,
          drag 結束後靠外層傳入 brushRange prop 顯示 persistent band。
          Fill 用半透明琥珀色(對齊 CHIP.bull 系),不干擾泡泡讀圖。 */}
      {dragBrush && (
        <rect
          data-testid="bubble-brush-band"
          x={PADDING.left}
          y={Math.min(dragBrush.startY, dragBrush.currentY)}
          width={width - PADDING.left - PADDING.right}
          height={Math.abs(dragBrush.currentY - dragBrush.startY)}
          fill="rgba(240,180,41,0.1)"
          stroke="rgba(240,180,41,0.5)"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
      {!dragBrush && brushRange && brushRange.min < brushRange.max && (
        <rect
          data-testid="bubble-brush-band"
          x={PADDING.left}
          y={sY(brushRange.max)}
          width={width - PADDING.left - PADDING.right}
          height={sY(brushRange.min) - sY(brushRange.max)}
          fill="rgba(240,180,41,0.1)"
          stroke="rgba(240,180,41,0.5)"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}

      {/* 拖曳篩選提示:Y 軸 brush 沒有視覺線索(只有 hover 游標),在圖表
          左上角放常駐低調橫排提示(直排要歪頭讀,不可用)。onYBrush 未提供
          (mobile 停用 brush)不渲染;拖曳中或已有區間時隱藏,避免疊字。 */}
      {onYBrush && !dragBrush && !brushRange && (
        <text
          data-testid="bubble-brush-hint"
          x={PADDING.left + 10}
          y={PADDING.top + 14}
          textAnchor="start"
          fill={COLOR.text}
          fontSize="0.6875rem"
          opacity={0.85}
          pointerEvents="none"
        >
          ⇕ 按住左側價格軸上下拖曳,可篩選價位區間
        </text>
      )}

      {/* C7 A1 (🟢): Y 軸 brush overlay —— 覆蓋 Y 軸 label 區(x < PADDING.left)。
          drag ≥ 4px 才觸發 onYBrush;單擊不觸發。位置分離於主 overlay 之外,
          不會吃掉 bubble hit test / click 空白清 selection 邏輯。 */}
      <rect
        data-testid="bubble-yaxis-brush"
        x={0}
        y={PADDING.top}
        width={PADDING.left}
        height={cH}
        fill="transparent"
        onPointerDown={handleBrushDown}
        onPointerMove={handleBrushMove}
        onPointerUp={handleBrushUp}
        onPointerCancel={handleBrushCancel}
        style={{ cursor: onYBrush ? "ns-resize" : "default", touchAction: "none" }}
      />

      {/* Invisible overlay for mouse interaction (bubble hit test + click empty
          area). C7 A1: 從 x=PADDING.left 起,不佔 Y 軸 brush 區域,兩個 overlay
          幾何分離,無事件衝突。data-testid 供 SC-A1c blank-click 測試觸發。 */}
      <rect
        data-testid="bubble-main-overlay"
        x={PADDING.left}
        y={0}
        width={width - PADDING.left}
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
