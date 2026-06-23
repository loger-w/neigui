import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import type { ChipBubbleData, TradeRow } from "../lib/chip-data";
import { aggregateByPrice, buildTradeRows, fmtVol } from "../lib/chip-data";
import { BubbleChartSvg, type BubbleHoverPayload } from "../lib/chip-bubble-svg";
import { PriceBarSvg } from "../lib/chip-price-bar-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { BrokerSearch } from "./BrokerSearch";

interface Props {
  bubbleData: ChipBubbleData | null;
  closePrice?: number;
  symbol: string;
}

// F12: surface every broker who traded today, including 1-張 ones. The
// bubble chart still applies its own threshold/top-100 layout slice; the
// right-side trade list intentionally does NOT — the user explicitly wants
// the long tail visible there.
const MAX_TRADE_ROWS = Number.POSITIVE_INFINITY;

export function ChipBubbleView({ bubbleData, closePrice, symbol }: Props) {
  const [selectedBroker, setSelectedBroker] = useState<string | null>(null);

  // Reset selection ONLY on symbol change (NOT on date / bubbleData change)
  useEffect(() => {
    setSelectedBroker(null);
  }, [symbol]);

  const uniqueBrokerCount = useMemo(
    () => new Set(bubbleData?.trades.map((t) => t.broker) ?? []).size,
    [bubbleData],
  );

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const priceBarRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const bubbleSize = useContainerSize(bubbleRef);
  const priceBarSize = useContainerSize(priceBarRef);

  const handleBubbleHover = useCallback(
    (payload: BubbleHoverPayload | null, x: number, y: number) => {
      const el = tooltipRef.current;
      if (!el) return;
      if (!payload) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.style.left = `${Math.min(x + 12, window.innerWidth - 200)}px`;
      el.style.top = `${Math.min(y - 10, window.innerHeight - 100)}px`;
      const nameEl = el.querySelector("[data-tt=name]");
      const detailEl = el.querySelector("[data-tt=detail]");
      const priceEl = el.querySelector("[data-tt=price]");
      if (nameEl) nameEl.textContent = payload.broker;
      if (detailEl)
        detailEl.textContent = `${payload.side === "buy" ? "買" : "賣"}: ${payload.volume} 張`;
      if (priceEl) priceEl.textContent = `價格: ${payload.price}`;
    },
    [],
  );

  const handleBubbleClick = useCallback((broker: string | null) => {
    if (broker === null) {
      setSelectedBroker(null);
    } else {
      setSelectedBroker((prev) => (prev === broker ? null : broker));
    }
  }, []);

  const allPriceAggs = useMemo(() => {
    if (!bubbleData) return [];
    return aggregateByPrice(bubbleData.trades);
  }, [bubbleData]);

  const priceAggs = useMemo(() => {
    if (!bubbleData || !selectedBroker) return allPriceAggs;
    const filtered = bubbleData.trades.filter((t) => t.broker === selectedBroker);
    if (filtered.length === 0) return allPriceAggs;
    const filteredAggs = aggregateByPrice(filtered);
    const filteredPrices = new Set(filteredAggs.map((a) => a.price));
    return allPriceAggs.map((a) =>
      filteredPrices.has(a.price)
        ? filteredAggs.find((f) => f.price === a.price)!
        : { price: a.price, buy: 0, sell: 0 },
    );
  }, [bubbleData, selectedBroker, allPriceAggs]);

  // Bug fix: filter must precede the top-N slice. Building the rows then
  // slicing drops every row that fell behind the global top-200 cap, which
  // was hiding most of a small-volume broker's price levels after filter.
  const { buyRows: filteredBuyRows, sellRows: filteredSellRows } = useMemo(() => {
    if (!bubbleData) return { buyRows: [] as TradeRow[], sellRows: [] as TradeRow[] };
    return buildTradeRows(bubbleData.trades, selectedBroker, MAX_TRADE_ROWS);
  }, [bubbleData, selectedBroker]);

  return (
    <div className="h-full grid grid-cols-[1fr_400px] gap-0 overflow-hidden">
      {/* Left: header search bar + bubble chart */}
      <div className="h-full flex flex-col min-h-0 border-r border-line overflow-hidden">
        <div className="shrink-0 h-10 px-3 border-b border-line bg-bg-deep/30 flex items-center gap-3">
          <BrokerSearch
            trades={bubbleData?.trades ?? []}
            value={selectedBroker}
            onChange={setSelectedBroker}
          />
          <span className="text-xs text-ink-dim">
            {selectedBroker ? (
              <>已篩選 <span className="text-[#f0b429] font-medium">1</span> 個分點</>
            ) : (
              <>今日共 <span className="text-[#b794f4] font-medium">{uniqueBrokerCount}</span> 個分點</>
            )}
          </span>
        </div>
        <div ref={bubbleRef} className="flex-1 min-h-0 overflow-hidden">
          {!bubbleData ? (
            <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
              請搜尋股票代號以載入泡泡圖
            </div>
          ) : bubbleSize.width > 0 && bubbleSize.height > 0 ? (
            <BubbleChartSvg
              trades={bubbleData.trades}
              width={bubbleSize.width}
              height={bubbleSize.height}
              closePrice={closePrice}
              selectedBroker={selectedBroker}
              onBubbleHover={handleBubbleHover}
              onBubbleClick={handleBubbleClick}
            />
          ) : null}
        </div>
      </div>

      {/* Right: Price bars + side-by-side buy/sell trade lists */}
      <div className="h-full flex flex-col overflow-hidden">
        {/* Price bar sub-chart */}
        <div ref={priceBarRef} className="h-[180px] shrink-0 border-b border-line">
          {priceBarSize.width > 0 && priceAggs.length > 0 && (
            <PriceBarSvg data={priceAggs} width={priceBarSize.width} height={180} />
          )}
        </div>

        {/* Side-by-side buy/sell lists */}
        <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-line">
          <TradeList
            rows={filteredBuyRows}
            side="buy"
            selectedBroker={selectedBroker}
            onSelect={handleBubbleClick}
          />
          <TradeList
            rows={filteredSellRows}
            side="sell"
            selectedBroker={selectedBroker}
            onSelect={handleBubbleClick}
          />
        </div>
      </div>

      {/* Ref-based tooltip — updated via DOM, no React re-render */}
      <div
        ref={tooltipRef}
        hidden
        style={{
          position: "fixed",
          background: "#1d1812",
          border: "1px solid #4a4234",
          color: "#ede4d3",
          fontFamily: '"Inter Tight", system-ui, sans-serif',
          fontSize: 13,
          padding: "8px 12px",
          borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          pointerEvents: "none" as const,
          zIndex: 50,
          whiteSpace: "nowrap" as const,
          lineHeight: 1.5,
        }}
      >
        <div data-tt="name" style={{ fontWeight: 600 }} />
        <div data-tt="detail" />
        <div data-tt="price" />
      </div>
    </div>
  );
}

const TradeList = memo(function TradeList({
  rows,
  side,
  selectedBroker,
  onSelect,
}: {
  rows: TradeRow[];
  side: "buy" | "sell";
  selectedBroker: string | null;
  onSelect: (broker: string | null) => void;
}) {
  const isBuy = side === "buy";
  const colorClass = isBuy ? "text-accent" : "text-bear";
  const bgClass = isBuy ? "bg-accent/[0.04]" : "bg-bear/[0.04]";
  const activeClass = isBuy ? "bg-accent/[0.08]" : "bg-bear/[0.08]";

  return (
    <div className="flex flex-col overflow-hidden">
      <div
        className={`shrink-0 px-2 py-1.5 text-sm ${colorClass} ${bgClass} border-b border-line font-medium grid grid-cols-[1fr_56px_56px]`}
      >
        <span>分點</span>
        <span className="text-right">張數</span>
        <span className="text-right">價位</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 scroll-editorial">
        {rows.map((r, i) => (
          <button
            key={`${side[0]}${i}`}
            type="button"
            onClick={() => onSelect(r.broker)}
            className={`w-full grid grid-cols-[1fr_56px_56px] text-xs px-2 py-1 border-b border-line/20 cursor-pointer transition-colors ${
              selectedBroker === r.broker
                ? `${activeClass} text-ink`
                : "hover:bg-bg-deep/50 text-ink-muted"
            }`}
          >
            <span className="text-left truncate">{r.broker}</span>
            <span className={`text-right tabular-nums ${colorClass}`}>
              {fmtVol(r.volume)}
            </span>
            <span className="text-right tabular-nums">{r.price}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
