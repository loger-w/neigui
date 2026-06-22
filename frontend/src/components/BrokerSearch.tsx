import { useEffect, useMemo, useRef, useState } from "react";
import type { BrokerTrade } from "../lib/chip-data";

interface AggBroker {
  broker: string;
  total: number;
  buy: number;
  sell: number;
}

interface Props {
  trades: BrokerTrade[];
  value: string | null;
  onChange: (broker: string | null) => void;
}

const HIGHLIGHT = "#f0b429";

function highlightMatch(name: string, q: string): React.ReactNode {
  if (!q) return name;
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <span style={{ color: HIGHLIGHT, fontWeight: 500 }}>
        {name.slice(i, i + q.length)}
      </span>
      {name.slice(i + q.length)}
    </>
  );
}

export function BrokerSearch({ trades, value, onChange }: Props) {
  const [query, setQuery] = useState(value ?? "");
  const [debounced, setDebounced] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const activeIdxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveActive = (next: number) => {
    activeIdxRef.current = next;
    setActiveIdx(next);
  };

  useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

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
      let e = m.get(t.broker);
      if (!e) {
        e = { broker: t.broker, total: 0, buy: 0, sell: 0 };
        m.set(t.broker, e);
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
    return aggregates
      .filter((b) => b.broker.toLowerCase().includes(q))
      .slice(0, 50);
  }, [aggregates, debounced]);

  useEffect(() => {
    activeIdxRef.current = 0;
    setActiveIdx(0);
  }, [filtered]);

  const pick = (broker: string) => {
    onChange(broker);
    setOpen(false);
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
      if (target) pick(target.broker);
    }
  };

  return (
    <div className="relative w-full max-w-[280px]">
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
        className="w-full bg-bg-deep border border-line text-ink px-2.5 py-1 text-xs outline-none focus:border-[#f0b429]"
      />
      {value && (
        <button
          type="button"
          aria-label="清除選擇"
          onMouseDown={(e) => {
            e.preventDefault();
            onChange(null);
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-line-strong text-ink-dim text-xs hover:bg-bear hover:text-bg cursor-pointer flex items-center justify-center"
        >×</button>
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-deep border border-line max-h-[280px] overflow-y-auto">
          {filtered.map((b, i) => (
            <button
              key={b.broker}
              type="button"
              data-testid="broker-search-item"
              onMouseDown={() => pick(b.broker)}
              className={`w-full px-2 py-1.5 grid grid-cols-[1fr_50px_44px_44px] gap-1 text-xs text-left ${
                i === activeIdx
                  ? "bg-line-strong/40 border-l-2 border-[#f0b429]"
                  : "hover:bg-line-strong/20"
              }`}
            >
              <span className="text-ink truncate">
                {highlightMatch(b.broker, debounced)}
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
          ))}
        </div>
      )}
    </div>
  );
}
