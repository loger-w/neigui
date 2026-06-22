import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";
import { Input } from "./ui/input";
import { api } from "@/lib/api";
export function SymbolSearch({ onPick, placeholder = "搜尋代號或名稱..." }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const timerRef = useRef(null);
    const search = useCallback((q) => {
        if (timerRef.current)
            clearTimeout(timerRef.current);
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
            }
            catch {
                setResults([]);
            }
        }, 200);
    }, []);
    const handleChange = (e) => {
        const v = e.target.value;
        setQuery(v);
        search(v);
    };
    const handlePick = (s) => {
        setQuery(s.symbol);
        setOpen(false);
        onPick(s.symbol, s.name);
    };
    return (_jsxs("div", { className: "relative", children: [_jsx(Input, { value: query, onChange: handleChange, onFocus: () => results.length > 0 && setOpen(true), onBlur: () => setTimeout(() => setOpen(false), 150), placeholder: placeholder, className: "bg-bg-deep border-line text-ink" }), open && (_jsx("div", { className: "absolute z-50 top-full left-0 w-full mt-1 bg-bg-deep border border-line max-h-60 overflow-y-auto", children: results.map((r) => (_jsxs("button", { type: "button", onMouseDown: () => handlePick(r), className: "w-full px-3 py-2 text-left text-sm hover:bg-line-strong/30 flex items-center gap-2 cursor-pointer", children: [_jsx("span", { className: "text-ink font-medium", children: r.symbol }), _jsx("span", { className: "text-ink-muted", children: r.name })] }, r.symbol))) }))] }));
}
