import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SymbolSearch } from "./components/SymbolSearch";
import { ChipBrokersPanel } from "./components/ChipBrokersPanel";
import { ChipKlineChart } from "./components/ChipKlineChart";
import { DateField } from "./components/ui/date-field";
import { TradingDayStepper } from "./components/ui/TradingDayStepper";
import {
  RangeSelector,
  WINDOW_DAYS_MIN,
  WINDOW_DAYS_MAX,
  type WindowDays,
} from "./components/ui/RangeSelector";
import { useChipData } from "./hooks/useChipData";
import { useChipBubble } from "./hooks/useChipBubble";
import { useChipIntraday } from "./hooks/useChipIntraday";
import { useBrokerHistory } from "./hooks/useBrokerHistory";
import { useChipBrokersWindow } from "./hooks/useChipBrokersWindow";
import { ModeSwitch, type Mode } from "./components/ModeSwitch";
import { VersionBadge } from "./components/VersionBadge";
import type { ChipSummary } from "./lib/chip-data";
import { prevTradingDay, nextTradingDay } from "./lib/trading-days";

const DEFAULT_WINDOW_DAYS: WindowDays = 1;

function readStoredWindowDays(): WindowDays {
  const raw = localStorage.getItem("chip_window_days");
  if (raw === null) return DEFAULT_WINDOW_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < WINDOW_DAYS_MIN || n > WINDOW_DAYS_MAX) {
    return DEFAULT_WINDOW_DAYS;
  }
  return n as WindowDays;
}

const PANEL_WIDTH_MIN = 300;
const PANEL_WIDTH_MAX = 800;
const PANEL_WIDTH_DEFAULT = 420;

function readStoredPanelWidth(): number {
  const raw = localStorage.getItem("chip_panel_width");
  if (raw === null) return PANEL_WIDTH_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < PANEL_WIDTH_MIN || n > PANEL_WIDTH_MAX) {
    return PANEL_WIDTH_DEFAULT;
  }
  return Math.round(n);
}

const ChipBubbleView = lazy(() =>
  import("./components/ChipBubbleView").then((m) => ({ default: m.ChipBubbleView })),
);

const OptionsPage = lazy(() =>
  import("./components/OptionsPage").then((m) => ({ default: m.OptionsPage })),
);

const MarketPage = lazy(() =>
  import("./components/MarketPage").then((m) => ({ default: m.MarketPage })),
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
  const [windowDays, setWindowDays] = useState<WindowDays>(readStoredWindowDays);
  useEffect(() => {
    localStorage.setItem("chip_window_days", String(windowDays));
  }, [windowDays]);
  const [panelWidth, setPanelWidth] = useState<number>(readStoredPanelWidth);
  useEffect(() => {
    localStorage.setItem("chip_panel_width", String(panelWidth));
  }, [panelWidth]);

  // Resize handle: dragging left widens the right panel (panel is right-anchored),
  // dragging right narrows it. document-level move/up listeners stay active for
  // the duration of the drag so the cursor can leave the 4-px handle without
  // dropping the grab.
  const handlePanelResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const next = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, startW - dx));
        setPanelWidth(Math.round(next));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelWidth],
  );
  // Broker selection is keyed by broker_id (FinMind `securities_trader_id`):
  // the SecIdAgg endpoint requires that exact id as a query filter, so this
  // is the value that round-trips through the broker_history fetch. Display
  // names come from the right-panel's top_brokers list for the same id.
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const userPickedDate = useRef(false);

  // Note: useChipData still fetches summary + history; we only consume
  // history here. summary is left untouched (its endpoint underwrites
  // per-day caching that brokers_window reuses).
  // `majorLoading` is the slow major-net per-day fan-out; not bundled into
  // global `loading` so the "重新整理" spinner doesn't sit for ~24s.
  const {
    history, loading, majorLoading, error,
    refresh: refreshChip,
  } = useChipData(symbol, date);
  const bubbleHook = useChipBubble(symbol, date);
  // Gate intraday by bubble tab — 跳過 overview tab 浪費 FinMind 配額(1 分 K
  // dataset 完整一日 ~266 rows,非 bubble view 時不需要)。tab 切回 bubble 時
  // useChipIntraday queryKey 變化會自動觸發 fetch。
  const intradayHook = useChipIntraday(tab === "bubble" ? symbol : "", date);
  const brokerHistoryHook = useBrokerHistory(symbol, selectedBrokerIds);
  const brokersWindow = useChipBrokersWindow(symbol, date, windowDays);

  useEffect(() => {
    if (userPickedDate.current) return;
    if (!history?.candles?.length) return;
    const lastCandleDate = history.candles[history.candles.length - 1]!.date;
    if (lastCandleDate < date) {
      setDate(lastCandleDate);
    }
  }, [history, date]);

  // 右側 panel 改吃 brokersWindow N 日加總,total_traded_lots 由 server 算好;
  // 用作 topByVolume 的 daytradeRate 分母(broker total ≥ 1% of dayTotal 門檻)。
  const windowTotalLots = brokersWindow.data?.total_traded_lots ?? 0;

  // Adapter:把 brokersWindow.data(ChipBrokersWindow 形狀)交給 ChipBrokersPanel
  // 當 `summary` 用。ChipBrokersWindow 結構是 ChipSummary 的 superset(共有
  // top_brokers / margin / institutional / symbol / date / fetched_at),所以
  // 結構上可賦值;前端面板讀不到 window_days / actual_days 等 N 日專屬欄位,
  // 那些另外透過 windowDays / actualDays props 顯式傳入。
  const panelSummary: ChipSummary | null = brokersWindow.data
    ? {
        symbol: brokersWindow.data.symbol,
        date: brokersWindow.data.date,
        fetched_at: brokersWindow.data.fetched_at,
        institutional: brokersWindow.data.institutional,
        margin: brokersWindow.data.margin,
        top_brokers: brokersWindow.data.top_brokers,
      }
    : null;

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
    brokersWindow.refresh();
    if (selectedBrokerIds.size > 0) brokerHistoryHook.refresh();
    if (tab === "bubble") {
      bubbleHook.refresh();
      intradayHook.refresh();
    }
  };
  const isLoading = loading || bubbleHook.loading || brokersWindow.loading;

  const handlePick = (sym: string, name: string | null) => {
    setSymbol(sym);
    setSymbolName(name);
    setSelectedBrokerIds(new Set());
    userPickedDate.current = false;
  };

  // v3 C3 — 跨 mode pivot:reuse handlePick 確保 sibling state 全 reset
  const handleSymbolPick = useCallback((sid: string) => {
    setMode("equity");
    handlePick(sid, null);
     
  }, []);

  const closePrice = useMemo(() => {
    const c = history?.candles.find((c) => c.date === date);
    return c?.close ?? history?.candles?.[history.candles.length - 1]?.close;
  }, [history, date]);

  // chip-date-controls (2026-06-29): trading-day stepper wiring.
  // tradingDays is derived from K-line candles (already fetched, ~360 days);
  // effectiveMax caps "next" at min(today, last candle) so the user cannot
  // page into the future and trigger a 422 / no-data response.
  const tradingDays = useMemo(
    () => history?.candles.map((c) => c.date) ?? [],
    [history],
  );
  const effectiveMax = useMemo(() => {
    if (tradingDays.length === 0) return todayStr();
    const lastCandle = tradingDays[tradingDays.length - 1]!;
    const t = todayStr();
    return lastCandle < t ? lastCandle : t;
  }, [tradingDays]);
  const prevDisabled =
    !symbol ||
    tradingDays.length === 0 ||
    date <= tradingDays[0]!;
  const nextDisabled =
    !symbol ||
    tradingDays.length === 0 ||
    date >= effectiveMax;
  const handlePrevDay = useCallback(() => {
    const target = prevTradingDay(date, tradingDays);
    if (target === null) return;
    userPickedDate.current = true;
    setDate(target);
  }, [date, tradingDays]);
  const handleNextDay = useCallback(() => {
    const target = nextTradingDay(date, tradingDays, effectiveMax);
    if (target === null) return;
    userPickedDate.current = true;
    setDate(target);
  }, [date, tradingDays, effectiveMax]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center border-b border-line bg-bg">
        <ModeSwitch value={mode} onChange={setMode} />
        <div className="ml-auto pr-4">
          <VersionBadge />
        </div>
      </div>
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
          <div className="inline-flex items-stretch gap-px">
            <TradingDayStepper
              direction="prev"
              disabled={prevDisabled}
              onClick={handlePrevDay}
            />
            <DateField
              value={date}
              aria-label="選擇日期"
              snapToDates={tradingDays}
              onValueChange={(v) => { userPickedDate.current = true; setDate(v); }}
            />
            <TradingDayStepper
              direction="next"
              disabled={nextDisabled}
              onClick={handleNextDay}
            />
          </div>
          <RangeSelector
            value={windowDays}
            onChange={setWindowDays}
            disabled={isLoading}
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
          <div
            className="h-full grid overflow-hidden"
            style={{ gridTemplateColumns: `1fr 4px ${panelWidth}px` }}
          >
            <div className="h-full overflow-hidden">
              <ChipKlineChart
                history={history}
                selectedDate={date}
                selectedBrokerIds={selectedBrokerIds}
                brokerSeries={brokerHistoryHook.series}
                onPickDate={handlePickDate}
                onClearAllBrokers={handleClearAllBrokers}
                loading={!!symbol && isLoading}
                loadingSymbol={symbol || undefined}
                majorLoading={!!symbol && majorLoading}
                windowDays={windowDays}
              />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="調整籌碼欄寬度"
              data-testid="panel-resize-handle"
              onMouseDown={handlePanelResizeMouseDown}
              className="h-full cursor-col-resize bg-line hover:bg-accent transition-colors"
              title="拖曳調整籌碼欄寬度"
            />
            <div className="h-full overflow-hidden">
              <ChipBrokersPanel
                summary={panelSummary}
                dayTotalLots={windowTotalLots}
                selectedBrokerIds={selectedBrokerIds}
                onToggleBroker={handleToggleBroker}
                onClearAllBrokers={handleClearAllBrokers}
                loading={brokersWindow.loading}
                windowDays={windowDays}
                actualDays={brokersWindow.data?.actual_days}
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
              intradayPoints={intradayHook.data?.points ?? null}
            />
          </Suspense>
        </div>
      </div>
      </div>
      ) : mode === "options" ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
              載入選擇權頁面...
            </div>
          }
        >
          <OptionsPage />
        </Suspense>
      ) : (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
              載入大盤掃描...
            </div>
          }
        >
          <MarketPage isActive={mode === "market"} onSymbolPick={handleSymbolPick} />
        </Suspense>
      )}
    </div>
  );
}
