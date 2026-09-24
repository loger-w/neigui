import * as React from "react";
import { cn } from "@/lib/utils";
import { snapToTradingDay } from "@/lib/trading-days";

/**
 * Project-themed wrapper around the native `<input type="date">`.
 *
 * Keeps the OS calendar picker (no custom popover) for keyboard parity and
 * timezone correctness, but matches the project's `bg-deep` / `line` /
 * `ink` palette. The native calendar popup is drawn dark because `index.css`
 * declares `color-scheme: dark` on `:root` (inherited here). The
 * `.date-field-input` marker class is targeted by an
 * `::-webkit-calendar-picker-indicator` rule to recolor the Chrome/Edge
 * picker glyph; Firefox/Safari don't support that pseudo-element and draw
 * their own glyph, which follows the dark scheme (light icon on dark field).
 * The focused-segment highlight and the popup's selected day are drawn by the
 * browser and cannot be restyled by author CSS.
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
 * Committable guard (wrapped path only, fix/date-field-partial-input): the
 * native input emits empty values (clear button / Backspace) and half-typed
 * years (0002-/0020-/0202-…) while the user edits segment by segment. Only a
 * complete `YYYY-MM-DD` within [`min` ?? 2000-01-01, `max`] is snapped and
 * reported via `onValueChange`; anything else is kept as an internal draft so
 * the field keeps showing what the user is typing (a controlled input would
 * otherwise be reset to `value`, making the year segment untypeable), and the
 * draft is dropped on blur. `onChange` still receives every raw event.
 *
 * Pure-native path: when both `snapToDates` and `onValueChange` are omitted,
 * the rendered input behaves identically to a raw `<input type="date">` — no
 * event wrapping, no DOM mutation, no guard (callers such as
 * BrokerFlowsPanel run their own draft guard on top of it).
 */
export type DateFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  ref?: React.Ref<HTMLInputElement>;
  snapToDates?: string[];
  onValueChange?: (value: string) => void;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MIN = "2000-01-01";

function isCommittableDate(raw: string, min?: string, max?: string): boolean {
  return DATE_RE.test(raw) && raw >= (min || DEFAULT_MIN) && (!max || raw <= max);
}

export function DateField({
  className,
  ref,
  snapToDates,
  onValueChange,
  onChange,
  onBlur,
  value,
  ...props
}: DateFieldProps) {
  const shouldSnap = snapToDates !== undefined && snapToDates.length > 0;
  const needsWrap = shouldSnap || onValueChange !== undefined;
  // 輸入中的不完整值(null = 無草稿,顯示已提交的 value)
  const [draft, setDraft] = React.useState<string | null>(null);
  // 外部改了 value(如個股頁 K 線回來後自動對齊日期)→ 外部值優先,丟草稿
  React.useEffect(() => {
    setDraft(null);
  }, [value]);
  const handleChange = needsWrap
    ? (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (!isCommittableDate(raw, toStr(props.min), toStr(props.max))) {
          setDraft(raw);
          onChange?.(e);
          return;
        }
        setDraft(null);
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
  const handleBlur = needsWrap
    ? (e: React.FocusEvent<HTMLInputElement>) => {
        setDraft(null);
        onBlur?.(e);
      }
    : onBlur;

  return (
    <input
      ref={ref}
      type="date"
      value={needsWrap && draft !== null ? draft : value}
      onChange={handleChange}
      onBlur={handleBlur}
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

function toStr(v: string | number | undefined): string | undefined {
  return v === undefined ? undefined : String(v);
}
