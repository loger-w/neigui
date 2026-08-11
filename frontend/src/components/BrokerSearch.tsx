import { useEffect, useMemo, useRef, useState } from "react";
import type { BrokerTrade } from "../lib/chip-data";
import { formatBrokerLabel, normalizeBrokerQuery } from "../lib/broker-name";

// bubble-multi-broker:純「搜尋即加選」多選契約 — 不 echo 選中分點、無清除鈕
// (清除職責在 ChipBubbleView 的 legend chips)。聚合與選取 key 一律 broker_id
// (同名不同 id 是不同分點,分列各選;收割 next-time.md deferred 項)。
interface AggBroker {
  id: string;
  /** 原始分點名(onPick 回傳用;顯示走 label)。 */
  broker: string;
  /** 顯示用「id 去dash名」label。 */
  label: string;
  total: number;
  buy: number;
  sell: number;
}

interface Props {
  trades: BrokerTrade[];
  /** 已選分點 id 集合 — 下拉列標記 aria-selected + ✓。 */
  selectedIds: ReadonlySet<string>;
  /** toggle 語意由 caller 決定(已選再點 = 移除);本元件只回報點了誰。 */
  onPick: (id: string, name: string) => void;
  /** 下拉「實際可見」(open 且有結果)變化回報 — ChipBubbleView 的
   *  dismiss-click guard 用(下拉開啟時點圖表只關下拉、不動選取)。 */
  onOpenChange?: (open: boolean) => void;
}

const HIGHLIGHT = "#f0b429";

// 比對是 dash-insensitive(normalizeBrokerQuery 雙邊去 dash),name 這裡是
// formatted label(已去 dash)但 query 可能照原始名帶 dash — 兩邊 normalize
// 後找命中,再用 index map 回推原始字串區間著色。
function highlightMatch(name: string, q: string): React.ReactNode {
  const nq = normalizeBrokerQuery(q);
  if (!nq) return name;
  const idxMap: number[] = [];
  let normalized = "";
  for (let i = 0; i < name.length; i++) {
    if (name[i] === "-") continue;
    idxMap.push(i);
    normalized += name[i]!.toLowerCase();
  }
  const hit = normalized.indexOf(nq);
  if (hit < 0) return name;
  const start = idxMap[hit]!;
  const end = idxMap[hit + nq.length - 1]! + 1;
  return (
    <>
      {name.slice(0, start)}
      <span
        data-testid="broker-search-highlight"
        style={{ color: HIGHLIGHT, fontWeight: 500 }}
      >
        {name.slice(start, end)}
      </span>
      {name.slice(end)}
    </>
  );
}

export function BrokerSearch({ trades, selectedIds, onPick, onOpenChange }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const activeIdxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveActive = (next: number) => {
    activeIdxRef.current = next;
    setActiveIdx(next);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(query), 200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const aggregates: AggBroker[] = useMemo(() => {
    const m = new Map<string, AggBroker>();
    for (const t of trades) {
      let e = m.get(t.broker_id);
      if (!e) {
        e = {
          id: t.broker_id,
          broker: t.broker,
          label: formatBrokerLabel(t.broker_id, t.broker),
          total: 0,
          buy: 0,
          sell: 0,
        };
        m.set(t.broker_id, e);
      }
      e.buy += t.buy;
      e.sell += t.sell;
      e.total += t.buy + t.sell;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [trades]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return aggregates.slice(0, 50);
    // SC-7:比對接受原始名稱(含 dash)與 formatted label(= id + 去dash名)
    return aggregates
      .filter(
        (b) =>
          b.broker.toLowerCase().includes(q) ||
          b.label.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [aggregates, debounced]);

  useEffect(() => {
    activeIdxRef.current = 0;
    setActiveIdx(0);
  }, [filtered]);

  // 下拉實際可見 = open 且有結果(與 render 條件同源)。
  const dropdownVisible = open && filtered.length > 0;
  useEffect(() => {
    onOpenChange?.(dropdownVisible);
  }, [dropdownVisible, onOpenChange]);

  // R1:pick 後不關下拉、不清 query — 連續加選是多選核心操作流。
  const pick = (b: AggBroker) => {
    onPick(b.id, b.broker);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      moveActive(Math.min(activeIdxRef.current + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      moveActive(Math.max(0, activeIdxRef.current - 1));
    } else if (e.key === "Enter") {
      if (!open) {
        setOpen(true);
        return;
      }
      const target = filtered[activeIdxRef.current];
      if (target) pick(target);
    }
  };

  return (
    <div className="relative w-full max-w-[360px]">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder="搜尋分點..."
        aria-label="搜尋分點"
        role="combobox"
        aria-expanded={open && filtered.length > 0}
        aria-controls="broker-search-listbox"
        className="w-full bg-bg-deep border border-line text-ink px-2.5 py-1 text-xs outline-none focus:border-[#f0b429]"
      />
      {dropdownVisible && (
        <div
          id="broker-search-listbox"
          role="listbox"
          aria-label="分點搜尋結果"
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-deep border border-line max-h-[280px] overflow-y-auto"
        >
          {filtered.map((b, i) => {
            const isSelected = selectedIds.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid="broker-search-item"
                // R1:preventDefault 保 input focus — 否則點擊奪焦觸發 blur,
                // 150ms closeTimer 會關下拉,連續加選在真瀏覽器失效。
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(b);
                }}
                className={`w-full px-2 py-1.5 grid grid-cols-[12px_1fr_50px_44px_44px] gap-1 text-xs text-left items-center ${
                  i === activeIdx
                    ? "bg-line-strong/40 border-l-2 border-[#f0b429]"
                    : "hover:bg-line-strong/20"
                }`}
              >
                <span className="text-[#f0b429]">{isSelected ? "✓" : ""}</span>
                <span className="text-ink truncate">
                  {highlightMatch(b.label, debounced)}
                </span>
                <span className="text-right text-ink-dim tabular-nums">
                  {b.total.toLocaleString()}
                </span>
                <span className="text-right text-accent tabular-nums">
                  {b.buy.toLocaleString()}
                </span>
                <span className="text-right text-bear tabular-nums">
                  {b.sell.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
