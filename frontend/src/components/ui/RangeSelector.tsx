import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";

/** Window N (days). 由 RangeSelector 控制,值範圍 [10, 60] 整數 */
export type WindowDays = number;
/** Backward-compat alias — App.tsx 仍從這個檔 import RangeDays */
export type RangeDays = WindowDays;

export const WINDOW_DAYS_MIN: WindowDays = 1;
export const WINDOW_DAYS_MAX: WindowDays = 60;
export const WINDOW_DAYS_PRESETS: readonly WindowDays[] = [1, 10, 20, 30, 60] as const;
/** Backward-compat alias */
export const RANGE_DAYS_OPTIONS = WINDOW_DAYS_PRESETS;

interface Props {
  value: WindowDays;
  onChange: (value: WindowDays) => void;
  disabled?: boolean;
}

function clampWindow(n: number): WindowDays {
  if (!Number.isFinite(n)) return WINDOW_DAYS_MIN;
  if (n < WINDOW_DAYS_MIN) return WINDOW_DAYS_MIN;
  if (n > WINDOW_DAYS_MAX) return WINDOW_DAYS_MAX;
  return Math.round(n);
}

/**
 * N 日加總視窗選擇器 — 4 個 preset(10/20/30/60)+ 滾輪細調 [10, 60] 任意整數。
 *
 * 互動:
 * - Click preset → onChange(n)
 * - Wheel deltaY > 0 → onChange(value - 1);< 0 → onChange(value + 1)。clamp [10, 60]。
 *   wheel listener 用 addEventListener({passive: false}) 註冊,讓 preventDefault 真的能擋頁面捲動。
 * - 鍵盤:← / ↓ ±1、→ / ↑ ±1、Home → 10、End → 60(focused on the value badge)
 *
 * A11y(spinbutton pattern):值徽章 `role="spinbutton"` + `aria-valuemin/max/now`,
 * 給螢幕閱讀器讀出當前 N。Preset buttons 一般 `<button>`,加 `aria-pressed` 反映 active。
 */
export function RangeSelector({ value, onChange, disabled }: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const spinRef = useRef<HTMLSpanElement>(null);
  const safeValue = clampWindow(value);

  useEffect(() => {
    const el = groupRef.current;
    if (!el || disabled) return;
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      onChange(clampWindow(safeValue + delta));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [safeValue, onChange, disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    let next: WindowDays | null = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = clampWindow(safeValue - 1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = clampWindow(safeValue + 1);
        break;
      case "Home":
        next = WINDOW_DAYS_MIN;
        break;
      case "End":
        next = WINDOW_DAYS_MAX;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== safeValue) onChange(next);
  };

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="N 日加總視窗"
      className={cn(
        "inline-flex items-stretch border border-line-strong",
        disabled && "opacity-50",
      )}
    >
      {WINDOW_DAYS_PRESETS.map((n) => {
        const active = n === safeValue;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={active}
            aria-label={`設為 ${n} 日`}
            disabled={disabled}
            onClick={() => !disabled && onChange(n)}
            className={cn(
              "px-3 py-1.5 text-sm border-r border-line-strong transition-colors",
              active
                ? "text-ink border-accent bg-accent/[0.08]"
                : "text-ink-dim hover:text-ink",
              disabled ? "cursor-default" : "cursor-pointer",
            )}
          >
            {n}
          </button>
        );
      })}
      <span
        ref={spinRef}
        role="spinbutton"
        aria-label="當前視窗天數"
        aria-valuemin={WINDOW_DAYS_MIN}
        aria-valuemax={WINDOW_DAYS_MAX}
        aria-valuenow={safeValue}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        className={cn(
          "px-3 py-1.5 text-sm tabular-nums select-none outline-none",
          "focus-visible:bg-accent/[0.08] focus-visible:text-ink",
          disabled ? "text-ink-dim cursor-default" : "text-ink-muted cursor-ns-resize",
        )}
        title="滾輪 / 方向鍵調整(10–60)"
      >
        {safeValue} 日
      </span>
    </div>
  );
}
