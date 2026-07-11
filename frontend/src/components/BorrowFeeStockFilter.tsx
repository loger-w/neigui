import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Input } from "./ui/input";
import { matchStockOptions, type StockOption } from "../lib/borrow-fee-utils";

interface Props {
  options: StockOption[];
  selected: StockOption | null;
  onSelect: (option: StockOption) => void;
  onClear: () => void;
}

// 券差當日單檔篩選 combobox(SymbolSearch pattern)。候選 = 當日有列入
// 券差的標的;空 query focus 即列全集(名單短,靠 max-h 捲動)。
// 選定態下任何輸入編輯即解除 selection(輸入 = 重新搜尋;change-spec R3)。
export function BorrowFeeStockFilter({
  options,
  selected,
  onSelect,
  onClear,
}: Props): ReactElement {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 選定態輸入框顯示「代號 名稱」;query 僅在未選定時作為搜尋字串。
  useEffect(() => {
    if (selected) setQuery(`${selected.stock_id} ${selected.name}`);
  }, [selected]);

  const results = useMemo(
    () => matchStockOptions(options, selected ? "" : query),
    [options, selected, query],
  );

  useEffect(() => {
    setHighlightIdx(0);
  }, [results]);

  const handlePick = (o: StockOption) => {
    setOpen(false);
    setQuery(`${o.stock_id} ${o.name}`);
    onSelect(o);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selected) onClear();
    setQuery(e.target.value);
    setOpen(true);
  };

  const handleClear = () => {
    setQuery("");
    setOpen(false);
    onClear();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
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
      default:
        return;
    }
  };

  const hasQuery = !selected && query.trim().length > 0;
  const showNoMatch = open && hasQuery && results.length === 0;
  const showDropdown = open && (results.length > 0 || showNoMatch);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder="輸入代號或從當日名單挑選"
        aria-label="標的篩選"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        data-testid="borrow-fee-stock-filter"
        className={`bg-bg-deep border-line text-ink ${selected ? "pr-8" : ""}`}
      />
      {selected && (
        <button
          type="button"
          data-testid="stock-filter-clear"
          aria-label="清除標的篩選"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-dim hover:text-ink cursor-pointer"
        >
          ×
        </button>
      )}
      {showDropdown && (
        <div
          role="listbox"
          className="absolute z-50 top-full left-0 w-full mt-1 bg-bg-deep border border-line max-h-60 overflow-y-auto"
        >
          {showNoMatch && (
            <div className="px-3 py-2 text-sm text-ink-muted">該檔今日未列入券差</div>
          )}
          {results.map((o, i) => {
            const active = i === highlightIdx;
            return (
              <button
                key={o.stock_id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={() => handlePick(o)}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 cursor-pointer ${
                  active ? "bg-line-strong/40" : "hover:bg-line-strong/30"
                }`}
              >
                <span className="text-ink font-medium">{o.stock_id}</span>
                <span className="text-ink-muted flex-1 truncate">{o.name}</span>
                <span className="px-1.5 py-0.5 text-xs border border-line text-ink-dim shrink-0">
                  {o.market === "twse" ? "上市" : "上櫃"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
