import { useCallback, useRef, useState } from "react";
import { Input } from "./ui/input";
import { api } from "@/lib/api";

interface Props {
  onPick: (symbol: string, name: string | null) => void;
  placeholder?: string;
}

export function SymbolSearch({ onPick, placeholder = "搜尋代號或名稱..." }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ symbol: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api.symbols(q.trim());
        setResults(r);
        setOpen(r.length > 0);
      } catch {
        setResults([]);
      }
    }, 200);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    search(v);
  };

  const handlePick = (s: { symbol: string; name: string }) => {
    setQuery(s.symbol);
    setOpen(false);
    onPick(s.symbol, s.name);
  };

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="bg-bg-deep border-line text-ink"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 w-full mt-1 bg-bg-deep border border-line max-h-60 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.symbol}
              type="button"
              onMouseDown={() => handlePick(r)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-line-strong/30 flex items-center gap-2 cursor-pointer"
            >
              <span className="text-ink font-medium">{r.symbol}</span>
              <span className="text-ink-muted">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
