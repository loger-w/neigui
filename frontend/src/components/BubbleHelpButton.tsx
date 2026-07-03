import { Popover as PopoverPrimitive } from "radix-ui";

export function BubbleHelpButton() {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          data-testid="bubble-help-trigger"
          aria-label="泡泡圖使用說明"
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 text-xs text-ink-dim hover:text-accent border border-line hover:border-accent cursor-pointer rounded-full leading-none"
        >
          ?
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-testid="bubble-help-popover"
          sideOffset={6}
          align="end"
          className="z-50 w-[320px] max-w-[calc(100vw-2rem)] bg-bg-deep border border-line-strong shadow-lg rounded p-3 text-xs text-ink-muted"
        >
          <div className="text-ink font-medium mb-2">泡泡圖操作說明</div>
          <ul className="space-y-1.5 leading-relaxed">
            <li>
              <span className="text-accent">•</span> 左右 <span className="text-ink">泡泡</span> 代表買 / 賣,泡泡大小 = 該分點在該價位的成交張數
            </li>
            <li>
              <span className="text-accent">•</span> <span className="text-ink">點泡泡</span>:只顯示該分點的成交點
            </li>
            <li>
              <span className="text-accent">•</span> 拖曳左側 <span className="text-ink">Y 軸(價位軸)</span>:選取價位區間,只顯示區間內的泡泡
            </li>
            <li>
              <span className="text-accent">•</span> 或按 <span className="text-ink">輸入區間</span> 手動指定買賣價位
            </li>
            <li>
              <span className="text-accent">•</span> 區間彈出的 <span className="text-ink">「篩選這 N 個分點」</span> 可一鍵跳籌碼總覽
            </li>
            <li>
              <span className="text-accent">•</span> 按 <span className="text-ink">Esc</span> 或點空白處:清除選取 / 區間
            </li>
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
