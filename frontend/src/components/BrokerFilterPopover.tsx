import { useMemo, useState } from "react";
import type { TopBroker } from "../lib/chip-data";
import { fmtVol } from "../lib/chip-data";
import { formatBrokerName } from "../lib/broker-name";
import { Checkbox } from "./ui/checkbox";
import { PopoverPanel } from "./ui/PopoverPanel";

type SortMode = "net" | "name";

interface Props {
  brokers: TopBroker[];
  selectedBrokerIds: Set<string>;
  onToggleBroker: (brokerId: string) => void;
  onClearAllBrokers: () => void;
}

export function BrokerFilterPopover({
  brokers, selectedBrokerIds, onToggleBroker, onClearAllBrokers,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("net");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? brokers.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.broker_id.toLowerCase().includes(q),
        )
      : brokers.slice();
    if (sort === "net") {
      rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    } else {
      rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    }
    return rows;
  }, [brokers, query, sort]);

  const N = selectedBrokerIds.size;

  return (
    <PopoverPanel
      contentTestId="broker-filter-popover"
      contentClassName="w-[320px] max-h-[60vh]"
      listTestId="broker-filter-list"
      trigger={
        <button
          type="button"
          data-testid="broker-filter-trigger"
          aria-label={`開啟分點篩選,目前已選 ${N} 個`}
          className="shrink-0 inline-flex items-center gap-1 px-2 h-6 text-xs border border-line-strong text-ink-muted hover:text-accent hover:border-accent cursor-pointer rounded"
        >
          <span>篩選</span>
          <span className="tabular-nums text-ink-dim">⋯</span>
          {N > 0 && (
            <span
              data-testid="broker-filter-count"
              className="ml-1 tabular-nums text-[#b794f4]"
            >
              {N}
            </span>
          )}
        </button>
      }
      headerClassName="flex items-center gap-2"
      header={
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋分點名稱或代號"
            aria-label="搜尋分點"
            className="flex-1 min-w-0 h-7 px-2 text-xs bg-bg border border-line rounded text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setSort((s) => (s === "net" ? "name" : "net"))}
            aria-label={`目前排序 ${sort === "net" ? "淨買賣" : "名稱"},點擊切換`}
            className="shrink-0 text-xs px-2 h-7 border border-line text-ink-dim hover:text-accent hover:border-accent cursor-pointer rounded"
          >
            {sort === "net" ? "淨買賣" : "名稱"}
          </button>
        </>
      }
      footerClassName="justify-between text-xs"
      footer={
        <>
          <span className="text-ink-dim">
            已選 <span className="text-[#b794f4] tabular-nums">{N}</span> / {brokers.length}
          </span>
          {N > 0 && (
            <button
              type="button"
              data-testid="broker-filter-clear-all"
              onClick={onClearAllBrokers}
              className="text-ink-dim hover:text-bear cursor-pointer"
            >
              全部清除
            </button>
          )}
        </>
      }
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-xs text-ink-dim italic">無符合分點</div>
      ) : (
        filtered.map((b) => {
          const selected = selectedBrokerIds.has(b.broker_id);
          // 顯示/aria/title 只顯去dash名稱(popover 清單非搜尋框)
          const label = formatBrokerName(b.broker_id, b.name);
          const netCls = b.net > 0
            ? "text-accent"
            : b.net < 0
              ? "text-bear"
              : "text-ink-dim";
          return (
            <div
              key={b.broker_id}
              data-testid="broker-filter-row"
              data-broker-id={b.broker_id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onToggleBroker(b.broker_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleBroker(b.broker_id);
                }
              }}
              className={`flex items-center gap-2 px-3 py-1.5 border-b border-line/40 text-xs cursor-pointer hover:bg-bg-deep/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                selected ? "bg-[#b794f4]/[0.08]" : ""
              }`}
            >
              <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => onToggleBroker(b.broker_id)}
                  aria-label={`勾選 ${label}`}
                />
              </span>
              <span className="flex-1 min-w-0 truncate text-ink-muted" title={label}>
                {label}
              </span>
              <span className={`shrink-0 tabular-nums ${netCls}`}>
                {b.net > 0 ? "+" : ""}{fmtVol(b.net)}
              </span>
            </div>
          );
        })
      )}
    </PopoverPanel>
  );
}
