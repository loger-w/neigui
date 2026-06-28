import type { ReactElement } from "react";

export type Mode = "equity" | "options";

interface Props {
  value: Mode;
  onChange: (m: Mode) => void;
}

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "equity",  label: "個股"  },
  { key: "options", label: "選擇權" },
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
              `px-5 py-2 text-sm transition-colors cursor-pointer ` +
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
