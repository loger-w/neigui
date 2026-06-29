import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/** Window N (days). 由 RangeSelector 控制,值範圍 [1, 60] 整數 */
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
 * N 日加總視窗選擇器 (Pattern A — chip-controls-v2)
 *
 * 5 個 preset chip (1/10/20/30/60) + 可編輯數字 input,任意 1-60 整數可直接打字。
 *
 * 互動:
 * - Preset chip click → 立即套用 onChange(n)
 * - Input typing → 即時更新 localStr (input 即時顯示),**不**立即 onChange
 * - Input blur / Enter → parseInt + clamp [1,60] + onChange(clamped)
 * - Wheel(在外層 group)→ onChange(value ± 1),不依賴 browser native step
 * - Input Home / End → 1 / 60 即時 commit
 * - Input ↑↓ → browser native ±1(自然 fire input → onChange handler 更新 localStr)
 *
 * 外部 value 變動同步 localStr:僅在 input 非 focus 時(防 user typing 中被 clobber)。
 *
 * A11y:外層 role="group" + aria-pressed on chips;input native role=spinbutton 自動帶
 * aria-valuemin / max / now(透過 min / max attr + 我們補 aria-valuenow)。
 */
export function RangeSelector({ value, onChange, disabled }: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const safeValue = clampWindow(value);
  const [localStr, setLocalStr] = useState<string>(String(safeValue));

  // Sync external value → localStr only when input is not focused
  // (avoid clobbering user mid-typing)
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setLocalStr(String(safeValue));
  }, [safeValue]);

  const commit = () => {
    const parsed = parseInt(localStr, 10);
    const clamped = Number.isFinite(parsed) ? clampWindow(parsed) : safeValue;
    setLocalStr(String(clamped));
    if (clamped !== safeValue) onChange(clamped);
  };

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setLocalStr(String(WINDOW_DAYS_MIN));
      if (WINDOW_DAYS_MIN !== safeValue) onChange(WINDOW_DAYS_MIN);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setLocalStr(String(WINDOW_DAYS_MAX));
      if (WINDOW_DAYS_MAX !== safeValue) onChange(WINDOW_DAYS_MAX);
      return;
    }
    // ArrowUp / ArrowDown — browser native ±1 on type=number;input fires
    // onChange naturally and our onChange handler picks it up via localStr.
    // ArrowLeft / ArrowRight — native cursor movement inside input text.
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalStr(e.target.value);
    // Native arrow up/down on type=number changes value via 'change' event too;
    // forward only if the new string is a valid clamped int (so native step
    // works in browsers that support it). Typing through digits doesn't
    // commit — only blur / Enter does.
    const parsed = parseInt(e.target.value, 10);
    if (!Number.isFinite(parsed)) return;
    // If this change came from native step (ArrowUp/Down on input), commit
    // immediately so the parent state stays in sync. We detect by checking
    // if the new value differs from current and is within [1,60] integer.
    if (
      e.nativeEvent instanceof InputEvent &&
      (e.nativeEvent as InputEvent).inputType === "insertReplacementText"
    ) {
      const clamped = clampWindow(parsed);
      if (clamped !== safeValue) onChange(clamped);
    }
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
      <input
        ref={inputRef}
        type="number"
        min={WINDOW_DAYS_MIN}
        max={WINDOW_DAYS_MAX}
        step={1}
        inputMode="numeric"
        value={localStr}
        onChange={handleInputChange}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label="自訂 N 日"
        aria-valuemin={WINDOW_DAYS_MIN}
        aria-valuemax={WINDOW_DAYS_MAX}
        aria-valuenow={safeValue}
        title="輸入 1-60 整數,Enter 套用;滾輪 ±1;Home/End = 1/60"
        className={cn(
          "w-14 px-2 py-1.5 text-sm tabular-nums text-center outline-none bg-bg-deep",
          "border-l border-line-strong",
          "focus:bg-accent/[0.04]",
          "focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-inset",
          disabled ? "text-ink-dim cursor-default" : "text-ink-muted cursor-text",
          // hide native browser spinner (we have preset chips + wheel + Home/End)
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
    </div>
  );
}
