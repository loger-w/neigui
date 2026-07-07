import type { ReactElement, ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

/** 術語白話解釋的「?」按鈕(options-page-v2 SC-10)。
 * 沿 BubbleHelpButton 的 Popover 樣板 — click 觸發對觸控友善,
 * 不用 hover tooltip。 */
export function OptionsInfoHint({
  label, children,
}: { label: string; children: ReactNode }): ReactElement {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          data-testid="options-info-hint"
          aria-label={label}
          className="shrink-0 inline-flex items-center justify-center w-4 h-4 text-[0.625rem] text-ink-dim hover:text-accent border border-line hover:border-accent cursor-pointer rounded-full leading-none"
        >
          ?
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-testid="options-info-popover"
          sideOffset={6}
          className="z-50 w-[280px] max-w-[calc(100vw-2rem)] bg-bg-deep border border-line-strong shadow-lg rounded p-3 text-xs text-ink-muted leading-relaxed"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
