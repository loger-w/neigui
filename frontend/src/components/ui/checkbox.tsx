import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Project-themed checkbox. Native `<input type=checkbox>` is visually hidden
 * (sr-only) but remains the source of truth for focus, keyboard, and
 * accessibility; the styled `<span>` sibling is the visible affordance.
 *
 * Color: purple `#b794f4` fill when checked (matches the selected-broker
 * pill accent in ChipBrokersPanel). Focus-visible ring uses the project's
 * `accent` token at 40% opacity.
 */
export interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "size" | "onChange"
  > {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { checked, onCheckedChange, onChange, className, disabled, ...props },
    ref,
  ) {
    return (
      <label
        className={cn(
          // `relative` makes the label the containing block for the sr-only
          // input below; otherwise position:absolute walks up to <body>, the
          // input's static-flow position spills past the viewport, and
          // html.scrollHeight grows enough to spawn an outer scrollbar on the
          // 籌碼總覽 panel.
          "relative inline-flex items-center cursor-pointer select-none",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            // Guard against jsdom-style event firing on disabled inputs.
            if (disabled) return;
            onChange?.(e);
            onCheckedChange?.(e.target.checked);
          }}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex items-center justify-center",
            "w-3.5 h-3.5 rounded-sm",
            "border border-line bg-bg-deep",
            "transition-colors",
            "hover:border-line-strong",
            "peer-checked:bg-[#b794f4] peer-checked:border-[#b794f4]",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40",
            "peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg",
          )}
        >
          {checked && (
            <svg
              viewBox="0 0 16 16"
              className="w-3 h-3"
              fill="none"
              stroke="#fff"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3,8 7,12 13,4" />
            </svg>
          )}
        </span>
      </label>
    );
  },
);
