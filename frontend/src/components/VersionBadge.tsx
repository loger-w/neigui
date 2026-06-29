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

const totalUpdates = CHANGELOG.reduce((sum, v) => sum + v.changes.length, 0);

export function VersionBadge(): ReactElement {
  const latest = CHANGELOG[0];

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`版本資訊,目前 v${CURRENT_VERSION}`}
          className="px-2.5 py-1 text-xs text-ink-muted hover:text-accent border border-line hover:border-accent transition-colors cursor-pointer font-mono tabular-nums"
        >
          v{CURRENT_VERSION}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={6}
          align="end"
          aria-labelledby="version-info-title"
          className="z-50 w-[360px] max-h-[60vh] overflow-y-auto bg-bg-deep border border-line shadow-lg flex flex-col"
        >
          <header className="sticky top-0 bg-bg-deep border-b border-line px-3 py-2 flex items-baseline justify-between">
            <h2 id="version-info-title" className="text-sm font-semibold text-ink">版本資訊</h2>
            {latest && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-ink-dim uppercase tracking-wide">最新</span>
                <span className="text-sm font-semibold text-ink font-mono tabular-nums">v{latest.version}</span>
              </div>
            )}
          </header>

          {CHANGELOG.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-dim">無版本紀錄</div>
          ) : (
            <div>
              {CHANGELOG.map((v, idx) => (
                <VersionSection key={v.version} entry={v} isLatest={idx === 0} />
              ))}
            </div>
          )}

          <footer className="sticky bottom-0 bg-bg-deep mt-auto px-3 py-1.5 border-t border-line flex items-center justify-between text-[10px] text-ink-dim tracking-wide">
            <span className="tabular-nums">{`${CHANGELOG.length} 版本 · ${totalUpdates} updates`}</span>
            <span>{DATA_SOURCES.join(" / ")}</span>
          </footer>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function VersionSection({ entry, isLatest }: { entry: VersionEntry; isLatest: boolean }): ReactElement {
  const features = entry.changes.filter((c) => c.kind === "feature");
  const fixes = entry.changes.filter((c) => c.kind === "fix");
  return (
    <section className="px-3 py-2.5 border-b border-line last:border-b-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <span
          className={`text-sm font-semibold font-mono tabular-nums ${isLatest ? "text-ink" : "text-ink-muted"}`}
        >
          v{entry.version}
        </span>
        <span className="text-[10px] text-ink-dim tabular-nums">{entry.date}</span>
      </div>
      {entry.highlights && (
        <p className="text-[11px] text-ink-muted leading-relaxed mb-2">{entry.highlights}</p>
      )}
      {entry.changes.length === 0 ? (
        <p className="text-[11px] text-ink-dim italic">(無條目)</p>
      ) : (
        <>
          {features.length > 0 && <ChangeTable label="Features" items={features} />}
          {fixes.length > 0 && <ChangeTable label="Fixes" items={fixes} className="mt-2" />}
        </>
      )}
    </section>
  );
}

function ChangeTable({
  label,
  items,
  className = "",
}: {
  label: string;
  items: ChangeItem[];
  className?: string;
}): ReactElement {
  return (
    <div className={className}>
      <div className="text-[10px] text-ink-dim uppercase tracking-[0.1em] mb-1">
        {`${label} · ${items.length}`}
      </div>
      <table className="w-full">
        <tbody className="text-[12px]">
          {items.map((it, i) => (
            <tr key={i} className="leading-snug">
              <td
                className={`pr-3 py-0.5 align-top whitespace-nowrap ${scopeColor(it.scope)}`}
                style={{ width: "60px" }}
              >
                {scopeLabel(it.scope)}
              </td>
              <td className="text-ink py-0.5">{it.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scopeLabel(s: ChangeScope): string {
  return s === "equity" ? "個股" : s === "options" ? "選擇權" : "全局";
}

// scope color 僅作視覺區別,不代表市場方向。equity 用 accent(對齊個股 tab
// 色)、options 用 bear(視覺對比 — 不暗示「跌」)、全局用 ink-dim 中性灰。
function scopeColor(s: ChangeScope): string {
  return s === "equity" ? "text-accent" : s === "options" ? "text-bear" : "text-ink-dim";
}
