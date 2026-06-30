import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrokerDaily, ChipHistory } from "../lib/chip-data";
import {
  KlineChartSvg,
  rollingMean,
  calcBollinger,
} from "../lib/chip-kline-svg";
import { InstBarSvg, MarginLineSvg } from "../lib/chip-inst-bar-svg";
import { BrokerAggBarSvg } from "../lib/chip-broker-agg-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { computeRangeBand } from "../lib/chip-range-band";

interface Props {
  history: ChipHistory | null;
  selectedDate: string;
  // Selection keyed by broker_id (FinMind `securities_trader_id`). The
  // component itself only reads `.size` for visibility + count; the actual
  // series data is looked up via `brokerSeries` (also keyed by id).
  selectedBrokerIds: Set<string>;
  brokerSeries: Map<string, BrokerDaily[]>;
  onPickDate: (date: string) => void;
  onClearAllBrokers: () => void;
  /** Whether a symbol-driven fetch is in flight (history or aggregate).
   *  Drives a top-edge scanning bar + optional centre badge so the user has
   *  visible feedback that picking a symbol triggered work. We do NOT branch
   *  on this for the actual K-line render (which keeps the previous symbol's
   *  data visible via TanStack Query placeholderData). */
  loading?: boolean;
  /** Symbol the loading badge announces (e.g. "2330"). Optional. */
  loadingSymbol?: string;
  /** Major-net per-day fan-out still pending: K-line + other subcharts render
   *  normally; the 主力買賣超 subchart overlays "資料載入中" until major lands.
   *  Decoupled from `loading` so the global header spinner doesn't sit ~24s. */
  majorLoading?: boolean;
  /** chip-controls-v2: N 日聚合視窗。> 1 時 K 線 + subchart 顯示半透明區間 band,
   *  涵蓋從 selectedDate 往前 N-1 個 trading day。<=1 / undefined 不渲染。 */
  windowDays?: number;
}

const KLINE_ZOOM_MIN = 30;     // 太小無法看 BB(period 20) + MA20
const KLINE_ZOOM_DEFAULT = 90;
const KLINE_ZOOM_STEP = 10;    // 每次滾輪 ±10 個 trading days
const PAN_THRESHOLD = 5;       // 拖曳超過 5px 才算 pan(避免吃掉點擊選日)
const PAN_CLICK_SUPPRESS_MS = 200;

export function ChipKlineChart({
  history, selectedDate, selectedBrokerIds, brokerSeries,
  onPickDate, onClearAllBrokers,
  loading, loadingSymbol, majorLoading,
  windowDays,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useContainerSize(containerRef);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // F6: horizontal price crosshair Y coordinate. Local-only; sub-charts do
  // NOT receive it (their Y-axis carries no meaningful price/value mapping
  // for a per-row crosshair).
  const [hoverY, setHoverY] = useState<number | null>(null);

  // K-line visible-days zoom controlled by mouse wheel on the chart area.
  // Initial 90 keeps existing visual density; user scrolls down → zoom OUT
  // (more days visible, smaller candles); up → zoom IN.
  const [visibleDays, setVisibleDays] = useState<number>(KLINE_ZOOM_DEFAULT);
  const maxLenRef = useRef(0);
  const visibleDaysRef = useRef(visibleDays);
  useEffect(() => { visibleDaysRef.current = visibleDays; }, [visibleDays]);

  // 點擊拖曳 pan:viewEndIdx=null 表示「自動跟最新一根」(預設),number
  // 表示視窗右邊界鎖在該 raw index;拖曳時更新此值來平移視窗。
  const [viewEndIdx, setViewEndIdx] = useState<number | null>(null);
  // panDragRef 紀錄拖曳起點 + initial viewEndIdx + container rect
  const panDragRef = useRef<{
    startX: number;
    initialEndIdx: number;
    rect: DOMRect;
    triggered: boolean;
  } | null>(null);
  // suppressNextClickRef 在 pan 結束後阻止 KlineChartSvg 的 onClickIndex
  // 觸發(pointerup 還會 fire 一個 click event;沒有此 ref 會誤選日期)
  const suppressNextClickRef = useRef(false);

  const fullDerived = useMemo(() => {
    if (!history) return null;
    const { candles, institutional, margin, major } = history;
    const instByDate = new Map(institutional.map((d) => [d.date, d]));
    const majorByDate = new Map((major ?? []).map((d) => [d.date, d]));
    const marginByDate = new Map(margin.map((d) => [d.date, d]));
    return {
      candles,
      majorNet: candles.map((c) => majorByDate.get(c.date)?.major_net ?? 0),
      foreignNet: candles.map((c) => instByDate.get(c.date)?.foreign_net ?? 0),
      trustNet: candles.map((c) => instByDate.get(c.date)?.trust_net ?? 0),
      dealerNet: candles.map((c) => instByDate.get(c.date)?.dealer_net ?? 0),
      marginChange: candles.map((c) => marginByDate.get(c.date)?.margin_change ?? 0),
      shortChange: candles.map((c) => marginByDate.get(c.date)?.short_change ?? 0),
      marginBalance: candles.map((c) => marginByDate.get(c.date)?.margin_balance ?? 0),
      shortBalance: candles.map((c) => marginByDate.get(c.date)?.short_balance ?? 0),
    };
  }, [history]);

  // Keep maxLenRef in sync without recreating the wheel listener.
  useEffect(() => {
    maxLenRef.current = fullDerived?.candles.length ?? 0;
    // 當 history payload 變短(不太可能)或第一次 mount 時 clamp 一下
    if (maxLenRef.current > 0) {
      setVisibleDays((v) => Math.min(v, maxLenRef.current));
      // viewEndIdx 若指向已不存在的 index → 退回 auto
      setViewEndIdx((v) => (v === null || v >= maxLenRef.current ? null : v));
    }
  }, [fullDerived]);

  // Wheel attached imperatively so we can preventDefault (React's onWheel
  // is passive by default in many browsers; passive listeners ignore
  // preventDefault and the page scrolls instead of the chart zooming).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const max = maxLenRef.current;
      if (max === 0 || e.deltaY === 0) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? KLINE_ZOOM_STEP : -KLINE_ZOOM_STEP;
      setVisibleDays((v) => {
        const next = v + delta;
        if (next < KLINE_ZOOM_MIN) return KLINE_ZOOM_MIN;
        if (next > max) return max;
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Document-level pointermove / pointerup 監聽。effect deps=[],拿不到
  // visibleDays state — 用 visibleDaysRef + maxLenRef 解決。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = panDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      if (!drag.triggered && Math.abs(dx) < PAN_THRESHOLD) return;
      drag.triggered = true;
      const total = maxLenRef.current;
      const visible = visibleDaysRef.current;
      if (total === 0 || drag.rect.width <= 0 || visible <= 0) return;
      // candle 視覺寬度 = container width / visibleDays
      const candleW = drag.rect.width / visible;
      // 向右拖(dx>0)= 看更早 = endIdx 變小
      const dxCandles = Math.round(dx / candleW);
      const newEnd = drag.initialEndIdx - dxCandles;
      const minEnd = Math.min(total - 1, visible - 1);  // 還要有夠 candles 填滿視窗
      const maxEnd = total - 1;
      const clamped = Math.max(minEnd, Math.min(maxEnd, newEnd));
      // 若 clamped 已回到最右,設成 null = auto;否則 anchored
      setViewEndIdx(clamped === maxEnd ? null : clamped);
    };
    const onUp = () => {
      const drag = panDragRef.current;
      panDragRef.current = null;
      if (drag?.triggered) {
        // 拖過閾值才 suppress click — 純點擊不會落這
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, PAN_CLICK_SUPPRESS_MS);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const total = maxLenRef.current;
    if (!rect || total === 0) return;
    const currentEnd = viewEndIdx !== null
      ? Math.min(viewEndIdx, total - 1)
      : total - 1;
    panDragRef.current = {
      startX: e.clientX,
      initialEndIdx: currentEnd,
      rect,
      triggered: false,
    };
  };

  const handleDoubleClick = () => {
    setViewEndIdx(null);
    setVisibleDays(KLINE_ZOOM_DEFAULT);
  };

  const windowRange = useMemo(() => {
    if (!fullDerived) return null;
    const total = fullDerived.candles.length;
    const end = viewEndIdx !== null
      ? Math.min(viewEndIdx, total - 1)
      : total - 1;
    const n = Math.min(visibleDays, end + 1);
    const start = Math.max(0, end - n + 1);
    return { start, end, total };
  }, [fullDerived, viewEndIdx, visibleDays]);

  const derived = useMemo(() => {
    if (!fullDerived || !windowRange) return null;
    const { start, end, total } = windowRange;
    if (start === 0 && end === total - 1) return fullDerived;
    return {
      candles: fullDerived.candles.slice(start, end + 1),
      majorNet: fullDerived.majorNet.slice(start, end + 1),
      foreignNet: fullDerived.foreignNet.slice(start, end + 1),
      trustNet: fullDerived.trustNet.slice(start, end + 1),
      dealerNet: fullDerived.dealerNet.slice(start, end + 1),
      marginChange: fullDerived.marginChange.slice(start, end + 1),
      shortChange: fullDerived.shortChange.slice(start, end + 1),
      marginBalance: fullDerived.marginBalance.slice(start, end + 1),
      shortBalance: fullDerived.shortBalance.slice(start, end + 1),
    };
  }, [fullDerived, windowRange]);

  // BB / MA 用 FULL history 算,再切到視窗範圍 — 這樣 zoom 視窗左邊界已是有
  // 足夠 history 的 candle 時,MA20 / BB(20,2) 就能延伸到第一根 candle,
  // 不會像 "前 19 個 null" 那樣斷開。
  const slicedIndicators = useMemo(() => {
    if (!fullDerived || !windowRange) return null;
    const closes = fullDerived.candles.map((c) => c.close);
    const allMa5 = rollingMean(closes, 5);
    const allMa20 = rollingMean(closes, 20);
    const allBb = calcBollinger(closes, 20, 2);
    const { start, end } = windowRange;
    return {
      ma5: allMa5.slice(start, end + 1),
      ma20: allMa20.slice(start, end + 1),
      bb: {
        middle: allBb.middle.slice(start, end + 1),
        upper: allBb.upper.slice(start, end + 1),
        lower: allBb.lower.slice(start, end + 1),
      },
    };
  }, [fullDerived, windowRange]);

  const brokerAggSeries = useMemo(() => {
    if (!derived) return [] as number[];
    const dateNet = new Map<string, number>();
    for (const arr of brokerSeries.values()) {
      for (const d of arr) {
        dateNet.set(d.date, (dateNet.get(d.date) ?? 0) + d.net);
      }
    }
    return derived.candles.map((c) => dateNet.get(c.date) ?? 0);
  }, [derived, brokerSeries]);

  const handleClickIndex = useCallback(
    (i: number) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (!derived) return;
      onPickDate(derived.candles[i]!.date);
    },
    [onPickDate, derived],
  );

  // F3 loading-gate intent: this component does NOT branch on `loading` for
  // the K-line render itself — TanStack Query `placeholderData` keeps the
  // previous symbol's candles visible across pivots. `loading` only drives
  // the top-edge scanning bar + centre "載入 {symbol} 中…" badge so the user
  // has visible feedback that picking a symbol kicked off work.
  if (!derived) {
    return (
      <div
        ref={containerRef}
        className="h-full flex flex-col items-center justify-center text-ink-dim font-serif italic text-sm gap-3"
      >
        {loading && loadingSymbol ? (
          <>
            <svg
              viewBox="0 0 24 24" fill="none" aria-hidden="true"
              className="size-6 animate-spin text-accent motion-reduce:animate-none"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span>載入 {loadingSymbol} 中…</span>
          </>
        ) : (
          <span>請搜尋股票代號以載入K線圖</span>
        )}
      </div>
    );
  }

  const {
    candles, majorNet, foreignNet, trustNet, dealerNet,
    marginChange, shortChange, marginBalance, shortBalance,
  } = derived;

  const selectedIndex = (() => {
    if (!selectedDate) return null;
    const i = candles.findIndex((c) => c.date === selectedDate);
    return i >= 0 ? i : null;
  })();

  // chip-controls-v2: compute range band from sliced candles + windowDays.
  // null when windowDays <= 1, selectedDate not visible, or no candles.
  const rangeBand = computeRangeBand(selectedIndex, windowDays ?? 0, candles.length);

  const w = width || 600;
  const totalH = height || 500;

  const showBrokerRow = selectedBrokerIds.size > 0;
  const gap = 6;
  // K-line takes 3.5 parts; remainder split across sub-charts.
  // Total = 3.5 + 5 (or 6 if broker row visible).
  const totalParts = 3.5 + (showBrokerRow ? 6 : 5);
  const klineH = Math.round((totalH - gap) * (3.5 / totalParts));
  const subCount = showBrokerRow ? 6 : 5;
  const subH = Math.floor((totalH - gap - klineH) / subCount);
  const lastSubH = totalH - gap - klineH - subH * (subCount - 1);

  return (
    <div
      ref={containerRef}
      data-testid="chip-kline-chart"
      className="h-full flex flex-col overflow-hidden relative cursor-grab active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Top-edge scanning bar: 2 px accent shimmer when symbol-driven fetch
          is in flight. Always rendered (h-0.5) so toggling doesn't shift the
          K-line area by 2 px. Mirrors ChipBrokersPanel's panel-loading bar. */}
      <div className="relative h-0.5 overflow-hidden shrink-0" aria-hidden="true">
        {loading && (
          <div
            data-testid="kline-loading-indicator"
            className="absolute inset-0 bg-line/30"
          >
            <div className="absolute inset-y-0 left-0 w-1/4 bg-accent animate-[loading-shimmer_1.4s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-60" />
          </div>
        )}
      </div>
      <div
        data-testid="kline-zoom-hud"
        className="absolute top-2 right-2 z-30 text-xs text-ink-dim bg-bg-deep/80 px-2 py-0.5 border border-line tabular-nums select-none pointer-events-none"
        title="滾輪縮放 / 拖曳平移 / 雙擊重置"
      >
        {candles.length} 日{viewEndIdx !== null ? " · 平移中" : ""}
      </div>
      {loading && loadingSymbol && (
        <div
          data-testid="kline-loading-badge"
          className="absolute top-2 left-1/2 -translate-x-1/2 z-30 text-xs text-ink bg-bg-deep/90 px-3 py-1 border border-accent rounded shadow pointer-events-none flex items-center gap-2"
          aria-live="polite"
        >
          <svg
            viewBox="0 0 24 24" fill="none" aria-hidden="true"
            className="size-3.5 animate-spin text-accent motion-reduce:animate-none"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          載入 {loadingSymbol} 中…
        </div>
      )}
      {rangeBand && windowDays !== undefined && (
        <div
          data-testid="kline-range-chip"
          className="absolute top-2 left-2 z-20 text-xs text-ink-dim bg-bg-deep/80 px-2 py-0.5 border border-line tabular-nums select-none pointer-events-none"
          title={`過去 ${windowDays} 日聚合範圍`}
        >
          過去 {windowDays} 日
        </div>
      )}
      <div style={{ height: klineH, minHeight: 0 }}>
        {klineH > 0 && (
          <KlineChartSvg
            candles={candles}
            width={w}
            height={klineH}
            hoverIndex={hoverIndex}
            onHoverIndex={setHoverIndex}
            hoverY={hoverY}
            onHoverY={setHoverY}
            selectedIndex={selectedIndex}
            onClickIndex={handleClickIndex}
            ma5Override={slicedIndicators?.ma5}
            ma20Override={slicedIndicators?.ma20}
            bbOverride={slicedIndicators?.bb}
            rangeBand={rangeBand}
          />
        )}
      </div>
      <div
        style={{
          height: gap, minHeight: gap, background: "#14110c",
          borderTop: "1px solid #2e2a22", borderBottom: "1px solid #2e2a22",
        }}
      />
      <div
        className="relative border-t border-line/50"
        style={{ height: subH, minHeight: 0 }}
      >
        {subH > 0 && (
          <InstBarSvg
            data={majorNet} width={w} height={subH}
            label="主力買賣超" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
        {majorLoading && subH > 0 && (
          <div
            data-testid="major-loading-overlay"
            className="absolute inset-0 flex items-center justify-center bg-bg-deep/40 pointer-events-none"
            aria-live="polite"
          >
            <span className="text-xs text-ink-dim bg-bg-deep/85 px-2 py-0.5 border border-line flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24" fill="none" aria-hidden="true"
                className="size-3 animate-spin text-accent motion-reduce:animate-none"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              主力資料載入中…
            </span>
          </div>
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={foreignNet} width={w} height={subH}
            label="外資" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={trustNet} width={w} height={subH}
            label="投信" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={dealerNet} width={w} height={subH}
            label="自營商" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div
        className="border-t border-line/50"
        style={{ height: showBrokerRow ? subH : lastSubH, minHeight: 0 }}
      >
        {(showBrokerRow ? subH : lastSubH) > 0 && (
          <MarginLineSvg
            marginData={marginChange}
            shortData={shortChange}
            marginBalanceData={marginBalance}
            shortBalanceData={shortBalance}
            width={w}
            height={showBrokerRow ? subH : lastSubH}
            label="融資融券"
            hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      {showBrokerRow && (
        <div
          className="border-t border-line/50 relative"
          style={{ height: lastSubH, minHeight: 0 }}
        >
          {lastSubH > 0 && (
            <BrokerAggBarSvg
              data={brokerAggSeries}
              width={w}
              height={lastSubH}
              label={`分點 (${selectedBrokerIds.size})`}
              hoverIndex={hoverIndex}
              selectedIndex={selectedIndex}
            />
          )}
          <button
            type="button"
            onClick={onClearAllBrokers}
            className="absolute right-2 top-1 text-xs text-ink-dim hover:text-bear cursor-pointer"
          >清除</button>
        </div>
      )}
    </div>
  );
}
