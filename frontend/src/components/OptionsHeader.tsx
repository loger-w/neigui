import { useMemo, type ReactElement } from "react";
import { DateField } from "./ui/date-field";
import { listActiveContracts } from "../lib/options-contract";

interface Props {
  contractId: string;
  onContractChange: (id: string) => void;
  date: string;
  onDateChange: (d: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function OptionsHeader({
  contractId, onContractChange, date, onDateChange, loading, onRefresh,
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
    </header>
  );
}
