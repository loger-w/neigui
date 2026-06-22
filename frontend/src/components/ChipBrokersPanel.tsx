import { useMemo, useState } from "react";
import type { ChipSummary, TopBroker, TopVolumeBroker } from "../lib/chip-data";
import { splitBrokers, fmtVol, topByVolume } from "../lib/chip-data";

interface Props {
  summary: ChipSummary | null;
  dayTotalLots: number;
  selectedBrokerIds: Set<string>;
  onToggleBroker: (brokerId: string, brokerName: string) => void;
  onClearAllBrokers: () => void;
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
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`勾選 ${broker.name}`}
        className="w-3.5 h-3.5 accent-[#b794f4] cursor-pointer"
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
  summary, dayTotalLots, selectedBrokerIds, onToggleBroker, onClearAllBrokers,
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

  if (!summary) {
    return (
      <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
        請搜尋股票代號
      </div>
    );
  }

  const { institutional, margin } = summary;
  const N = selectedBrokerIds.size;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-line">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-lg text-ink font-medium">{summary.symbol}</span>
          <span className="text-xs text-ink-dim">{summary.date}</span>
        </div>
      </div>

      <div className="px-3 py-2.5 border-b border-line">
        <div className="text-sm text-ink-dim uppercase tracking-wider mb-2">三大法人</div>
        <div className="grid grid-cols-3 gap-2 text-base">
          <div>
            <div className="text-ink-dim mb-0.5">外資</div>
            <div className={`tabular-nums font-medium ${institutional.foreign.net >= 0 ? "text-accent" : "text-bear"}`}>
              {institutional.foreign.net > 0 ? "+" : ""}{fmtVol(institutional.foreign.net)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">投信</div>
            <div className={`tabular-nums font-medium ${institutional.trust.net >= 0 ? "text-accent" : "text-bear"}`}>
              {institutional.trust.net > 0 ? "+" : ""}{fmtVol(institutional.trust.net)} 張
            </div>
          </div>
          <div>
            <div className="text-ink-dim mb-0.5">自營商</div>
            <div className={`tabular-nums font-medium ${institutional.dealer.net >= 0 ? "text-accent" : "text-bear"}`}>
              {institutional.dealer.net > 0 ? "+" : ""}{fmtVol(institutional.dealer.net)} 張
            </div>
          </div>
        </div>
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

      {/* Major net (kept) */}
      <div className="px-3 py-2 border-b border-line flex items-center justify-between text-base">
        <span className="text-ink-dim">主力買賣超</span>
        <span className={`tabular-nums font-medium ${majorNet >= 0 ? "text-accent" : "text-bear"}`}>
          {majorNet > 0 ? "+" : ""}{fmtVol(majorNet)} 張
        </span>
      </div>

      {/* Selectbar (F2) */}
      <div className="px-3 py-2 border-b border-line flex gap-0">
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

      {/* Chips region (F4) */}
      {N > 0 && (
        <div className="px-3 py-2 border-b border-line bg-bg-deep/40 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-ink-dim">已選 {N} 個分點:</span>
          {Array.from(selectedBrokerIds).map((id) => {
            const known = allBrokers.find((b) => b.broker_id === id);
            const name = known?.name ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#b794f4]/15 border border-[#b794f4]/40 text-[#b794f4]"
              >
                {name}
                <button
                  type="button"
                  onClick={() => onToggleBroker(id, name)}
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

      {/* Broker list */}
      <div className="flex-1 overflow-y-auto min-h-0 scroll-editorial">
        {mode === "net" ? (
          <>
            <div className="sticky top-0 z-[2] grid grid-cols-[22px_32px_1fr_90px_80px_80px] text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep">
              <span></span>
              <span>#</span>
              <span>分點</span>
              <span className="text-right">淨買賣</span>
              <span className="text-right">買張</span>
              <span className="text-right">賣張</span>
            </div>
            {buyers.length > 0 && (
              <div className="border-b border-line">
                <div className="px-2 py-1 text-2xs text-accent bg-accent/[0.04] uppercase tracking-wider">
                  買超
                </div>
                {buyers.slice(0, 15).map((b, i) => (
                  <BrokerRow
                    key={b.broker_id}
                    rank={i + 1}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id, b.name)}
                  />
                ))}
              </div>
            )}
            {sellers.length > 0 && (
              <div>
                <div className="px-2 py-1 text-2xs text-bear bg-bear/[0.04] uppercase tracking-wider">
                  賣超
                </div>
                {sellers.slice(0, 15).map((b, i) => (
                  <BrokerRow
                    key={b.broker_id}
                    rank={i + 1}
                    broker={b}
                    mode="net"
                    selected={selectedBrokerIds.has(b.broker_id)}
                    onToggle={() => onToggleBroker(b.broker_id, b.name)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="sticky top-0 z-[2] grid grid-cols-[22px_32px_1fr_64px_64px_76px] text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep">
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
                onToggle={() => onToggleBroker(b.broker_id, b.name)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
