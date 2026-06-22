import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Project-themed wrapper around the native `<input type="date">`.
 *
 * Keeps the OS calendar picker (no custom popover) for keyboard parity and
 * timezone correctness, but matches the project's `bg-deep` / `line` /
 * `ink` palette. The `.date-field-input` marker class is targeted by an
 * `::-webkit-calendar-picker-indicator` rule in `index.css` to recolor
 * the Chrome/Edge picker glyph; Firefox/Safari fall back to their default
 * glyph (acceptable per spec out-of-scope).
 */
export type DateFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
  function DateField({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="date"
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
  },
);
