import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrokerDaily, ChipHistory } from "../lib/chip-data";
import { KlineChartSvg } from "../lib/chip-kline-svg";
import { InstBarSvg, MarginLineSvg } from "../lib/chip-inst-bar-svg";
import { BrokerAggBarSvg } from "../lib/chip-broker-agg-svg";
import { useContainerSize } from "../hooks/useContainerSize";

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
}

const KLINE_ZOOM_MIN = 30;     // 太小無法看 BB(period 20) + MA20
const KLINE_ZOOM_DEFAULT = 90;
const KLINE_ZOOM_STEP = 10;    // 每次滾輪 ±10 個 trading days
const BRUSH_THRESHOLD = 5;     // 拖曳超過 5px 才算 brush(避免吃掉點擊)
const BRUSH_CLICK_SUPPRESS_MS = 250;

export function ChipKlineChart({
  history, selectedDate, selectedBrokerIds, brokerSeries,
  onPickDate, onClearAllBrokers,
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

  // 拖曳 brush-zoom:框選一段 → 視窗 anchor 到該段。viewEndIdx=null 表示「
  // 自動跟最新一根」(預設行為),number 表示視窗右邊界鎖在該 raw index。
  const [viewEndIdx, setViewEndIdx] = useState<number | null>(null);
  // brushRect 是 visual overlay(framed selection),null 時不顯示。
  const [brushRect, setBrushRect] = useState<{ left: number; width: number } | null>(null);
  // brushDragRef 紀錄拖曳起點 + container rect(避免 drag 中 rect 重算)
  const brushDragRef = useRef<{ startX: number; rect: DOMRect } | null>(null);
  // suppressNextClickRef 在 brush commit 後阻止 KlineChartSvg 的 onClickIndex
  // 觸發(pointerup 還會 fire 一個 click event,我們不想 select date)
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

  // Document-level pointermove / pointerup 監聽,只在拖曳 active 才做事。
  // brushDragRef.current 是「拖曳中」的旗標。pointerdown 設旗標,pointerup
  // 清旗標;effect 沒 deps 避免 re-attach。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = brushDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) < BRUSH_THRESHOLD) return;
      const x0 = Math.min(drag.startX, e.clientX) - drag.rect.left;
      const x1 = Math.max(drag.startX, e.clientX) - drag.rect.left;
      setBrushRect({
        left: Math.max(0, x0),
        width: Math.max(0, x1 - Math.max(0, x0)),
      });
    };
    const onUp = (e: PointerEvent) => {
      const drag = brushDragRef.current;
      brushDragRef.current = null;
      if (!drag) {
        setBrushRect(null);
        return;
      }
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) < BRUSH_THRESHOLD) {
        // 沒拖到閾值 → 視為點擊,不消耗,讓 SVG 內 click handler 正常 fire
        setBrushRect(null);
        return;
      }
      const n = maxLenRef.current;
      if (n > 0 && drag.rect.width > 0) {
        const candleW = drag.rect.width / n;
        const x0 = Math.max(0, Math.min(drag.startX, e.clientX) - drag.rect.left);
        const x1 = Math.max(0, Math.max(drag.startX, e.clientX) - drag.rect.left);
        const startIdx = Math.max(0, Math.floor(x0 / candleW));
        const endIdx = Math.min(n - 1, Math.floor(x1 / candleW));
        if (endIdx > startIdx) {
          const span = endIdx - startIdx + 1;
          setViewEndIdx(endIdx);
          setVisibleDays(Math.max(KLINE_ZOOM_MIN, span));
          // pointerup 後仍會 fire 一個 click event;suppress it
          suppressNextClickRef.current = true;
          setTimeout(() => {
            suppressNextClickRef.current = false;
          }, BRUSH_CLICK_SUPPRESS_MS);
        }
      }
      setBrushRect(null);
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
    if (!rect) return;
    brushDragRef.current = { startX: e.clientX, rect };
  };

  const handleDoubleClick = () => {
    setViewEndIdx(null);
    setVisibleDays(KLINE_ZOOM_DEFAULT);
  };

  const derived = useMemo(() => {
    if (!fullDerived) return null;
    const total = fullDerived.candles.length;
    const end = viewEndIdx !== null
      ? Math.min(viewEndIdx, total - 1)
      : total - 1;
    const n = Math.min(visibleDays, end + 1);
    const start = Math.max(0, end - n + 1);
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
  }, [fullDerived, visibleDays, viewEndIdx]);

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

  // Loading-gate intent: this component must NEVER receive or branch on a
  // loading prop. F3 requires that picking a candle re-renders only the right
  // panel — the K-line stays visible throughout. Re-renders here are driven
  // strictly by changes to history / selectedDate / selectedBrokerNames /
  // brokerSeries; never by a "summary loading" flag.
  if (!derived) {
    return (
      <div
        ref={containerRef}
        className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm"
      >
        請搜尋股票代號以載入K線圖
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
      className="h-full flex flex-col overflow-hidden relative cursor-crosshair"
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="kline-zoom-hud"
        className="absolute top-1.5 right-2 z-30 text-xs text-ink-dim bg-bg-deep/80 px-2 py-0.5 border border-line tabular-nums select-none pointer-events-none"
        title="滾輪縮放 / 拖曳框選 / 雙擊重置"
      >
        {candles.length} 日{viewEndIdx !== null ? " · 已框選" : ""}
      </div>
      {brushRect && (
        <div
          data-testid="kline-brush-rect"
          className="absolute top-0 bottom-0 bg-accent/10 border-l border-r border-accent pointer-events-none z-20"
          style={{ left: brushRect.left, width: brushRect.width }}
        />
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
          />
        )}
      </div>
      <div
        style={{
          height: gap, minHeight: gap, background: "#14110c",
          borderTop: "1px solid #2e2a22", borderBottom: "1px solid #2e2a22",
        }}
      />
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={majorNet} width={w} height={subH}
            label="主力買賣超" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
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
