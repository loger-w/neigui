import * as React from "react";
import { cn } from "@/lib/utils";
import { snapToTradingDay } from "@/lib/trading-days";

/**
 * Project-themed wrapper around the native `<input type="date">`.
 *
 * Keeps the OS calendar picker (no custom popover) for keyboard parity and
 * timezone correctness, but matches the project's `bg-deep` / `line` /
 * `ink` palette. The `.date-field-input` marker class is targeted by an
 * `::-webkit-calendar-picker-indicator` rule in `index.css` to recolor
 * the Chrome/Edge picker glyph; Firefox/Safari fall back to their default
 * glyph (acceptable per spec out-of-scope).
 *
 * `snapToDates` (optional) — when provided AND non-empty, any onChange value
 * not in the list is replaced with the latest trading day <= target (or the
 * earliest, when target predates the list). The replaced value is written
 * back to the DOM input *in place* so the controlled input never desyncs
 * even when React's Object.is bail-out would skip a re-render.
 *
 * `onValueChange` (optional) — preferred string-only callback for snap-aware
 * callers. Receives the post-snap value directly without wrapping in a
 * SyntheticEvent. Both `onChange` and `onValueChange` fire when present.
 *
 * Pure-native path (W2 OptionsHeader): when both `snapToDates` and
 * `onValueChange` are omitted, the rendered input behaves identically to a
 * raw `<input type="date">` — no event wrapping, no DOM mutation.
 */
export type DateFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  ref?: React.Ref<HTMLInputElement>;
  snapToDates?: string[];
  onValueChange?: (value: string) => void;
};

export function DateField({
  className,
  ref,
  snapToDates,
  onValueChange,
  onChange,
  ...props
}: DateFieldProps) {
  const shouldSnap = snapToDates !== undefined && snapToDates.length > 0;
  const needsWrap = shouldSnap || onValueChange !== undefined;
  const handleChange = needsWrap
    ? (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const finalValue = shouldSnap ? snapToTradingDay(raw, snapToDates!) : raw;
        if (shouldSnap && finalValue !== raw) {
          // In-place DOM mutation: React diff would otherwise bail out when
          // the new state equals the prior controlled value (e.g. Saturday →
          // snap-to-Friday when the state was already Friday) and the DOM
          // would stay on the user-typed Saturday.
          e.target.value = finalValue;
        }
        onValueChange?.(finalValue);
        onChange?.(e);
      }
    : onChange;

  return (
    <input
      ref={ref}
      type="date"
      onChange={handleChange}
      className={cn(
        "date-field-input",
        "h-8 px-2.5",
        "bg-bg-deep border border-line text-ink text-sm",
        "tabular-nums rounded-sm",
        "outline-none transition-colors",
        "hover:border-line-strong focus:border-accent",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}
