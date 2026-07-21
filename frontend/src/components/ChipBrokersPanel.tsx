import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ChipSummary, TopBroker, TopVolumeBroker } from "../lib/chip-data";
import { splitBrokers, fmtVol, topByVolume } from "../lib/chip-data";
import { formatBrokerLabel } from "../lib/broker-name";
import { Checkbox } from "./ui/checkbox";
import { BrokerFilterPopover } from "./BrokerFilterPopover";

interface Props {
  summary: ChipSummary | null;
  dayTotalLots: number;
  // Selection keyed by broker_id (FinMind `securities_trader_id`): that's the
  // value the SecIdAgg broker_history endpoint filters on. Display names come
  // from `summary.top_brokers` for the same id.
  selectedBrokerIds: Set<string>;
  onToggleBroker: (brokerId: string) => void;
  onClearAllBrokers: () => void;
  /** F3 (Cluster B 🟢): summary refetch is in flight. When true AND summary
   *  is present, the panel shows a small inline "載入中…" caption and sets
   *  aria-busy so screen readers announce the busy state. Previous summary
   *  stays visible — no empty placeholder flash. */
  loading?: boolean;
  /** CH-4(mod/batch-ui-update)後 header 已刪除,此二欄位僅為 caller 相容
   *  保留(N 日脈絡改由 K 線 HUD 呈現)。 */
  windowDays?: number;
  actualDays?: number;
  /** 手機堆疊版面(responsive):true 時整體交由外層頁面捲動,買賣超清單
   *  自然高度完整展開(不做內部雙捲動區、header 不 sticky)。桌面(預設
   *  false)維持固定高度 + 買超/賣超各自內捲。 */
  flowScroll?: boolean;
  /** CH-1(mod/batch-ui-update):每列「看泡泡圖」動作鈕 — App 層切 bubble
   *  tab 並聚焦該分點。未提供時不渲染鈕(caller 相容)。 */
  onShowInBubble?: (brokerId: string, name: string) => void;
}

type Mode = "net" | "volume";

const FOREIGN_KEYWORDS = ["外資", "摩根", "美林", "高盛", "瑞銀", "花旗", "瑞信", "巴克萊", "德意志", "野村", "大和", "麥格理"];
const GOV_KEYWORDS = ["官股", "公股", "臺銀", "台銀", "兆豐", "合庫", "第一金", "華南", "彰銀", "土銀"];

function brokerBadge(name: string): string | null {
  if (FOREIGN_KEYWORDS.some((k) => name.includes(k))) return "外";
  if (GOV_KEYWORDS.some((k) => name.includes(k))) return "官";
  return null;
}

function fmtRate(r: number | null): string {
  if (r === null) return "—";
  return `${Math.round(r * 100)}%`;
}

function fmtAvgPrice(p: number): string {
  // avg_*_price = 0 means "no trade on this side" (backend skips the
  // weighted-avg division when share count is zero). Render an em-dash
  // rather than the misleading 0.00.
  if (!p || p <= 0) return "—";
  return p.toFixed(2);
}

function rateClass(r: number | null): string {
  if (r === null) return "text-[#4a4234]";
  if (r >= 0.8) return "text-[#b794f4]";
  if (r >= 0.5) return "text-[#f0b429]";
  return "text-ink-dim";
}

interface RowProps {
  broker: TopBroker | TopVolumeBroker;
  mode: Mode;
  selected: boolean;
  onToggle: () => void;
  onShowInBubble?: (brokerId: string, name: string) => void;
}

function BrokerRow({ broker, mode, selected, onToggle, onShowInBubble }: RowProps) {
  const badge = brokerBadge(broker.name);
  // SC-7:顯示/aria/tooltip 統一「id 去dash名」;callback 契約仍傳原始 name
  const label = formatBrokerLabel(broker.broker_id, broker.name);
  const netCls = broker.net > 0 ? "text-accent" : broker.net < 0 ? "text-bear" : "text-ink-dim";
  // Column order: 買均 → 賣均 → 買張 → 賣張 (avg-price pair first, then
  // volume pair). Net mode prepends 淨買賣 col; volume mode appends 當沖率.
  // Responsive spec §4.3:窄容器(<400px,px 基準 container query — 用 rem 的 @md 在大螢幕 root 放大後門檻會超過預設面板寬 420px,反而藏欄)隱藏買均/賣均,
  // 手機至少保住「誰、買賣超多少」。
  const cls = mode === "net"
    ? "grid-cols-[22px_1fr_64px_52px_52px] @[400px]:grid-cols-[22px_1fr_64px_56px_56px_52px_52px]"
    : "grid-cols-[22px_1fr_52px_52px_56px] @[400px]:grid-cols-[22px_1fr_56px_56px_52px_52px_56px]";

  // C8 B1 (🟢): 整 row 可點,擴大 hit area。checkbox 保留但用 span wrapper
  // 攔 click bubble 避免 double-toggle。keyboard Enter/Space 也觸發。
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 只認 row 自身的按鍵:巢狀互動元素(看泡泡圖鈕 / checkbox)的 keydown
    // 冒泡上來若被 preventDefault,會抑制其原生 Enter/Space activation,
    // 鍵盤操作變成誤觸整列 toggle(白名單 2 的鍵盤面)。
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      className={`grid ${cls} items-center text-sm py-2 pointer-coarse:py-3 px-2 border-b border-line/40 cursor-pointer hover:bg-bg-deep/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${selected ? "bg-[#b794f4]/[0.06]" : ""}`}
    >
      <span
        onClick={(e) => e.stopPropagation()}
        className="inline-flex"
      >
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`勾選 ${label}`}
        />
      </span>
      <span
        className="relative flex items-center gap-1.5 text-ink-muted min-w-0 group/name"
        title={label}
      >
        <span className="truncate flex-1 min-w-0">{label}</span>
        {badge && (
          <span className={`shrink-0 text-2xs px-1 py-px rounded ${badge === "外" ? "bg-accent/15 text-accent" : "bg-bear/15 text-bear"}`}>
            {badge}
          </span>
        )}
        {/* CH-1: 看泡泡圖動作鈕 — stopPropagation 保整列 click = toggle 選取
            (白名單 2)。泡泡雙圈 glyph,hover 才上 accent 色,不搶列內數字。 */}
        {onShowInBubble && (
          <button
            type="button"
            data-testid="broker-row-bubble-btn"
            aria-label={`在泡泡圖檢視 ${label}`}
            title="看泡泡圖"
            onClick={(e) => {
              e.stopPropagation();
              onShowInBubble(broker.broker_id, broker.name);
            }}
            className="shrink-0 p-0.5 text-ink-dim hover:text-accent cursor-pointer"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
              <circle cx="6" cy="9.5" r="4" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="11.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        )}
        <span
          role="tooltip"
          data-testid="broker-name-tooltip"
          className="pointer-events-none absolute left-0 top-full mt-1 z-50 px-2 py-1 bg-bg-deep border border-line-strong text-xs text-ink whitespace-nowrap rounded shadow-lg opacity-0 group-hover/name:opacity-100 transition-opacity duration-100"
        >
          {label}
        </span>
      </span>
      {mode === "net" ? (
        <>
          <span className={`text-right tabular-nums font-medium ${netCls}`}>
            {broker.net > 0 ? "+" : ""}{fmtVol(broker.net)}
          </span>
          <span className="hidden @[400px]:block text-right tabular-nums text-xs text-ink-dim">
            {fmtAvgPrice(broker.avg_buy_price)}
          </span>
          <span className="hidden @[400px]:block text-right tabular-nums text-xs text-ink-dim">
            {fmtAvgPrice(broker.avg_sell_price)}
          </span>
          <span className="text-right tabular-nums text-accent">{fmtVol(broker.buy)}</span>
          <span className="text-right tabular-nums text-bear">{fmtVol(broker.sell)}</span>
        </>
      ) : (
        <>
          <span className="hidden @[400px]:block text-right tabular-nums text-xs text-ink-dim">
            {fmtAvgPrice(broker.avg_buy_price)}
          </span>
          <span className="hidden @[400px]:block text-right tabular-nums text-xs text-ink-dim">
            {fmtAvgPrice(broker.avg_sell_price)}
          </span>
          <span className="text-right tabular-nums text-accent">{fmtVol(broker.buy)}</span>
          <span className="text-right tabular-nums text-bear">{fmtVol(broker.sell)}</span>
          <span className={`text-right tabular-nums font-medium ${rateClass((broker as TopVolumeBroker).daytradeRate)}`}>
            {fmtRate((broker as TopVolumeBroker).daytradeRate)}
          </span>
        </>
      )}
    </div>
  );
}

export function ChipBrokersPanel({
  summary, dayTotalLots, selectedBrokerIds,
  onToggleBroker, onClearAllBrokers, loading,
  flowScroll, onShowInBubble,
}: Props) {
  const [mode, setMode] = useState<Mode>("net");

  const allBrokers = summary?.top_brokers ?? [];
  const { buyers, sellers } = useMemo(() => splitBrokers(allBrokers), [allBrokers]);
  const volumeBrokers = useMemo(
    () => topByVolume(allBrokers, dayTotalLots),
    [allBrokers, dayTotalLots],
  );
  const majorNet = useMemo(
    () =>
      buyers.slice(0, 15).reduce((s, b) => s + b.net, 0) +
      sellers.slice(0, 15).reduce((s, b) => s + b.net, 0),
    [buyers, sellers],
  );
  // id → name lookup for the selected-chip pills. Falls back to the id itself
  // when the broker drops out of the current date's top_brokers list (rare).
  const idToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of allBrokers) m.set(b.broker_id, b.name);
    return m;
  }, [allBrokers]);

  if (!summary) {
    return (
      <div
        data-testid="chip-brokers-panel"
        className="h-full min-h-[40vh] flex items-center justify-center text-ink-dim font-serif italic text-sm"
      >
        請搜尋股票代號
      </div>
    );
  }

  const { margin } = summary;
  const N = selectedBrokerIds.size;
  const netHeaderCols =
    "grid-cols-[22px_1fr_64px_52px_52px] @[400px]:grid-cols-[22px_1fr_64px_56px_56px_52px_52px]";
  const volHeaderCols =
    "grid-cols-[22px_1fr_52px_52px_56px] @[400px]:grid-cols-[22px_1fr_56px_56px_52px_52px_56px]";

  return (
    <div
      data-testid="chip-brokers-panel"
      className={
        flowScroll
          ? "@container flex flex-col"
          : "@container h-full flex flex-col overflow-hidden"
      }
      aria-busy={loading || undefined}
    >
      {/* Cluster B 🟢: localized loading indicator — a 2 px-tall scanning
          accent bar shown while a refetch is in flight. The outer wrapper is
          ALWAYS rendered at h-0.5 / shrink-0 so toggling loading on/off does
          not shift the panel layout (the prior conditional render added/
          removed a flex child, causing 2 px of vertical jitter on candle
          click). Screen readers still announce busy state via aria-busy on
          the panel root above. */}
      <div className="relative h-0.5 overflow-hidden shrink-0" aria-hidden="true">
        {loading && (
          <div
            data-testid="panel-loading-indicator"
            className="absolute inset-0 bg-line/30"
          >
            <div className="absolute inset-y-0 left-0 w-1/4 bg-accent animate-[loading-shimmer_1.4s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-60" />
          </div>
        )}
      </div>

      {/* CH-4(mod/batch-ui-update):日期 header 刪除(N 日脈絡由 K 線 HUD 承載),
          主力併入法人 grid 成 4 欄、無「三大法人」標題 — 騰空間給前 15 大列表。 */}
      <div
        data-testid="panel-institutional"
        className="px-3 py-2.5 border-b border-line"
      >
        <div className="grid grid-cols-4 gap-2 text-base">
          {(
            [
              ["主力", "major", majorNet],
              ["外資", "foreign", summary.institutional?.foreign?.net ?? 0],
              ["投信", "trust", summary.institutional?.trust?.net ?? 0],
              ["自營商", "dealer", summary.institutional?.dealer?.net ?? 0],
            ] as const
          ).map(([label, key, net]) => {
            const cls = net > 0 ? "text-accent" : net < 0 ? "text-bear" : "text-ink-dim";
            return (
              <div key={key}>
                <div className="text-ink-dim mb-0.5">{label}</div>
                <div
                  data-testid={`inst-${key}-net`}
                  className={`tabular-nums font-medium ${cls}`}
                >
                  {net > 0 ? "+" : ""}{fmtVol(net)} 張
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-3 py-2.5 border-b border-line">
        <div className="grid grid-cols-3 gap-2 text-base mb-1.5">
          <div>
            <div className="text-ink-dim mb-0.5">融資增減</div>
            <div className={`tabular-nums font-medium ${margin.margin_purchase.change >= 0 ? "text-accent" : "text-bear"}`}>
              {margin.margin_purchase.change > 0 ? "+" : ""}{fmtVol(margin.margin_purchase.change)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">融券增減</div>
            <div className={`tabular-nums font-medium ${margin.short_sale.change >= 0 ? "text-accent" : "text-bear"}`}>
              {margin.short_sale.change > 0 ? "+" : ""}{fmtVol(margin.short_sale.change)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">券資比</div>
            <div className="tabular-nums text-ink-muted">{margin.short_balance_ratio.toFixed(1)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-ink-dim">
          <div className="tabular-nums">融資餘額 {fmtVol(margin.margin_purchase.balance)}</div>
          <div className="tabular-nums">融券餘額 {fmtVol(margin.short_sale.balance)}</div>
        </div>
      </div>

      {/* Mode tabs — only the active button carries an underline; the section
          header below provides the single dividing line, so tabs visually
          merge into the content without a stacked-borders gap. */}
      <div className="px-3 pt-2 flex gap-0">
        <button
          type="button"
          onClick={() => setMode("net")}
          className={`flex-1 px-2 py-1 text-xs cursor-pointer border-b-2 transition-colors ${
            mode === "net"
              ? "text-[#f0b429] border-[#f0b429]"
              : "text-ink-dim border-transparent hover:text-ink"
          }`}
        >
          前 15 大買賣超
        </button>
        <button
          type="button"
          onClick={() => setMode("volume")}
          className={`flex-1 px-2 py-1 text-xs cursor-pointer border-b-2 transition-colors ${
            mode === "volume"
              ? "text-[#f0b429] border-[#f0b429]"
              : "text-ink-dim border-transparent hover:text-ink"
          }`}
        >
          前 15 大交易量分點
        </button>
      </div>

      {/* Selected-broker chips — C10 (🔴): 固定 h-9 單行,超出橫向 scroll,
          避免點分點後高度撐開(舊 min-h-[36px] pill 22-24px + py 16 破 36 →
          點擊有 4-6px 位移)。多分點情境 popover 是主要入口,pill 只做「已選
          顯示」不再是唯一選擇 UI。 */}
      <div
        data-testid="chip-selected-bar"
        className="px-3 border-b border-line bg-bg-deep/40 flex items-center gap-1.5 h-9"
      >
        <BrokerFilterPopover
          brokers={allBrokers}
          selectedBrokerIds={selectedBrokerIds}
          onToggleBroker={onToggleBroker}
          onClearAllBrokers={onClearAllBrokers}
        />
        <div
          data-testid="chip-selected-scroller"
          className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto scroll-editorial"
        >
          {N === 0 ? (
            <span className="text-xs text-ink-dim italic shrink-0">未選擇分點</span>
          ) : (
            Array.from(selectedBrokerIds).map((bid) => {
              // SC-7:pill 統一「id 去dash名」;名稱缺(不在當日 top_brokers)
              // 時 formatter 退回只顯 id
              const name = formatBrokerLabel(bid, idToName.get(bid) ?? null);
              return (
                <span
                  key={bid}
                  className="shrink-0 inline-flex items-center gap-1 text-2xs leading-none px-1.5 py-1 rounded-full bg-[#b794f4]/15 border border-[#b794f4]/40 text-[#b794f4] whitespace-nowrap"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => onToggleBroker(bid)}
                    aria-label={`移除 ${name}`}
                    className="hover:text-bear cursor-pointer leading-none"
                  >×</button>
                </span>
              );
            })
          )}
        </div>
        {N > 1 && (
          <button
            type="button"
            onClick={onClearAllBrokers}
            className="shrink-0 text-xs text-ink-dim hover:text-bear cursor-pointer"
          >全部清除</button>
        )}
      </div>

      {/* Broker list — F5: net mode splits into two half-height scroll halves。
          flowScroll(手機):不做內捲,清單自然高度全展開交外層頁捲。 */}
      <div className={flowScroll ? "flex flex-col" : "flex-1 min-h-0 flex flex-col overflow-hidden"}>
        {mode === "net" ? (
          <>
            <div
              data-testid="buyers-scroll"
              className={flowScroll ? "" : "flex-1 min-h-0 overflow-y-auto scroll-editorial"}
            >
              <div className={`${flowScroll ? "" : "sticky top-0 z-[2] "}grid ${netHeaderCols} text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep`}>
                <span></span>
                <span>分點</span>
                <span className="text-right">淨買賣</span>
                <span className="hidden @[400px]:block text-right">買均</span>
                <span className="hidden @[400px]:block text-right">賣均</span>
                <span className="text-right">買張</span>
                <span className="text-right">賣張</span>
              </div>
              <div className="px-2 py-1 text-2xs text-accent bg-accent/[0.04] uppercase tracking-wider">
                買超
              </div>
              {buyers.length > 0 ? (
                buyers.slice(0, 15).map((b) => (
                  <BrokerRow
                    key={b.broker_id}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id)}
                    onShowInBubble={onShowInBubble}
                  />
                ))
              ) : (
                <div className="px-2 py-3 text-xs text-ink-dim italic">無買超分點</div>
              )}
            </div>
            <div
              data-testid="sellers-scroll"
              className={
                flowScroll
                  ? "border-t border-line"
                  : "flex-1 min-h-0 overflow-y-auto scroll-editorial border-t border-line"
              }
            >
              {/* SC-3: 賣超半區不重複欄位 header,語意由買超 header 承載 */}
              <div className="px-2 py-1 text-2xs text-bear bg-bear/[0.04] uppercase tracking-wider">
                賣超
              </div>
              {sellers.length > 0 ? (
                sellers.slice(0, 15).map((b) => (
                  <BrokerRow
                    key={b.broker_id}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id)}
                    onShowInBubble={onShowInBubble}
                  />
                ))
              ) : (
                <div className="px-2 py-3 text-xs text-ink-dim italic">無賣超分點</div>
              )}
            </div>
          </>
        ) : (
          <div
            data-testid="volume-scroll"
            className={flowScroll ? "" : "flex-1 min-h-0 overflow-y-auto scroll-editorial"}
          >
            <div className={`${flowScroll ? "" : "sticky top-0 z-[2] "}grid ${volHeaderCols} text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep`}>
              <span></span>
              <span>分點</span>
              <span className="hidden @[400px]:block text-right">買均</span>
              <span className="hidden @[400px]:block text-right">賣均</span>
              <span className="text-right">買張</span>
              <span className="text-right">賣張</span>
              <span className="text-right">當沖率</span>
            </div>
            {volumeBrokers.map((b) => (
              <BrokerRow
                key={b.broker_id}
                broker={b}
                mode="volume"
                selected={selectedBrokerIds.has(b.broker_id)}
                onToggle={() => onToggleBroker(b.broker_id)}
                onShowInBubble={onShowInBubble}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
