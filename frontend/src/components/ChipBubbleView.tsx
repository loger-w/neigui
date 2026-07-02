import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  ChipBubbleData, IntradayPoint, SortDir, SortSpec, TradeRow, TradeSortKey,
} from "../lib/chip-data";
import {
  DEFAULT_TRADE_SORT, aggregateByPrice, buildTradeRows, computeBrokerTotals,
  fmtAmount, fmtVol,
} from "../lib/chip-data";
import { BubbleChartSvg, type BubbleHoverPayload } from "../lib/chip-bubble-svg";
import { PriceBarSvg } from "../lib/chip-price-bar-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { BrokerSearch } from "./BrokerSearch";

interface Props {
  bubbleData: ChipBubbleData | null;
  closePrice?: number;
  symbol: string;
  /** Optional 當日分時走勢線 (背景). 透傳給 BubbleChartSvg.
   *  Hook mount 在 App.tsx,對齊既有 useChipBubble 樣板。 */
  intradayPoints?: IntradayPoint[] | null;
  /** C2 A2: 跳到籌碼總覽並帶入 broker(s)。App.tsx 掛 handler 切 tab +
   *  setSelectedBrokerIds。signature 一次寫對 string | string[] 讓 C7
   *  brush 篩多 broker 情境不需要再擴充,C7 可獨立 revert。未提供時,
   *  header 顯 fallback 文字「已篩選 1 個分點」。 */
  onJumpToOverview?: (brokerIdOrIds: string | string[]) => void;
  /** C5 A5: symbol 已選但 bubble fetch 未回時顯 badge。對齊
   *  ChipKlineChart 的 loading badge pattern(L338-370)。 */
  loading?: boolean;
}

// F12: surface every broker who traded today, including 1-張 ones. The
// bubble chart still applies its own threshold/top-100 layout slice; the
// right-side trade list intentionally does NOT — the user explicitly wants
// the long tail visible there.
const MAX_TRADE_ROWS = Number.POSITIVE_INFINITY;

export function ChipBubbleView({
  bubbleData,
  closePrice,
  symbol,
  intradayPoints,
  onJumpToOverview,
  loading,
}: Props) {
  // C1 🔵: selection state 存 broker_id(FinMind securities_trader_id),
  // 對齊 App.tsx selectedBrokerIds 契約,方便 A2 一鍵跳籌碼總覽。
  // 下游元件(BrokerSearch / BubbleChartSvg / buildTradeRows / TradeList)
  // 仍接 name string,靠 selectedBrokerName derived 回傳。
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null);
  const [buySort, setBuySort] = useState<SortSpec>(DEFAULT_TRADE_SORT);
  const [sellSort, setSellSort] = useState<SortSpec>(DEFAULT_TRADE_SORT);

  // Reset selection ONLY on symbol change (NOT on date / bubbleData change)
  useEffect(() => {
    setSelectedBrokerId(null);
  }, [symbol]);

  const selectedBrokerName = useMemo(
    () =>
      bubbleData?.trades.find((t) => t.broker_id === selectedBrokerId)?.broker ??
      null,
    [bubbleData, selectedBrokerId],
  );

  const handleBuySortChange = useCallback((key: TradeSortKey) => {
    setBuySort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }, []);
  const handleSellSortChange = useCallback((key: TradeSortKey) => {
    setSellSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }, []);

  const uniqueBrokerCount = useMemo(
    () => new Set(bubbleData?.trades.map((t) => t.broker) ?? []).size,
    [bubbleData],
  );

  // C6 A3: 選中分點的總買/賣張 + 精確成交金額。
  const brokerTotals = useMemo(
    () => computeBrokerTotals(bubbleData?.trades ?? [], selectedBrokerId),
    [bubbleData, selectedBrokerId],
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

  // C1 🔵: svg / TradeList 回傳 broker name;此 handler 轉 id set state。
  const handleBubbleClick = useCallback(
    (broker: string | null) => {
      if (broker === null) {
        setSelectedBrokerId(null);
        return;
      }
      const id =
        bubbleData?.trades.find((t) => t.broker === broker)?.broker_id ?? null;
      if (id === null) return;
      setSelectedBrokerId((prev) => (prev === id ? null : id));
    },
    [bubbleData],
  );

  const allPriceAggs = useMemo(() => {
    if (!bubbleData) return [];
    return aggregateByPrice(bubbleData.trades);
  }, [bubbleData]);

  const priceAggs = useMemo(() => {
    if (!bubbleData || !selectedBrokerName) return allPriceAggs;
    const filtered = bubbleData.trades.filter((t) => t.broker === selectedBrokerName);
    if (filtered.length === 0) return allPriceAggs;
    const filteredAggs = aggregateByPrice(filtered);
    const filteredPrices = new Set(filteredAggs.map((a) => a.price));
    return allPriceAggs.map((a) =>
      filteredPrices.has(a.price)
        ? filteredAggs.find((f) => f.price === a.price)!
        : { price: a.price, buy: 0, sell: 0 },
    );
  }, [bubbleData, selectedBrokerName, allPriceAggs]);

  // Bug fix: filter must precede the top-N slice. Building the rows then
  // slicing drops every row that fell behind the global top-200 cap, which
  // was hiding most of a small-volume broker's price levels after filter.
  const { buyRows: filteredBuyRows, sellRows: filteredSellRows } = useMemo(() => {
    if (!bubbleData) return { buyRows: [] as TradeRow[], sellRows: [] as TradeRow[] };
    return buildTradeRows(
      bubbleData.trades, selectedBrokerName, MAX_TRADE_ROWS, buySort, sellSort,
    );
  }, [bubbleData, selectedBrokerName, buySort, sellSort]);

  // C1 🔵: BrokerSearch onChange 回傳 name;此 wrapper 轉 id set state。
  const handleBrokerSearchChange = useCallback(
    (name: string | null) => {
      if (name === null) {
        setSelectedBrokerId(null);
        return;
      }
      const id =
        bubbleData?.trades.find((t) => t.broker === name)?.broker_id ?? null;
      setSelectedBrokerId(id);
    },
    [bubbleData],
  );

  return (
    <div className="h-full grid grid-cols-[1fr_400px] gap-0 overflow-hidden">
      {/* Left: header search bar + bubble chart */}
      <div className="h-full flex flex-col min-h-0 border-r border-line overflow-hidden">
        <div className="shrink-0 h-10 px-3 border-b border-line bg-bg-deep/30 flex items-center gap-3">
          <BrokerSearch
            trades={bubbleData?.trades ?? []}
            value={selectedBrokerName}
            onChange={handleBrokerSearchChange}
          />
          {selectedBrokerId && selectedBrokerName ? (
            onJumpToOverview ? (
              <button
                type="button"
                data-testid="bubble-jump-to-overview"
                onClick={() => onJumpToOverview(selectedBrokerId)}
                className="text-xs text-accent hover:text-ink underline underline-offset-2 cursor-pointer"
              >
                查看 <span className="text-[#f0b429] font-medium">{selectedBrokerName}</span> 於籌碼總覽 →
              </button>
            ) : (
              <span className="text-xs text-ink-dim">
                已篩選 <span className="text-[#f0b429] font-medium">1</span> 個分點
              </span>
            )
          ) : (
            <span className="text-xs text-ink-dim">
              今日共 <span className="text-[#b794f4] font-medium">{uniqueBrokerCount}</span> 個分點
            </span>
          )}
          {selectedBrokerId && (
            <div
              data-testid="bubble-broker-totals"
              className="flex items-center gap-3 text-xs text-ink-dim"
            >
              <span>
                買 <span className="text-accent tabular-nums">{fmtVol(brokerTotals.buyLots)}</span> 張
              </span>
              <span>
                賣 <span className="text-bear tabular-nums">{fmtVol(brokerTotals.sellLots)}</span> 張
              </span>
              <span>
                買額 <span className="text-accent tabular-nums">{fmtAmount(brokerTotals.buyAmount)}</span>
              </span>
              <span>
                賣額 <span className="text-bear tabular-nums">{fmtAmount(brokerTotals.sellAmount)}</span>
              </span>
            </div>
          )}
        </div>
        <div ref={bubbleRef} className="flex-1 min-h-0 overflow-hidden relative">
          {!bubbleData && !loading ? (
            <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
              請搜尋股票代號以載入泡泡圖
            </div>
          ) : bubbleData && bubbleSize.width > 0 && bubbleSize.height > 0 ? (
            <BubbleChartSvg
              trades={bubbleData.trades}
              width={bubbleSize.width}
              height={bubbleSize.height}
              closePrice={closePrice}
              selectedBroker={selectedBrokerName}
              onBubbleHover={handleBubbleHover}
              onBubbleClick={handleBubbleClick}
              intradayPoints={intradayPoints}
            />
          ) : null}
          {loading && symbol && (
            <div
              data-testid="bubble-loading-badge"
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
              載入 {symbol} 泡泡圖中…
            </div>
          )}
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
            selectedBroker={selectedBrokerName}
            onSelect={handleBubbleClick}
            sortSpec={buySort}
            onSortChange={handleBuySortChange}
          />
          <TradeList
            rows={filteredSellRows}
            side="sell"
            selectedBroker={selectedBrokerName}
            onSelect={handleBubbleClick}
            sortSpec={sellSort}
            onSortChange={handleSellSortChange}
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

// Per-row pixel height — must match the visual height (py-1 = 4+4 + text
// line-height ≈ 22px). Used by the virtualizer to compute scroll bounds.
// If the row styling changes (padding/font-size/line-height), update this.
const ROW_HEIGHT_PX = 22;

function SortHeader({
  label, sortKey, spec, side, onChange,
}: {
  label: string;
  sortKey: TradeSortKey;
  spec: SortSpec;
  side: "buy" | "sell";
  onChange: (key: TradeSortKey) => void;
}) {
  const active = spec.key === sortKey;
  const dir: SortDir | null = active ? spec.dir : null;
  const arrow = dir === "desc" ? "↓" : dir === "asc" ? "↑" : "";
  const ariaSort = dir === "desc"
    ? "descending"
    : dir === "asc"
      ? "ascending"
      : "none";
  const sideLabel = side === "buy" ? "買方" : "賣方";
  const dirLabel = dir === "desc" ? "由大到小" : dir === "asc" ? "由小到大" : "未排序";
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={ariaSort}
      aria-label={`${sideLabel}依${label}排序(目前${dirLabel})`}
      onClick={() => onChange(sortKey)}
      className={`text-right cursor-pointer transition-colors hover:text-ink ${
        active ? "text-ink" : "text-current/70"
      }`}
    >
      {label}
      {arrow && <span className="ml-0.5 text-2xs">{arrow}</span>}
    </button>
  );
}

const TradeList = memo(function TradeList({
  rows,
  side,
  selectedBroker,
  onSelect,
  sortSpec,
  onSortChange,
}: {
  rows: TradeRow[];
  side: "buy" | "sell";
  selectedBroker: string | null;
  onSelect: (broker: string | null) => void;
  sortSpec: SortSpec;
  onSortChange: (key: TradeSortKey) => void;
}) {
  const isBuy = side === "buy";
  const colorClass = isBuy ? "text-accent" : "text-bear";
  const bgClass = isBuy ? "bg-accent/[0.04]" : "bg-bear/[0.04]";
  const activeClass = isBuy ? "bg-accent/[0.08]" : "bg-bear/[0.08]";

  // Virtualize the row list: high-volume stocks (e.g. 3481) produce 50 000+
  // rows once the per-list cap was removed. Rendering them all as React
  // children locks the main thread for several seconds on filter clear.
  // The virtualizer keeps only the visible window (~30 rows) in the tree.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="flex flex-col overflow-hidden">
      <div
        className={`shrink-0 px-2 py-1.5 text-sm ${colorClass} ${bgClass} border-b border-line font-medium grid grid-cols-[1fr_56px_56px]`}
      >
        <span>分點</span>
        <SortHeader
          label="張數"
          sortKey="volume"
          spec={sortSpec}
          side={side}
          onChange={onSortChange}
        />
        <SortHeader
          label="價位"
          sortKey="price"
          spec={sortSpec}
          side={side}
          onChange={onSortChange}
        />
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0 scroll-editorial"
      >
        <div style={{ height: totalSize, position: "relative", width: "100%" }}>
          {virtualRows.map((vi) => {
            const r = rows[vi.index]!;
            return (
              <button
                key={vi.key}
                type="button"
                onClick={() => onSelect(r.broker)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  height: vi.size,
                }}
                className={`grid grid-cols-[1fr_56px_56px] items-center text-xs px-2 border-b border-line/20 cursor-pointer transition-colors ${
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
            );
          })}
        </div>
      </div>
    </div>
  );
});
