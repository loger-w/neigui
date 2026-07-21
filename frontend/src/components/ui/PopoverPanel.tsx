import type { ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

interface Props {
  /** Trigger 元素(asChild,需可接受 ref 的 button)。 */
  trigger: ReactNode;
  contentTestId?: string;
  /** 每實例的寬度 / 高度上限(如 "w-[320px] max-h-[60vh]")。 */
  contentClassName?: string;
  header?: ReactNode;
  headerClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
  /** 中段滾動列表內容。 */
  children: ReactNode;
  listTestId?: string;
}

/** Popover 面板骨架(第 3 份實例觸發抽共用,next-time 2026-07-15 條目):
 * Root + Trigger(asChild) + Portal + Content + header / scroll 列表 / footer。
 * header、footer 內容與每實例尺寸由 caller 提供;結構與 z-index / 邊框樣式集中此處。 */
export function PopoverPanel({
  trigger,
  contentTestId,
  contentClassName,
  header,
  headerClassName,
  footer,
  footerClassName,
  children,
  listTestId,
}: Props) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-testid={contentTestId}
          sideOffset={6}
          align="start"
          className={cn(
            "z-50 max-w-[calc(100vw-2rem)] bg-bg-deep border border-line-strong shadow-lg flex flex-col rounded",
            contentClassName,
          )}
        >
          {header != null && (
            <div className={cn("px-3 py-2 border-b border-line", headerClassName)}>{header}</div>
          )}
          <div
            data-testid={listTestId}
            className="flex-1 min-h-0 overflow-y-auto scroll-editorial"
          >
            {children}
          </div>
          {footer != null && (
            <div className={cn("px-3 py-2 border-t border-line flex items-center", footerClassName)}>
              {footer}
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
