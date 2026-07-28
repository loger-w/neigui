import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  ChipBubbleData, IntradayPoint, SortDir, SortSpec, TradeRow, TradeSortKey,
} from "../lib/chip-data";
import {
  DEFAULT_TRADE_SORT, aggregateByPrice, buildTradeRows, computeBrokerTotals,
  fmtAmount, fmtVol, summarizeTradesByPriceRange,
} from "../lib/chip-data";
import {
  BROKER_PALETTE,
  BubbleChartSvg,
  type BubbleHoverPayload,
  type BubbleSelectedBroker,
} from "../lib/chip-bubble-svg";
import { formatBrokerName } from "../lib/broker-name";
import { PriceBarSvg } from "../lib/chip-price-bar-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { BrokerSearch } from "./BrokerSearch";
import { BubbleHelpButton } from "./BubbleHelpButton";
import { BubbleBlocklistPopover } from "./BubbleBlocklistPopover";
import { LoadingSpinner } from "./ui/loading-spinner";
import {
  addBlocked,
  loadBlocklist,
  removeBlocked,
  saveBlocklist,
  type BlockedBroker,
} from "../lib/bubble-blocklist";

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
  /** CH-1(mod/batch-ui-update): 籌碼總攬「看泡泡圖」鈕的聚焦請求。seq 遞增
   *  觸發(同分點重複點擊也要重新聚焦)。R6:聚焦分點在排除清單 → 自動移除
   *  (顯式意圖優先於舊設定,持久生效)+ R10 提示;當日無成交 → 維持選中 +
   *  空狀態。name 由 caller 帶入 — 無成交時 trades 內查不到名稱。 */
  focusRequest?: { brokerId: string; name: string; seq: number } | null;
}

// F12: surface every broker who traded today, including 1-張 ones. The
// bubble chart still applies its own threshold/top-100 layout slice; the
// right-side trade list intentionally does NOT — the user explicitly wants
// the long tail visible there.
const MAX_TRADE_ROWS = Number.POSITIVE_INFINITY;

// bubble-multi-broker(SC-1):多選上限 = BROKER_PALETTE 色數(可辨識度上限;
// Phase 4 review:單一 source of truth,palette 增減自動同步 gate 與文案)。
const MAX_SELECTED_BROKERS = BROKER_PALETTE.length;
type SelectedBroker = BubbleSelectedBroker;

export function ChipBubbleView({
  bubbleData,
  closePrice,
  symbol,
  intradayPoints,
  onJumpToOverview,
  loading,
  focusRequest,
}: Props) {
  // bubble-multi-broker(SC-1):有序多選(≤6),id = broker_id 對齊 App.tsx
  // selectedBrokerIds 契約;name 存 state(分點自 trades 消失時 chip 不失效);
  // colorIdx = 加選當下最小未占用 slot,存續期間不變(移除不重配其他分點)。
  const [selected, setSelected] = useState<SelectedBroker[]>([]);
  // 選滿 6 再加選的提示;任何改動選取的路徑一律清除(design v2 R4)。
  const [limitNotice, setLimitNotice] = useState<boolean>(false);
  const [buySort, setBuySort] = useState<SortSpec>(DEFAULT_TRADE_SORT);
  const [sellSort, setSellSort] = useState<SortSpec>(DEFAULT_TRADE_SORT);
  // C7 A1: Y 軸 brush 選價位 range。null = 無 brush;svg drag end 後 setBrushRange。
  const [brushRange, setBrushRange] = useState<{ min: number; max: number } | null>(null);
  // C10 (🟢 Item 4): 手動輸入區間開啟狀態。true = 顯示輸入面板(可能有初值 = brushRange)。
  const [manualInputOpen, setManualInputOpen] = useState<boolean>(false);
  // Responsive spec §4.4:<lg 右欄 400px 明細改 bottom sheet;brush 桌面限定。
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  // BB-1: 分點過濾清單 — 全域(跨個股)localStorage 持久化,symbol 變更不清。
  const [blocked, setBlocked] = useState<BlockedBroker[]>(loadBlocklist);
  useEffect(() => {
    saveBlocklist(blocked);
  }, [blocked]);
  const blockedIds = useMemo(() => new Set(blocked.map((b) => b.id)), [blocked]);
  // 被排除分點不進泡泡、分點列表與統計 — 在最上游一次過濾,下游
  // (rangeTrades / brushSummary / BrokerSearch / chart)全部吃這份。
  const visibleTrades = useMemo(
    () => (bubbleData ? bubbleData.trades.filter((t) => !blockedIds.has(t.broker_id)) : []),
    [bubbleData, blockedIds],
  );

  // CH-1: focusRequest 聚焦狀態 — focusedBroker 記住「聚焦目標」讓當日無
  // 成交的分點也有名稱可顯示;blockRemovalNotice = R10 提示(下一次聚焦或
  // 換股時清)。
  const [focusedBroker, setFocusedBroker] = useState<{ id: string; name: string } | null>(null);
  const [blockRemovalNotice, setBlockRemovalNotice] = useState<string | null>(null);
  const lastFocusSeq = useRef(0);

  // Reset selection ONLY on symbol change (NOT on date / bubbleData change).
  // C7 A1: brush 也一起清 —— 避免換股後舊 range 殘留誤導。
  useEffect(() => {
    setSelected([]);
    setLimitNotice(false);
    setBrushRange(null);
    setManualInputOpen(false);
    setSheetOpen(false);
    setFocusedBroker(null);
    setBlockRemovalNotice(null);
  }, [symbol]);

  // SC-1 toggle 核心(三入口共用):已選 → 移除;未選 → 加選(滿員拒絕 + 提示)。
  const toggleBroker = useCallback((id: string, name: string) => {
    setSelected((prev) => {
      if (prev.some((b) => b.id === id)) {
        setLimitNotice(false);
        return prev.filter((b) => b.id !== id);
      }
      if (prev.length >= MAX_SELECTED_BROKERS) {
        setLimitNotice(true);
        return prev;
      }
      setLimitNotice(false);
      const used = new Set(prev.map((b) => b.colorIdx));
      let colorIdx = 0;
      while (used.has(colorIdx)) colorIdx++;
      return [...prev, { id, name, colorIdx }];
    });
  }, []);

  // CH-1: focusRequest 聚焦。宣告順序必須在 symbol reset effect 之後 —
  // mount 時 effects 依序跑,「帶著 focusRequest 首次 mount」(lazy tab 首開
  // 就是點鈕觸發)得讓聚焦蓋過 reset,不能反過來被清掉。
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusRequest.seq;
    if (blocked.some((b) => b.id === focusRequest.brokerId)) {
      // R6: 顯式聚焦意圖優先於舊排除設定 — 自清單移除(持久生效)。
      setBlocked((prev) => removeBlocked(prev, focusRequest.brokerId));
      setBlockRemovalNotice(
        `已自過濾清單移除〈${formatBrokerName(focusRequest.brokerId, focusRequest.name)}〉`,
      );
    } else {
      setBlockRemovalNotice(null);
    }
    // SC-6:聚焦語意 =「看這個」— 取代整組選取,不 append。
    setSelected([{ id: focusRequest.brokerId, name: focusRequest.name, colorIdx: 0 }]);
    setLimitNotice(false);
    setFocusedBroker({ id: focusRequest.brokerId, name: focusRequest.name });
  }, [focusRequest, blocked]);

  // Mobile:tap 泡泡選中分點 → 自動開明細 sheet(桌面右欄恆顯,不需要)。
  // R7:effect 只開不關 — 選取歸 0 時 sheet 維持開啟(顯全體明細)。
  useEffect(() => {
    if (isMobile && selected.length > 0) setSheetOpen(true);
  }, [isMobile, selected.length]);

  // Derived(design v2 §1):selectedNames 直接自 state 導出(不走 visibleTrades
  // join)— 分點自 trades 消失(blocklist / refetch)時 chip / active 態不失效。
  const selectedIds = useMemo(
    () => new Set(selected.map((b) => b.id)),
    [selected],
  );
  // N ≥ 2 才配列圓點色(N = 1 圖面無外框,SC-5 單選視覺零回歸)。
  // Phase 4 F2:key 一律 broker_id — 同名不同 id 兩分點的顏色不得互蓋。
  const colorById = useMemo(() => {
    if (selected.length < 2) return new Map<string, string>();
    return new Map(selected.map((b) => [b.id, BROKER_PALETTE[b.colorIdx]!]));
  }, [selected]);
  const colorFor = useCallback(
    (brokerId: string): string | null => colorById.get(brokerId) ?? null,
    [colorById],
  );

  // name→顯示名 lookup(TradeRow 無 broker_id,R14 決策走 lookup 不擴型別);
  // 非搜尋顯示點只顯去dash名稱,選取契約仍以 name 為 key
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of visibleTrades) {
      if (!m.has(t.broker)) m.set(t.broker, formatBrokerName(t.broker_id, t.broker));
    }
    return (name: string): string => m.get(name) ?? name;
  }, [visibleTrades]);

  // BB-1: 排除清單操作。加入時若在選中集合,自組移除(其餘選中保留,SC-6)。
  const handleBlockAdd = useCallback((b: BlockedBroker) => {
    setBlocked((prev) => addBlocked(prev, b));
    setSelected((prev) => prev.filter((s) => s.id !== b.id));
    setLimitNotice(false);
  }, []);
  const handleBlockRemove = useCallback((id: string) => {
    setBlocked((prev) => removeBlocked(prev, id));
  }, []);
  const handleBlockClearAll = useCallback(() => {
    setBlocked([]);
  }, []);

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

  // C10 (🔴 Item 3 擴充):brushRange 設定後,右側 trade list / price bar /
  // broker totals / 分點計數統一 filter。
  // C11 (🔴,多選泛化):有任何分點選擇時 range 退為視覺參考 — 即使有
  //   brushRange 也不預過濾(範圍框仍畫,但資料回全 broker)。目的是解「先框
  //   價區、後點分點想看全價位」的 UX,不需要清 range。未選取時走原 range
  //   過濾邏輯。brushSummary 仍用原始 trades 算 summary。
  const rangeActiveForFilter = brushRange !== null && selected.length === 0;
  const rangeTrades = useMemo(() => {
    if (!rangeActiveForFilter || !brushRange) return visibleTrades;
    return visibleTrades.filter(
      (t) => t.price >= brushRange.min && t.price <= brushRange.max,
    );
  }, [visibleTrades, brushRange, rangeActiveForFilter]);

  const uniqueBrokerCount = useMemo(
    () => new Set(rangeTrades.map((t) => t.broker)).size,
    [rangeTrades],
  );

  // C6 A3(SC-4 合併):選中分點集合的總買/賣張 + 精確成交金額加總。
  // brushRange 有效時只算區間內。
  const brokerTotals = useMemo(
    () => computeBrokerTotals(rangeTrades, selectedIds),
    [rangeTrades, selectedIds],
  );

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const bubbleSize = useContainerSize(bubbleRef);
  // priceBar 的 ref + useContainerSize 移進 DetailPanel 內部 — mobile sheet
  // 延遲 mount 時 ref 若掛 parent 會踩 useContainerSize「null ref 永不重跑」
  // 陷阱(CLAUDE.md §9 market-page-v2 條目),量到 0×0 空白。

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
      if (nameEl)
        nameEl.textContent = formatBrokerName(payload.brokerId, payload.broker);
      if (detailEl)
        detailEl.textContent = `${payload.side === "buy" ? "買" : "賣"}: ${payload.volume} 張`;
      if (priceEl) priceEl.textContent = `價格: ${payload.price}`;
    },
    [],
  );

  // Phase 4 F1:svg / TradeList 沿路帶 broker_id,直接按 id toggle(SC-1)—
  // 同名不同 id 不再 name 反查猜第一筆。無 id 的舊路徑保留 name lookup fallback。
  // C7 A1: 點空白處(broker=null)同時清 brush,對齊 SC-A1c。
  const handleBubbleClick = useCallback(
    (broker: string | null, brokerId?: string | null) => {
      if (broker === null) {
        setSelected([]);
        setLimitNotice(false);
        setBrushRange(null);
        setManualInputOpen(false);
        return;
      }
      if (brokerId) {
        toggleBroker(brokerId, broker);
        return;
      }
      const t = visibleTrades.find((x) => x.broker === broker);
      if (!t) return;
      toggleBroker(t.broker_id, t.broker);
    },
    [visibleTrades, toggleBroker],
  );

  // C7 A1: brush drag end callback。存 range → 顯示 summary panel。
  // C10 (🟢 Item 4): drag brush 完成時關閉手動輸入(避免兩個面板 confusion)。
  const handleYBrush = useCallback((priceMin: number, priceMax: number) => {
    setBrushRange({ min: priceMin, max: priceMax });
    setManualInputOpen(false);
  }, []);

  // C7 A1: ESC 鍵清 brush + 手動輸入面板(對齊 SC-A1c)。
  useEffect(() => {
    if (!brushRange && !manualInputOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBrushRange(null);
        setManualInputOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [brushRange, manualInputOpen]);

  const handleManualApply = useCallback((minStr: string, maxStr: string) => {
    const min = parseFloat(minStr);
    const max = parseFloat(maxStr);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return;
    setBrushRange({ min, max });
    setManualInputOpen(false);
  }, []);

  const brushSummary = useMemo(() => {
    if (!brushRange || !bubbleData) return null;
    return summarizeTradesByPriceRange(visibleTrades, brushRange.min, brushRange.max);
  }, [brushRange, bubbleData, visibleTrades]);

  const allPriceAggs = useMemo(() => aggregateByPrice(rangeTrades), [rangeTrades]);

  const priceAggs = useMemo(() => {
    if (selected.length === 0) return allPriceAggs;
    const filtered = rangeTrades.filter((t) => selectedIds.has(t.broker_id));
    if (filtered.length === 0) return allPriceAggs;
    const filteredAggs = aggregateByPrice(filtered);
    const filteredPrices = new Set(filteredAggs.map((a) => a.price));
    return allPriceAggs.map((a) =>
      filteredPrices.has(a.price)
        ? filteredAggs.find((f) => f.price === a.price)!
        : { price: a.price, buy: 0, sell: 0 },
    );
  }, [rangeTrades, selected.length, selectedIds, allPriceAggs]);

  // Bug fix: filter must precede the top-N slice. Building the rows then
  // slicing drops every row that fell behind the global top-200 cap, which
  // was hiding most of a small-volume broker's price levels after filter.
  const { buyRows: filteredBuyRows, sellRows: filteredSellRows } = useMemo(
    () => buildTradeRows(rangeTrades, selectedIds, MAX_TRADE_ROWS, buySort, sellSort),
    [rangeTrades, selectedIds, buySort, sellSort],
  );

  const detailPanel = (
    <DetailPanel
      priceAggs={priceAggs}
      buyRows={filteredBuyRows}
      sellRows={filteredSellRows}
      selectedIds={selectedIds}
      colorFor={colorFor}
      labelFor={labelFor}
      onSelect={handleBubbleClick}
      buySort={buySort}
      sellSort={sellSort}
      onBuySortChange={handleBuySortChange}
      onSellSortChange={handleSellSortChange}
    />
  );

  return (
    <div
      className={
        isMobile
          ? "h-full flex flex-col overflow-hidden"
          : "h-full grid grid-cols-[1fr_400px] gap-0 overflow-hidden"
      }
    >
      {/* Left: header search bar + bubble chart */}
      <div className="h-full flex flex-col min-h-0 border-r border-line overflow-hidden">
        {/* SC-1(mod/bubble-chart-ux-polish):搜尋固定左欄 + 中欄雙行(chips /
            統計常駐)+ 右工具欄。舊版單一 flex-wrap 會讓 6 chip 壓窄搜尋框、
            統計掉行被下拉蓋住。mobile(<lg)退化為垂直堆疊。 */}
        <div
          data-testid="bubble-header"
          className="shrink-0 px-3 py-1.5 border-b border-line bg-bg-deep/30 flex flex-col gap-y-1 lg:grid lg:grid-cols-[360px_minmax(0,1fr)_auto] lg:gap-x-3 lg:items-start"
        >
          <BrokerSearch
            trades={visibleTrades}
            selectedIds={selectedIds}
            onPick={toggleBroker}
          />
          <div className="min-w-0 flex flex-col gap-y-0.5">
            {/* SC-3 Legend chips 行:選取狀態唯一載體 — 專屬色圓點 + 顯示名 + ×。
                空態引導文字佔位,header 高度不因首次加選跳動(SC-2)。 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-6">
              {selected.map((b) => {
                const display = formatBrokerName(b.id, b.name);
                const color = BROKER_PALETTE[b.colorIdx]!;
                return (
                  <span
                    key={b.id}
                    data-testid="broker-chip"
                    className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-xs border border-line-strong bg-bg-deep/60 text-ink"
                  >
                    <span
                      data-testid="broker-chip-dot"
                      data-color={color}
                      aria-hidden="true"
                      className="size-2 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    {display}
                    <button
                      type="button"
                      aria-label={`移除〈${display}〉`}
                      onClick={() => toggleBroker(b.id, b.name)}
                      className="text-ink-dim hover:text-bear cursor-pointer leading-none pointer-coarse:min-h-11"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {selected.length >= 2 && (
                <button
                  type="button"
                  data-testid="broker-chips-clear"
                  onClick={() => {
                    setSelected([]);
                    setLimitNotice(false);
                  }}
                  className="text-xs text-ink-dim hover:text-bear underline underline-offset-2 cursor-pointer"
                >
                  清除全部
                </button>
              )}
              {limitNotice && (
                <span role="status" className="text-xs text-[#f0b429]">
                  {`最多同時選 ${MAX_SELECTED_BROKERS} 個分點`}
                </span>
              )}
              {blockRemovalNotice && (
                <span
                  data-testid="blocklist-removal-notice"
                  role="status"
                  className="text-xs text-[#f0b429]"
                >
                  {blockRemovalNotice}
                </span>
              )}
              {selected.length === 0 && !blockRemovalNotice && (
                <span className="text-xs text-ink-dim">
                  點泡泡或搜尋分點加入比較
                </span>
              )}
            </div>
            {/* SC-2 統計行:常駐、位置固定 — 搜尋下拉在左欄下方展開,永不蓋到這裡。 */}
            <div
              data-testid="bubble-stats-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 min-h-5"
            >
              {selected.length > 0 ? (
                onJumpToOverview ? (
                  <button
                    type="button"
                    data-testid="bubble-jump-to-overview"
                    onClick={() =>
                      onJumpToOverview(
                        selected.length === 1
                          ? selected[0]!.id
                          : selected.map((b) => b.id),
                      )
                    }
                    className="text-xs text-accent hover:text-ink underline underline-offset-2 cursor-pointer"
                  >
                    {selected.length === 1 ? (
                      <>
                        查看 <span className="text-[#f0b429] font-medium">{formatBrokerName(selected[0]!.id, selected[0]!.name)}</span> 於籌碼總覽 →
                      </>
                    ) : (
                      <>查看 {selected.length} 個分點於籌碼總覽 →</>
                    )}
                  </button>
                ) : (
                  <span className="text-xs text-ink-dim">
                    已篩選 <span className="text-[#f0b429] font-medium">{selected.length}</span> 個分點
                  </span>
                )
              ) : (
                <span className="text-xs text-ink-dim">
                  {brushRange ? "此區間" : "今日共"} <span className="text-[#b794f4] font-medium">{uniqueBrokerCount}</span> 個分點
                </span>
              )}
              {selected.length > 0 && (
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
          </div>
          {/* C10 (🟢 Item 4 + 5):手動輸入區間 trigger + Help '?' icon 靠右
              (ml-auto:grid cell 與 mobile flex-col 兩形態都推右,review R4)。 */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <BubbleBlocklistPopover
              trades={bubbleData?.trades ?? []}
              blocked={blocked}
              onAdd={handleBlockAdd}
              onRemove={handleBlockRemove}
              onClearAll={handleBlockClearAll}
            />
            {bubbleData && (
              <button
                type="button"
                data-testid="bubble-manual-range-trigger"
                onClick={() => setManualInputOpen(true)}
                className="text-xs text-ink-dim hover:text-accent underline underline-offset-2 cursor-pointer"
              >
                輸入區間
              </button>
            )}
            {isMobile && bubbleData && (
              <button
                type="button"
                data-testid="bubble-open-sheet"
                onClick={() => setSheetOpen(true)}
                className="text-xs text-ink-dim hover:text-accent underline underline-offset-2 cursor-pointer pointer-coarse:min-h-11"
              >
                明細
              </button>
            )}
            <BubbleHelpButton />
          </div>
        </div>
        <div ref={bubbleRef} className="flex-1 min-h-0 overflow-hidden relative">
          {!bubbleData && !loading ? (
            <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
              請搜尋股票代號以載入泡泡圖
            </div>
          ) : bubbleData && bubbleSize.width > 0 && bubbleSize.height > 0 ? (
            <BubbleChartSvg
              trades={visibleTrades}
              width={bubbleSize.width}
              height={bubbleSize.height}
              closePrice={closePrice}
              selectedBrokers={selected}
              onBubbleHover={handleBubbleHover}
              onBubbleClick={handleBubbleClick}
              intradayPoints={intradayPoints}
              onYBrush={isMobile ? undefined : handleYBrush}
              brushRange={brushRange}
              priceRange={rangeActiveForFilter ? brushRange : null}
            />
          ) : null}
          {/* CH-1 R6 case 2: 聚焦分點當日無成交 — 維持選中,泡泡圖照常
              (該分點本來就不在圖上),中央 badge 說明而非誤導成資料壞掉。
              impl-spec R5:length === 1 嚴格判 — 多選含聚焦分點時不現。 */}
          {focusedBroker !== null &&
            selected.length === 1 &&
            selected[0]!.id === focusedBroker.id &&
            bubbleData !== null &&
            !bubbleData.trades.some((t) => t.broker_id === focusedBroker.id) && (
              <div
                data-testid="bubble-focus-no-trades"
                className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
              >
                <div className="bg-bg-deep/90 border border-line-strong px-4 py-2 rounded shadow text-sm text-ink-muted">
                  〈{focusedBroker.name}〉該分點當日無成交
                </div>
              </div>
            )}
          {loading && symbol && (
            <div
              data-testid="bubble-loading-badge"
              className="absolute top-2 left-1/2 -translate-x-1/2 z-30 text-xs text-ink bg-bg-deep/90 px-3 py-1 border border-accent rounded shadow pointer-events-none flex items-center gap-2"
              aria-live="polite"
            >
              <LoadingSpinner size="3.5" />
              載入 {symbol} 泡泡圖中…
            </div>
          )}
          {brushRange && brushSummary && !manualInputOpen && (
            <div
              data-testid="brush-summary"
              className="absolute right-4 top-4 z-40 bg-bg-deep/95 border border-accent px-3 py-2 rounded shadow-lg text-xs"
            >
              <div className="text-ink font-medium mb-1 tabular-nums">
                {brushRange.min.toFixed(2)} – {brushRange.max.toFixed(2)}
                <span className="text-ink-dim ml-2">
                  ({brushSummary.priceLevelCount} 檔價位)
                </span>
              </div>
              <div className="text-ink-muted">
                涵蓋 {brushSummary.brokerIds.length} 個分點
              </div>
              <div className="text-ink-muted tabular-nums">
                買 {fmtVol(brushSummary.buyLots)} / 賣 {fmtVol(brushSummary.sellLots)} 張
              </div>
              {selected.length > 0 && (
                <div
                  data-testid="brush-range-parked"
                  className="mt-1 text-2xs text-ink-dim italic"
                >
                  分點選擇中,區間僅作參考(右側資料顯示全部價位)
                </div>
              )}
              <div className="flex gap-3 mt-2">
                {onJumpToOverview && brushSummary.brokerIds.length > 0 && (
                  <button
                    type="button"
                    data-testid="brush-apply-filter"
                    onClick={() => onJumpToOverview(brushSummary.brokerIds)}
                    className="text-accent hover:text-ink underline underline-offset-2 cursor-pointer"
                  >
                    篩選這 {brushSummary.brokerIds.length} 個分點 →
                  </button>
                )}
                <button
                  type="button"
                  data-testid="brush-edit"
                  onClick={() => setManualInputOpen(true)}
                  className="text-ink-muted hover:text-accent cursor-pointer"
                >
                  編輯
                </button>
                <button
                  type="button"
                  data-testid="brush-clear"
                  onClick={() => setBrushRange(null)}
                  className="text-ink-dim hover:text-bear cursor-pointer"
                >
                  清除
                </button>
              </div>
            </div>
          )}
          {manualInputOpen && (
            <PriceRangeInputPanel
              initialMin={brushRange?.min ?? null}
              initialMax={brushRange?.max ?? null}
              closePrice={closePrice}
              onApply={handleManualApply}
              onCancel={() => setManualInputOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Right(desktop): Price bars + side-by-side buy/sell trade lists。
          Mobile(responsive spec §4.4):改 bottom sheet,tap 泡泡自動開。
          注意:DetailPanel 必須「直接」當 grid item(root 自帶 h-full flex
          overflow-hidden)— 多包一層 div.h-full 會破壞高度約束,虛擬化列表
          的 totalSize(數萬 px)撐爆 grid row,左側泡泡 SVG 跟著爆高變空白。 */}
      {!isMobile && detailPanel}
      {isMobile && sheetOpen && (
        <>
          <div
            data-testid="bubble-sheet-backdrop"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="分點成交明細"
            data-testid="bubble-detail-sheet"
            className="fixed inset-x-0 bottom-0 z-50 h-[70vh] flex flex-col bg-bg-deep border-t border-line-strong rounded-t-lg animate-[sheet-up_0.25s_ease-out] motion-reduce:animate-none"
          >
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-line">
              <span className="text-sm text-ink-muted">
                成交明細
                {selected.length === 1
                  ? ` — ${selected[0]!.name}`
                  : selected.length >= 2
                    ? ` — ${selected.length} 個分點`
                    : ""}
              </span>
              <button
                type="button"
                aria-label="關閉明細"
                onClick={() => setSheetOpen(false)}
                className="text-ink-dim hover:text-ink cursor-pointer px-3 py-1 pointer-coarse:min-h-11 text-base leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 min-h-0">{detailPanel}</div>
          </div>
        </>
      )}

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
          fontSize: "0.8125rem",
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

// 右欄明細(price bar + 買賣雙列表)。桌面恆 mount 於右欄;mobile 包進
// bottom sheet 延遲 mount — priceBar 的 ref + useContainerSize 必須在這裡
// 內部宣告(mount 時 ref 已掛),不能收 parent 的 ref(§9 null-ref 陷阱)。
function DetailPanel({
  priceAggs,
  buyRows,
  sellRows,
  selectedIds,
  colorFor,
  labelFor,
  onSelect,
  buySort,
  sellSort,
  onBuySortChange,
  onSellSortChange,
}: {
  priceAggs: ReturnType<typeof aggregateByPrice>;
  buyRows: TradeRow[];
  sellRows: TradeRow[];
  /** SC-4:選中分點 id 集合(多選)— row active 態(Phase 4 F1/F2 id-key)。 */
  selectedIds: ReadonlySet<string>;
  /** SC-4:N ≥ 2 時回該分點專屬色(列首圓點,id-key),否則 null。 */
  colorFor: (brokerId: string) => string | null;
  /** SC-7:broker name → 「id 去dash名」顯示 label。 */
  labelFor: (name: string) => string;
  onSelect: (broker: string | null, brokerId?: string | null) => void;
  buySort: SortSpec;
  sellSort: SortSpec;
  onBuySortChange: (key: TradeSortKey) => void;
  onSellSortChange: (key: TradeSortKey) => void;
}) {
  const priceBarRef = useRef<HTMLDivElement | null>(null);
  const priceBarSize = useContainerSize(priceBarRef);
  return (
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
          rows={buyRows}
          side="buy"
          selectedIds={selectedIds}
          colorFor={colorFor}
          labelFor={labelFor}
          onSelect={onSelect}
          sortSpec={buySort}
          onSortChange={onBuySortChange}
        />
        <TradeList
          rows={sellRows}
          side="sell"
          selectedIds={selectedIds}
          colorFor={colorFor}
          labelFor={labelFor}
          onSelect={onSelect}
          sortSpec={sellSort}
          onSortChange={onSellSortChange}
        />
      </div>
    </div>
  );
}

// C10 (🟢 Item 4): 手動輸入價位區間 mini form。onApply 只在兩個值 finite +
// min < max 時觸發(在 parent handleManualApply 檢查)。空值 / NaN 由 parent
// 靜默 reject,不彈錯誤(輸入中間態很常見)。
function PriceRangeInputPanel({
  initialMin,
  initialMax,
  closePrice,
  onApply,
  onCancel,
}: {
  initialMin: number | null;
  initialMax: number | null;
  closePrice?: number;
  onApply: (minStr: string, maxStr: string) => void;
  onCancel: () => void;
}) {
  const [minStr, setMinStr] = useState<string>(
    initialMin !== null ? initialMin.toFixed(2) : "",
  );
  const [maxStr, setMaxStr] = useState<string>(
    initialMax !== null ? initialMax.toFixed(2) : "",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(minStr, maxStr);
  };

  const min = parseFloat(minStr);
  const max = parseFloat(maxStr);
  const valid = Number.isFinite(min) && Number.isFinite(max) && min < max;

  return (
    <form
      data-testid="manual-range-panel"
      onSubmit={handleSubmit}
      className="absolute right-4 top-4 z-40 bg-bg-deep/95 border border-accent px-3 py-2 rounded shadow-lg text-xs w-[240px]"
    >
      <div className="text-ink font-medium mb-2">輸入價位區間</div>
      <div className="flex items-center gap-1.5 mb-2">
        <input
          type="number"
          step="0.05"
          inputMode="decimal"
          value={minStr}
          onChange={(e) => setMinStr(e.target.value)}
          placeholder="下限"
          aria-label="價位下限"
          data-testid="manual-range-min"
          className="w-20 h-7 px-1.5 tabular-nums bg-bg border border-line rounded text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
          autoFocus
        />
        <span className="text-ink-dim">～</span>
        <input
          type="number"
          step="0.05"
          inputMode="decimal"
          value={maxStr}
          onChange={(e) => setMaxStr(e.target.value)}
          placeholder="上限"
          aria-label="價位上限"
          data-testid="manual-range-max"
          className="w-20 h-7 px-1.5 tabular-nums bg-bg border border-line rounded text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
        />
      </div>
      {closePrice !== undefined && (
        <div className="text-2xs text-ink-dim mb-2 tabular-nums">
          參考收盤 {closePrice.toFixed(2)}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          data-testid="manual-range-apply"
          disabled={!valid}
          className="text-accent hover:text-ink underline underline-offset-2 cursor-pointer disabled:text-ink-dim disabled:cursor-not-allowed disabled:no-underline"
        >
          套用
        </button>
        <button
          type="button"
          data-testid="manual-range-cancel"
          onClick={onCancel}
          className="text-ink-dim hover:text-bear cursor-pointer"
        >
          取消
        </button>
      </div>
    </form>
  );
}

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
  selectedIds,
  colorFor,
  labelFor,
  onSelect,
  sortSpec,
  onSortChange,
}: {
  rows: TradeRow[];
  side: "buy" | "sell";
  /** SC-4:選中分點 id 集合(多選)— row active 態(Phase 4 F1/F2 id-key)。 */
  selectedIds: ReadonlySet<string>;
  /** SC-4:N ≥ 2 時回該分點專屬色(列首圓點,id-key),否則 null。 */
  colorFor: (brokerId: string) => string | null;
  /** SC-7:broker name → 「id 去dash名」顯示 label。 */
  labelFor: (name: string) => string;
  onSelect: (broker: string | null, brokerId?: string | null) => void;
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
                onClick={() => onSelect(r.broker, r.broker_id)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  height: vi.size,
                }}
                className={`grid grid-cols-[1fr_56px_56px] items-center text-xs px-2 border-b border-line/20 cursor-pointer transition-colors ${
                  selectedIds.has(r.broker_id)
                    ? `${activeClass} text-ink`
                    : "hover:bg-bg-deep/50 text-ink-muted"
                }`}
              >
                <span className="text-left truncate">
                  {(() => {
                    const dot = colorFor(r.broker_id);
                    return dot ? (
                      <span
                        data-testid="row-broker-dot"
                        data-color={dot}
                        aria-hidden="true"
                        className="inline-block size-2 rounded-full mr-1 align-middle"
                        style={{ background: dot }}
                      />
                    ) : null;
                  })()}
                  {labelFor(r.broker)}
                </span>
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
