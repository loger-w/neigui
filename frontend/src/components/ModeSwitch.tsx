import type { ReactElement } from "react";

export type Mode = "equity" | "options" | "market" | "borrow" | "flows";

interface Props {
  value: Mode;
  onChange: (m: Mode) => void;
}

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "equity",  label: "個股"  },
  { key: "options", label: "選擇權" },
  { key: "market",  label: "大盤"  },
  { key: "borrow",  label: "券差"  },
  // NAV-1(mod/batch-ui-update):分點反查自 equity tab 升格,user 指定排券差旁
  { key: "flows",   label: "分點反查" },
];

export function ModeSwitch({ value, onChange }: Props): ReactElement {
  return (
    <div className="flex" role="tablist">
      {MODES.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => { if (!active) onChange(key); }}
            className={
              `px-5 py-2 pointer-coarse:min-h-11 text-sm transition-colors cursor-pointer ` +
              (active
                ? "text-accent border-b-2 border-accent font-medium"
                : "text-ink-dim hover:text-ink")
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
