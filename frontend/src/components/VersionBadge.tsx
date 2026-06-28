import type { ReactElement } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  CHANGELOG,
  CURRENT_VERSION,
  DATA_SOURCES,
  type ChangeItem,
  type ChangeScope,
  type VersionEntry,
} from "../lib/changelog";

export function VersionBadge(): ReactElement {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`版本資訊,目前 v${CURRENT_VERSION}`}
          className="px-2 py-1 text-xs text-ink-muted hover:text-accent border border-line hover:border-accent transition-colors cursor-pointer tabular-nums"
        >
          v{CURRENT_VERSION}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={6}
          align="end"
          className="z-50 w-[360px] max-h-[60vh] overflow-y-auto bg-bg-deep border border-line shadow-lg"
        >
          <header className="sticky top-0 bg-bg-deep border-b border-line px-3 py-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">版本資訊</h2>
            <span className="text-[10px] text-ink-dim uppercase tracking-wide">
              {`資料來源: ${DATA_SOURCES.join(" / ")}`}
            </span>
          </header>
          <ul className="divide-y divide-line">
            {CHANGELOG.length === 0 ? (
              <li className="px-3 py-4 text-sm text-ink-dim">無版本紀錄</li>
            ) : (
              CHANGELOG.map((v) => <VersionEntryItem key={v.version} entry={v} />)
            )}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function VersionEntryItem({ entry }: { entry: VersionEntry }): ReactElement {
  const features = entry.changes.filter((c) => c.kind === "feature");
  const fixes = entry.changes.filter((c) => c.kind === "fix");
  return (
    <li className="px-3 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-ink tabular-nums">v{entry.version}</span>
        <span className="text-xs text-ink-dim tabular-nums">{entry.date}</span>
      </div>
      {entry.highlights && (
        <p className="mt-1 text-xs text-ink-muted">{entry.highlights}</p>
      )}
      {entry.changes.length === 0 ? (
        <p className="mt-2 text-xs text-ink-dim">(無條目)</p>
      ) : (
        <>
          {features.length > 0 && <Section label="新增功能" items={features} />}
          {fixes.length > 0 && <Section label="修正" items={fixes} />}
        </>
      )}
    </li>
  );
}

function Section({ label, items }: { label: string; items: ChangeItem[] }): ReactElement {
  return (
    <div className="mt-2">
      <div className="text-[10px] text-ink-dim uppercase tracking-wide">{label}</div>
      <ul className="mt-0.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-ink-muted">
            <span className="mr-1 px-1 text-[10px] border border-line text-ink-dim">
              {scopeLabel(it.scope)}
            </span>
            {it.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function scopeLabel(s: ChangeScope): string {
  return s === "equity" ? "個股" : s === "options" ? "選擇權" : "全局";
}
