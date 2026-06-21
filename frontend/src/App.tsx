import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SymbolSearch } from "./components/SymbolSearch";
import { ChipBrokersPanel } from "./components/ChipBrokersPanel";
import { ChipKlineChart } from "./components/ChipKlineChart";
import { useChipData } from "./hooks/useChipData";
import { useChipBubble } from "./hooks/useChipBubble";

const ChipBubbleView = lazy(() =>
  import("./components/ChipBubbleView").then((m) => ({ default: m.ChipBubbleView })),
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
  const [symbol, setSymbol] = useState("");
  const [symbolName, setSymbolName] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr);
  const [tab, setTab] = useState<Tab>("overview");
  const userPickedDate = useRef(false);

  const { summary, history, loading, error, refresh: refreshChip } = useChipData(symbol, date);
  const bubbleHook = useChipBubble(symbol, date);

  useEffect(() => {
    if (userPickedDate.current) return;
    if (!history?.candles?.length) return;
    const lastCandleDate = history.candles[history.candles.length - 1].date;
    if (lastCandleDate < date) {
      setDate(lastCandleDate);
    }
  }, [history, date]);

  const refresh = () => {
    refreshChip();
    if (tab === "bubble") bubbleHook.refresh();
  };
  const isLoading = loading || bubbleHook.loading;

  const handlePick = (sym: string, name: string | null) => {
    setSymbol(sym);
    setSymbolName(name);
    userPickedDate.current = false;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5 pb-3 border-b border-line">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl text-ink font-semibold">籌碼分析</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-[220px]">
            <SymbolSearch onPick={handlePick} />
          </div>
          {symbol && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-ink font-medium">{symbol}</span>
              {symbolName && <span className="text-ink-muted">{symbolName}</span>}
            </div>
          )}
          <input
            type="date"
            value={date}
            onChange={(e) => { userPickedDate.current = true; setDate(e.target.value); }}
            className="bg-bg-deep border border-line text-ink px-2.5 py-1.5 text-sm outline-none focus:border-accent tabular-nums"
          />
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading || !symbol}
            className="px-3 py-1.5 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-40 disabled:cursor-default transition-colors cursor-pointer"
          >
            {isLoading ? "載入中..." : "重新整理"}
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
              <ChipKlineChart history={history} />
            </div>
            <div className="h-full overflow-hidden">
              <ChipBrokersPanel summary={summary} />
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
              bubbleData={bubbleHook.data}
              closePrice={history?.candles?.find(c => c.date === date)?.close ?? history?.candles?.[history.candles.length - 1]?.close}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
