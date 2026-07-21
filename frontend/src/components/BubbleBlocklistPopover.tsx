import { useMemo, useState } from "react";
import type { BrokerTrade } from "../lib/chip-data";
import type { BlockedBroker } from "../lib/bubble-blocklist";
import { formatBrokerLabel } from "../lib/broker-name";
import { PopoverPanel } from "./ui/PopoverPanel";

interface Props {
  /** 當日全部成交(未過濾)— 候選分點來源。 */
  trades: BrokerTrade[];
  blocked: BlockedBroker[];
  onAdd: (broker: BlockedBroker) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

const MAX_CANDIDATES = 50;

/** BB-1: 泡泡圖分點過濾清單 popover。搜尋當日分點加入排除;清單全域
 *  (跨個股)持久化,狀態由 ChipBubbleView 持有,此元件純呈現 + callback。 */
export function BubbleBlocklistPopover({
  trades, blocked, onAdd, onRemove, onClearAll,
}: Props) {
  const [query, setQuery] = useState("");

  const blockedIds = useMemo(() => new Set(blocked.map((b) => b.id)), [blocked]);

  // 候選 = 當日有成交且未被排除的 unique 分點,依總成交量 DESC。
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byId = new Map<string, { id: string; name: string; volume: number }>();
    for (const t of trades) {
      if (blockedIds.has(t.broker_id)) continue;
      const prev = byId.get(t.broker_id);
      const vol = t.buy + t.sell;
      if (prev) prev.volume += vol;
      else byId.set(t.broker_id, { id: t.broker_id, name: t.broker, volume: vol });
    }
    return Array.from(byId.values())
      .filter(
        (b) => b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q),
      )
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_CANDIDATES);
  }, [trades, blockedIds, query]);

  const N = blocked.length;

  return (
    <PopoverPanel
      contentTestId="bubble-blocklist-popover"
      contentClassName="w-[300px] max-h-[60vh]"
      listTestId="bubble-blocklist-list"
      trigger={
        <button
          type="button"
          data-testid="bubble-blocklist-trigger"
          aria-label={`開啟分點過濾清單,目前排除 ${N} 個`}
          className="shrink-0 inline-flex items-center gap-1 px-2 h-6 text-xs border border-line-strong text-ink-muted hover:text-accent hover:border-accent cursor-pointer rounded"
        >
          <span>過濾清單</span>
          {N > 0 && (
            <span
              data-testid="bubble-blocklist-count"
              className="ml-0.5 tabular-nums text-[#b794f4]"
            >
              {N}
            </span>
          )}
        </button>
      }
      header={
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋分點加入排除"
          aria-label="搜尋分點加入排除"
          className="w-full h-7 px-2 text-xs bg-bg border border-line rounded text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
        />
      }
      footerClassName="justify-between text-xs"
      footer={
        N > 0 ? (
          <>
            <span className="text-ink-dim">
              已排除 <span className="text-[#b794f4] tabular-nums">{N}</span> 個分點
            </span>
            <button
              type="button"
              data-testid="bubble-blocklist-clear-all"
              onClick={onClearAll}
              className="text-ink-dim hover:text-bear cursor-pointer"
            >
              全部清除
            </button>
          </>
        ) : (
          <span className="text-ink-dim italic">被排除分點不進泡泡與統計</span>
        )
      }
    >
      {query.trim() !== "" && (
        <div>
          {candidates.length === 0 ? (
            <div className="px-3 py-3 text-xs text-ink-dim italic">
              無符合的當日分點
            </div>
          ) : (
            candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                data-testid="bubble-blocklist-candidate"
                onClick={() => {
                  onAdd({ id: c.id, name: c.name });
                  setQuery("");
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-line/40 text-xs cursor-pointer hover:bg-bg-deep/50 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span
                  className="flex-1 min-w-0 truncate text-ink-muted"
                  title={formatBrokerLabel(c.id, c.name)}
                >
                  {formatBrokerLabel(c.id, c.name)}
                </span>
                <span className="shrink-0 text-accent">＋ 排除</span>
              </button>
            ))
          )}
        </div>
      )}
      <div className="px-3 pt-2 pb-1 text-2xs text-ink-dim uppercase tracking-wider">
        已排除
      </div>
      {N === 0 ? (
        <div className="px-3 pb-3 text-xs text-ink-dim italic">尚無排除分點</div>
      ) : (
        blocked.map((b) => (
          <div
            key={b.id}
            data-testid="bubble-blocklist-row"
            className="flex items-center gap-2 px-3 py-1.5 border-b border-line/40 text-xs"
          >
            <span
              className="flex-1 min-w-0 truncate text-ink-muted"
              title={formatBrokerLabel(b.id, b.name)}
            >
              {formatBrokerLabel(b.id, b.name)}
            </span>
            <button
              type="button"
              data-testid="bubble-blocklist-remove"
              onClick={() => onRemove(b.id)}
              aria-label={`移除 ${formatBrokerLabel(b.id, b.name)}`}
              className="shrink-0 text-ink-dim hover:text-bear cursor-pointer leading-none px-1"
            >
              ×
            </button>
          </div>
        ))
      )}
    </PopoverPanel>
  );
}
