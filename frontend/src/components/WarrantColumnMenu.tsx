import { useState } from "react";
import type { ColumnPrefs } from "../lib/warrant-column-prefs";
import { moveColumn, reorderColumn } from "../lib/warrant-column-prefs";
import type { WarrantColumnDef } from "../lib/warrant-columns";
import { Checkbox } from "./ui/checkbox";
import { PopoverPanel } from "./ui/PopoverPanel";

interface Props {
  columns: WarrantColumnDef[];
  prefs: ColumnPrefs;
  onChange: (p: ColumnPrefs) => void;
}

/** 欄位選單:每欄一列 = 拖曳把手 + 顯示勾選 + 欄名 + 一行說明 + 上/下移。
 * 拖曳(HTML5 dnd)與按鈕雙軌 — 觸控/鍵盤靠按鈕;鎖定欄(代號)不可隱藏。 */
export function WarrantColumnMenu({ columns, prefs, onChange }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const hidden = new Set(prefs.hidden);
  const rows = prefs.order
    .map((id) => byId.get(id))
    .filter((c): c is WarrantColumnDef => c != null);

  const toggle = (c: WarrantColumnDef, show: boolean) => {
    onChange({
      ...prefs,
      hidden: show ? prefs.hidden.filter((h) => h !== c.id) : [...prefs.hidden, c.id],
    });
  };

  return (
    <PopoverPanel
      contentTestId="column-menu"
      contentClassName="w-[360px] max-h-[65vh]"
      trigger={
        <button
          type="button"
          data-testid="column-menu-btn"
          aria-label={`欄位設定,目前隱藏 ${prefs.hidden.length} 欄`}
          title="調整欄位順序與顯示;每欄附說明"
          className="px-2 py-1 pointer-coarse:min-h-11 border border-line text-ink-muted hover:text-ink hover:border-accent transition-colors cursor-pointer"
        >
          欄位
          {prefs.hidden.length > 0 && (
            <span className="ml-1 tabular-nums text-ink-dim">−{prefs.hidden.length}</span>
          )}
        </button>
      }
      headerClassName="text-xs text-ink-dim"
      header={<>拖曳或 ▲▼ 調整順序;勾選控制顯示</>}
      footerClassName="justify-end"
      footer={
        <button
          type="button"
          data-testid="column-menu-reset"
          onClick={() => onChange({ order: columns.map((c) => c.id), hidden: [] })}
          className="text-xs text-ink-dim hover:text-ink cursor-pointer"
        >
          恢復預設
        </button>
      }
    >
      {rows.map((c, i) => (
              <div
                key={c.id}
                data-testid="column-menu-row"
                data-column-id={c.id}
                draggable
                onDragStart={() => setDragId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) {
                    onChange({ ...prefs, order: reorderColumn(prefs.order, dragId, c.id) });
                  }
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                className="flex items-center gap-2 px-3 py-1.5 border-b border-line/40 text-xs hover:bg-bg/60"
              >
                <span aria-hidden="true" className="cursor-grab text-ink-dim select-none">
                  ⠿
                </span>
                <Checkbox
                  checked={!hidden.has(c.id)}
                  disabled={c.lockVisible}
                  aria-label={`顯示 ${c.label} 欄`}
                  onCheckedChange={(checked) => toggle(c, checked)}
                />
                <span className="flex-1 min-w-0">
                  <span className="text-ink-muted">{c.label}</span>
                  <span className="block text-ink-dim text-[0.65rem] leading-tight">
                    {c.desc}
                  </span>
                </span>
                <span className="shrink-0 inline-flex flex-col">
                  <button
                    type="button"
                    aria-label={`${c.label} 上移`}
                    disabled={i === 0}
                    onClick={() => onChange({ ...prefs, order: moveColumn(prefs.order, c.id, -1) })}
                    className="px-1 text-ink-dim hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default leading-none"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`${c.label} 下移`}
                    disabled={i === rows.length - 1}
                    onClick={() => onChange({ ...prefs, order: moveColumn(prefs.order, c.id, 1) })}
                    className="px-1 text-ink-dim hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default leading-none"
                  >
                    ▼
                  </button>
                </span>
              </div>
            ))}
    </PopoverPanel>
  );
}
