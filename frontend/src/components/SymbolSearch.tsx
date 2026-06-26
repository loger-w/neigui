import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./ui/input";
import { useAllSymbols } from "@/hooks/useAllSymbols";

interface Props {
  onPick: (symbol: string, name: string | null) => void;
  placeholder?: string;
}

type Sym = { symbol: string; name: string };

export function SymbolSearch({ onPick, placeholder = "搜尋代號或名稱..." }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { symbols, loading, error } = useAllSymbols();

  const results = useMemo<Sym[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Sym[] = [];
    for (const s of symbols) {
      if (s.symbol.startsWith(q) || s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= 20) break;
      }
    }
    return out;
  }, [symbols, query]);

  // Reset highlight when results change so we don't point past the new list.
  useEffect(() => {
    setHighlightIdx(0);
  }, [results]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setOpen(v.trim().length > 0);
  };

  const handlePick = (s: Sym) => {
    setQuery(s.symbol);
    setOpen(false);
    onPick(s.symbol, s.name);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      // Allow Enter when there's exactly one match in `symbols` even without
      // open dropdown — fallback handled by main path below.
      if (e.key === "Enter" && results.length > 0) {
        e.preventDefault();
        const pick = results[Math.min(highlightIdx, results.length - 1)];
        if (pick) handlePick(pick);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx((i) => Math.min(results.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx((i) => Math.max(0, i - 1));
        break;
      case "Enter": {
        e.preventDefault();
        const pick = results[Math.min(highlightIdx, results.length - 1)];
        if (pick) handlePick(pick);
        break;
      }
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      default:
        return;
    }
  };

  const hasQuery = query.trim().length > 0;
  const showLoading = open && loading && hasQuery && results.length === 0;
  const showError = open && !!error && results.length === 0 && hasQuery;
  const showDropdown = open && (results.length > 0 || showLoading || showError);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        className="bg-bg-deep border-line text-ink"
      />
      {showDropdown && (
        <div
          role="listbox"
          className="absolute z-50 top-full left-0 w-full mt-1 bg-bg-deep border border-line max-h-60 overflow-y-auto"
        >
          {showLoading && (
            <div className="px-3 py-2 text-sm text-ink-muted">載入中...</div>
          )}
          {showError && (
            <div className="px-3 py-2 text-sm text-bear">{error}</div>
          )}
          {results.map((r, i) => {
            const active = i === highlightIdx;
            return (
              <button
                key={r.symbol}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={() => handlePick(r)}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 cursor-pointer ${
                  active ? "bg-line-strong/40" : "hover:bg-line-strong/30"
                }`}
              >
                <span className="text-ink font-medium">{r.symbol}</span>
                <span className="text-ink-muted">{r.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
