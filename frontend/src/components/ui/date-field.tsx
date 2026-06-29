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
 * not present in the list is replaced with the latest trading day <= target
 * before being forwarded. When omitted (or empty), onChange is forwarded
 * verbatim — OptionsHeader and other callers stay on the pure-native path
 * (W2 backward-compat).
 */
export type DateFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  ref?: React.Ref<HTMLInputElement>;
  snapToDates?: string[];
};

export function DateField({
  className,
  ref,
  snapToDates,
  onChange,
  ...props
}: DateFieldProps) {
  const shouldWrap = snapToDates !== undefined && snapToDates.length > 0;
  const wrappedOnChange = shouldWrap
    ? (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const snapped = snapToTradingDay(raw, snapToDates!);
        if (snapped === raw) {
          onChange?.(e);
          return;
        }
        const synthetic = {
          ...e,
          target: { ...e.target, value: snapped },
          currentTarget: { ...e.currentTarget, value: snapped },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange?.(synthetic);
      }
    : onChange;

  return (
    <input
      ref={ref}
      type="date"
      onChange={wrappedOnChange}
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
