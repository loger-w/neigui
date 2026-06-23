import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SymbolSearch } from "./components/SymbolSearch";
import { ChipBrokersPanel } from "./components/ChipBrokersPanel";
import { ChipKlineChart } from "./components/ChipKlineChart";
import { DateField } from "./components/ui/date-field";
import { useChipData } from "./hooks/useChipData";
import { useChipBubble } from "./hooks/useChipBubble";
import { useBrokerHistory } from "./hooks/useBrokerHistory";
import { ModeSwitch, type Mode } from "./components/ModeSwitch";

const ChipBubbleView = lazy(() =>
  import("./components/ChipBubbleView").then((m) => ({ default: m.ChipBubbleView })),
);

const OptionsPage = lazy(() =>
  import("./components/OptionsPage").then((m) => ({ default: m.OptionsPage })),
);

type Tab = "overview" | "bubble";

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() =>
    (localStorage.getItem("mode") as Mode) || "equity"
  );
  useEffect(() => { localStorage.setItem("mode", mode); }, [mode]);

  const [symbol, setSymbol] = useState("");
  const [symbolName, setSymbolName] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr);
  const [tab, setTab] = useState<Tab>("overview");
  // Broker selection is keyed by broker_id (FinMind `securities_trader_id`):
  // the SecIdAgg endpoint requires that exact id as a query filter, so this
  // is the value that round-trips through the broker_history fetch. Display
  // names come from `summary.top_brokers` for the same id.
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const userPickedDate = useRef(false);

  const {
    summary, history, loading, summaryLoading, error,
    refresh: refreshChip,
  } = useChipData(symbol, date);
  const bubbleHook = useChipBubble(symbol, date);
  const brokerHistoryHook = useBrokerHistory(symbol, selectedBrokerIds);

  useEffect(() => {
    if (userPickedDate.current) return;
    if (!history?.candles?.length) return;
    const lastCandleDate = history.candles[history.candles.length - 1].date;
    if (lastCandleDate < date) {
      setDate(lastCandleDate);
    }
  }, [history, date]);

  const dayTotalLots = useMemo(() => {
    if (!summary?.date) return 0;
    const c = history?.candles.find((c) => c.date === summary.date);
    if (c) return c.volume;
    // Fallback when the date is outside the K-line's 90-day window.
    // Every traded lot is counted both as a buy (by one broker) AND a sell
    // (by another), so `sum(buy + sell)` ≈ 2 × volume. `sum(buy + sell) / 2`
    // recovers the actual lot count.
    const doubled = summary.top_brokers.reduce((s, b) => s + b.buy + b.sell, 0);
    return Math.floor(doubled / 2);
  }, [history, summary]);

  const handlePickDate = useCallback(
    (d: string) => {
      if (d === date) return;
      const lastCandle = history?.candles?.[history.candles.length - 1];
      userPickedDate.current = lastCandle ? d !== lastCandle.date : true;
      setDate(d);
    },
    [date, history],
  );

  const handleToggleBroker = useCallback((brokerId: string) => {
    setSelectedBrokerIds((prev) => {
      const next = new Set(prev);
      if (next.has(brokerId)) next.delete(brokerId);
      else next.add(brokerId);
      return next;
    });
  }, []);

  const handleClearAllBrokers = useCallback(() => {
    setSelectedBrokerIds(new Set());
  }, []);

  const refresh = () => {
    refreshChip();
    if (selectedBrokerIds.size > 0) brokerHistoryHook.refresh();
    if (tab === "bubble") bubbleHook.refresh();
  };
  const isLoading = loading || bubbleHook.loading;

  const handlePick = (sym: string, name: string | null) => {
    setSymbol(sym);
    setSymbolName(name);
    setSelectedBrokerIds(new Set());
    userPickedDate.current = false;
  };

  const closePrice = useMemo(() => {
    const c = history?.candles.find((c) => c.date === date);
    return c?.close ?? history?.candles?.[history.candles.length - 1]?.close;
  }, [history, date]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ModeSwitch value={mode} onChange={setMode} />
      {mode === "equity" ? (
      <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5 pb-3 border-b border-line">
        {/* F8: 籌碼分析 title + SymbolSearch + symbol/name + date + refresh
            collapsed onto a single horizontal row. */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl text-ink font-semibold mr-2">籌碼分析</h1>
          <div className="w-[220px]">
            <SymbolSearch onPick={handlePick} />
          </div>
          {symbol && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-ink font-medium">{symbol}</span>
              {symbolName && <span className="text-ink-muted">{symbolName}</span>}
            </div>
          )}
          <DateField
            value={date}
            aria-label="選擇日期"
            onChange={(e) => { userPickedDate.current = true; setDate(e.target.value); }}
          />
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading || !symbol}
            aria-label={isLoading ? "資料載入中" : "重新整理"}
            aria-busy={isLoading || undefined}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
          >
            {isLoading && (
              <svg
                data-testid="refresh-spinner"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-3.5 animate-spin text-accent motion-reduce:animate-none"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            重新整理
          </button>
        </div>
        <div className="flex mt-3 gap-0 border-b border-line -mb-[1px]">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`px-4 py-2 text-sm transition-colors cursor-pointer ${
              tab === "overview"
                ? "text-accent border-b-2 border-accent font-medium"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            籌碼總覽
          </button>
          <button
            type="button"
            onClick={() => setTab("bubble")}
            className={`px-4 py-2 text-sm transition-colors cursor-pointer ${
              tab === "bubble"
                ? "text-accent border-b-2 border-accent font-medium"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            泡泡圖
          </button>
        </div>
      </header>

      {(error || bubbleHook.error) && (
        <div className="shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error || bubbleHook.error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <div hidden={tab !== "overview"} className="h-full">
          <div className="h-full grid grid-cols-[1fr_420px] overflow-hidden">
            <div className="h-full overflow-hidden border-r border-line">
              <ChipKlineChart
                history={history}
                selectedDate={date}
                selectedBrokerIds={selectedBrokerIds}
                brokerSeries={brokerHistoryHook.series}
                onPickDate={handlePickDate}
                onClearAllBrokers={handleClearAllBrokers}
              />
            </div>
            <div className="h-full overflow-hidden">
              <ChipBrokersPanel
                summary={summary}
                dayTotalLots={dayTotalLots}
                selectedBrokerIds={selectedBrokerIds}
                onToggleBroker={handleToggleBroker}
                onClearAllBrokers={handleClearAllBrokers}
                loading={summaryLoading}
              />
            </div>
          </div>
        </div>
        <div hidden={tab !== "bubble"} className="h-full">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-ink-dim text-sm">
                載入泡泡圖元件...
              </div>
            }
          >
            <ChipBubbleView
              symbol={symbol}
              bubbleData={bubbleHook.data}
              closePrice={closePrice}
            />
          </Suspense>
        </div>
      </div>
      </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
              載入選擇權頁面...
            </div>
          }
        >
          <OptionsPage />
        </Suspense>
      )}
    </div>
  );
}
