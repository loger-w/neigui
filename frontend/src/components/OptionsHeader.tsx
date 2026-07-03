import { useMemo, type ReactElement } from "react";
import { DateField } from "./ui/date-field";
import { listActiveContracts } from "../lib/options-contract";
import type { OptionsSpot } from "../lib/options-types";

interface Props {
  contractId: string;
  onContractChange: (id: string) => void;
  date: string;
  onDateChange: (d: string) => void;
  loading: boolean;
  onRefresh: () => void;
  spot?: OptionsSpot | null;
}

function fmtSpot(spot: OptionsSpot): { val: string; chg: string; chgPct: string } {
  const val = spot.spot != null ? spot.spot.toLocaleString() : "—";
  const chgN = spot.change ?? 0;
  const chg = chgN === 0 ? "0"
    : chgN > 0 ? `+${chgN.toLocaleString()}`
    : `−${Math.abs(chgN).toLocaleString()}`;
  const pctN = spot.change_pct ?? 0;
  const chgPct = pctN === 0 ? "(0.00%)"
    : pctN > 0 ? `(+${pctN.toFixed(2)}%)`
    : `(−${Math.abs(pctN).toFixed(2)}%)`;
  return { val, chg, chgPct };
}

export function OptionsHeader({
  contractId, onContractChange, date, onDateChange, loading, onRefresh, spot,
}: Props): ReactElement {
  const contracts = useMemo(() => listActiveContracts(new Date()), []);
  return (
    <header className="shrink-0 px-6 py-3 border-b border-line flex items-center gap-3">
      <h1 className="text-2xl text-ink font-semibold mr-2">選擇權籌碼</h1>
      <label className="text-sm text-ink-muted flex items-center gap-1.5">
        合約
        <select
          aria-label="選擇合約"
          value={contractId}
          onChange={(e) => onContractChange(e.target.value)}
          className="border border-line text-sm text-ink px-2 py-1 bg-bg cursor-pointer"
        >
          {contracts.map((c) => {
            const id = `${c.optionId}${c.contractDate}`;
            return (
              <option key={id} value={id}>
                {c.label}
              </option>
            );
          })}
        </select>
      </label>
      <DateField
        value={date}
        aria-label="選擇日期"
        onChange={(e) => onDateChange(e.target.value)}
      />
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        aria-busy={loading || undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
      >
        {loading && (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
               className="size-3.5 animate-spin text-accent motion-reduce:animate-none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        重新整理
      </button>
      {spot && spot.spot != null && (() => {
        const f = fmtSpot(spot);
        const chgColor = (spot.change ?? 0) >= 0
          ? "text-[var(--color-up,#dc2626)]"
          : "text-[var(--color-down,#16a34a)]";
        return (
          <div className="ml-auto flex items-baseline gap-1.5">
            <span className="text-[0.625rem] text-ink-dim uppercase tracking-wide">台指期</span>
            <span className="text-[1.125rem] font-semibold text-ink font-variant-numeric tabular-nums">
              {f.val}
            </span>
            <span className={`text-[0.8125rem] font-variant-numeric tabular-nums ${chgColor}`}>
              {f.chg}
            </span>
            <span className={`text-[0.6875rem] font-variant-numeric tabular-nums ${chgColor}`}>
              {f.chgPct}
            </span>
          </div>
        );
      })()}
    </header>
  );
}
