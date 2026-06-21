import type { ChipSummary, TopBroker } from "../lib/chip-data";
import { splitBrokers, fmtVol } from "../lib/chip-data";

interface Props {
  summary: ChipSummary | null;
}

const FOREIGN_KEYWORDS = ["外資", "摩根", "美林", "高盛", "瑞銀", "花旗", "瑞信", "巴克萊", "德意志", "野村", "大和", "麥格理"];
const GOV_KEYWORDS = ["官股", "公股", "臺銀", "台銀", "兆豐", "合庫", "第一金", "華南", "彰銀", "土銀"];

function brokerBadge(name: string): string | null {
  if (FOREIGN_KEYWORDS.some((k) => name.includes(k))) return "外";
  if (GOV_KEYWORDS.some((k) => name.includes(k))) return "官";
  return null;
}

function BrokerRow({ rank, broker }: { rank: number; broker: TopBroker }) {
  const badge = brokerBadge(broker.name);
  const netCls = broker.net > 0 ? "text-accent" : broker.net < 0 ? "text-bear" : "text-ink-dim";

  return (
    <div className="grid grid-cols-[32px_1fr_90px_80px_80px] items-center text-sm py-2 px-2 border-b border-line/40 hover:bg-bg-deep/50">
      <span className="text-ink-dim tabular-nums">{rank}</span>
      <span className="flex items-center gap-1.5 truncate text-ink-muted">
        <span className="truncate">{broker.name}</span>
        {badge && (
          <span className={`shrink-0 text-2xs px-1 py-px rounded ${badge === "外" ? "bg-accent/15 text-accent" : "bg-bear/15 text-bear"}`}>
            {badge}
          </span>
        )}
      </span>
      <span className={`text-right tabular-nums font-medium ${netCls}`}>
        {broker.net > 0 ? "+" : ""}{fmtVol(broker.net)}
      </span>
      <span className="text-right tabular-nums text-accent">{fmtVol(broker.buy)}</span>
      <span className="text-right tabular-nums text-bear">{fmtVol(broker.sell)}</span>
    </div>
  );
}

export function ChipBrokersPanel({ summary }: Props) {
  if (!summary) {
    return (
      <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
        請搜尋股票代號
      </div>
    );
  }

  const { buyers, sellers } = splitBrokers(summary.top_brokers);
  const { institutional, margin } = summary;
  const buyTotal = buyers.slice(0, 15).reduce((s, b) => s + b.net, 0);
  const sellTotal = sellers.slice(0, 15).reduce((s, b) => s + b.net, 0);
  const majorNet = buyTotal + sellTotal;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Stock info */}
      <div className="px-3 py-3 border-b border-line">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-lg text-ink font-medium">{summary.symbol}</span>
          <span className="text-xs text-ink-dim">{summary.date}</span>
        </div>
      </div>

      {/* Institutional summary */}
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

      {/* Margin summary */}
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

      {/* Major net + Buy/Sell totals */}
      <div className="px-3 py-2 border-b border-line flex items-center justify-between text-base">
        <span className="text-ink-dim">主力買賣超</span>
        <span className={`tabular-nums font-medium ${majorNet >= 0 ? "text-accent" : "text-bear"}`}>
          {majorNet > 0 ? "+" : ""}{fmtVol(majorNet)} 張
        </span>
      </div>
      <div className="px-3 py-2 border-b border-line flex items-center justify-between text-base">
        <span className="text-ink-dim">買超前15合計</span>
        <span className="tabular-nums font-medium text-accent">+{fmtVol(buyTotal)} 張</span>
      </div>
      <div className="px-3 py-2 border-b border-line flex items-center justify-between text-base">
        <span className="text-ink-dim">賣超前15合計</span>
        <span className="tabular-nums font-medium text-bear">{fmtVol(sellTotal)} 張</span>
      </div>

      {/* Scrollable broker list — sticky header inside avoids scrollbar-width misalignment */}
      <div className="flex-1 overflow-y-auto min-h-0 scroll-editorial">
        <div className="sticky top-0 z-[2] grid grid-cols-[32px_1fr_90px_80px_80px] text-sm text-ink-dim px-2 py-1.5 border-b border-line bg-bg-deep">
          <span>#</span>
          <span>券商</span>
          <span className="text-right">淨買賣</span>
          <span className="text-right">買張</span>
          <span className="text-right">賣張</span>
        </div>
        {/* Buyers */}
        {buyers.length > 0 && (
          <div className="border-b border-line">
            <div className="px-2 py-1 text-2xs text-accent bg-accent/[0.04] uppercase tracking-wider">
              買超
            </div>
            {buyers.slice(0, 15).map((b, i) => (
              <BrokerRow key={b.broker_id} rank={i + 1} broker={b} />
            ))}
          </div>
        )}

        {/* Sellers */}
        {sellers.length > 0 && (
          <div>
            <div className="px-2 py-1 text-2xs text-bear bg-bear/[0.04] uppercase tracking-wider">
              賣超
            </div>
            {sellers.slice(0, 15).map((b, i) => (
              <BrokerRow key={b.broker_id} rank={i + 1} broker={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
