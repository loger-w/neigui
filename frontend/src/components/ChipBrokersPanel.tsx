import { useMemo, useState } from "react";
import type { ChipSummary, TopBroker, TopVolumeBroker } from "../lib/chip-data";
import { splitBrokers, fmtVol, topByVolume } from "../lib/chip-data";
import { Checkbox } from "./ui/checkbox";

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

function rateClass(r: number | null): string {
  if (r === null) return "text-[#4a4234]";
  if (r >= 0.8) return "text-[#b794f4]";
  if (r >= 0.5) return "text-[#f0b429]";
  return "text-ink-dim";
}

interface RowProps {
  rank: number;
  broker: TopBroker | TopVolumeBroker;
  mode: Mode;
  selected: boolean;
  onToggle: () => void;
}

function BrokerRow({ rank, broker, mode, selected, onToggle }: RowProps) {
  const badge = brokerBadge(broker.name);
  const netCls = broker.net > 0 ? "text-accent" : broker.net < 0 ? "text-bear" : "text-ink-dim";
  const cls = mode === "net"
    ? "grid-cols-[22px_32px_1fr_90px_80px_80px]"
    : "grid-cols-[22px_32px_1fr_64px_64px_76px]";

  return (
    <div className={`grid ${cls} items-center text-sm py-2 px-2 border-b border-line/40 hover:bg-bg-deep/50 ${selected ? "bg-[#b794f4]/[0.06]" : ""}`}>
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`勾選 ${broker.name}`}
      />
      <span className="text-ink-dim tabular-nums">{rank}</span>
      <span className="flex items-center gap-1.5 truncate text-ink-muted">
        <span className="truncate">{broker.name}</span>
        {badge && (
          <span className={`shrink-0 text-2xs px-1 py-px rounded ${badge === "外" ? "bg-accent/15 text-accent" : "bg-bear/15 text-bear"}`}>
            {badge}
          </span>
        )}
      </span>
      {mode === "net" ? (
        <>
          <span className={`text-right tabular-nums font-medium ${netCls}`}>
            {broker.net > 0 ? "+" : ""}{fmtVol(broker.net)}
          </span>
          <span className="text-right tabular-nums text-accent">{fmtVol(broker.buy)}</span>
          <span className="text-right tabular-nums text-bear">{fmtVol(broker.sell)}</span>
        </>
      ) : (
        <>
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
      <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
        請搜尋股票代號
      </div>
    );
  }

  const { margin } = summary;
  const N = selectedBrokerIds.size;
  const netHeaderCols = "grid-cols-[22px_32px_1fr_90px_80px_80px]";
  const volHeaderCols = "grid-cols-[22px_32px_1fr_64px_64px_76px]";

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
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

      {/* F7: 主力買賣超 above 融資融券 (was below). F4 also removed the
          right-side symbol/date header and 三大法人 block — that data lives
          in the K-line sub-charts on the left. */}
      <div className="px-3 py-2 border-b border-line flex items-center justify-between text-base">
        <span className="text-ink-dim">主力買賣超</span>
        <span className={`tabular-nums font-medium ${majorNet >= 0 ? "text-accent" : "text-bear"}`}>
          {majorNet > 0 ? "+" : ""}{fmtVol(majorNet)} 張
        </span>
      </div>

      <div className="px-3 py-2.5 border-b border-line">
        <div className="text-sm text-ink-dim uppercase tracking-wider mb-2">融資融券</div>
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

      {/* Selected-broker chips */}
      {N > 0 && (
        <div className="px-3 py-2 border-b border-line bg-bg-deep/40 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-ink-dim">已選 {N} 個分點:</span>
          {Array.from(selectedBrokerIds).map((bid) => {
            const name = idToName.get(bid) ?? bid;
            return (
              <span
                key={bid}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#b794f4]/15 border border-[#b794f4]/40 text-[#b794f4]"
              >
                {name}
                <button
                  type="button"
                  onClick={() => onToggleBroker(bid)}
                  aria-label={`移除 ${name}`}
                  className="hover:text-bear cursor-pointer"
                >×</button>
              </span>
            );
          })}
          {N > 1 && (
            <button
              type="button"
              onClick={onClearAllBrokers}
              className="ml-auto text-xs text-ink-dim hover:text-bear cursor-pointer"
            >全部清除</button>
          )}
        </div>
      )}

      {/* Broker list — F5: net mode splits into two half-height scroll halves */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {mode === "net" ? (
          <>
            <div
              data-testid="buyers-scroll"
              className="flex-1 min-h-0 overflow-y-auto scroll-editorial"
            >
              <div className={`sticky top-0 z-[2] grid ${netHeaderCols} text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep`}>
                <span></span>
                <span>#</span>
                <span>分點</span>
                <span className="text-right">淨買賣</span>
                <span className="text-right">買張</span>
                <span className="text-right">賣張</span>
              </div>
              <div className="px-2 py-1 text-2xs text-accent bg-accent/[0.04] uppercase tracking-wider">
                買超
              </div>
              {buyers.length > 0 ? (
                buyers.slice(0, 15).map((b, i) => (
                  <BrokerRow
                    key={b.broker_id}
                    rank={i + 1}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id)}
                  />
                ))
              ) : (
                <div className="px-2 py-3 text-xs text-ink-dim italic">無買超分點</div>
              )}
            </div>
            <div
              data-testid="sellers-scroll"
              className="flex-1 min-h-0 overflow-y-auto scroll-editorial border-t border-line"
            >
              <div className={`sticky top-0 z-[2] grid ${netHeaderCols} text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep`}>
                <span></span>
                <span>#</span>
                <span>分點</span>
                <span className="text-right">淨買賣</span>
                <span className="text-right">買張</span>
                <span className="text-right">賣張</span>
              </div>
              <div className="px-2 py-1 text-2xs text-bear bg-bear/[0.04] uppercase tracking-wider">
                賣超
              </div>
              {sellers.length > 0 ? (
                sellers.slice(0, 15).map((b, i) => (
                  <BrokerRow
                    key={b.broker_id}
                    rank={i + 1}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id)}
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
            className="flex-1 min-h-0 overflow-y-auto scroll-editorial"
          >
            <div className={`sticky top-0 z-[2] grid ${volHeaderCols} text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep`}>
              <span></span>
              <span>#</span>
              <span>分點</span>
              <span className="text-right">買張</span>
              <span className="text-right">賣張</span>
              <span className="text-right">當沖率</span>
            </div>
            {volumeBrokers.map((b, i) => (
              <BrokerRow
                key={b.broker_id}
                rank={i + 1}
                broker={b}
                mode="volume"
                selected={selectedBrokerIds.has(b.broker_id)}
                onToggle={() => onToggleBroker(b.broker_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
