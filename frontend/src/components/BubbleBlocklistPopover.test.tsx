/**
 * @vitest-environment jsdom
 *
 * feat/bubble-streak-screenshot(design §3 R26):泡泡圖多日聚合後,過濾清單
 * popover 的搜尋空態文案不能再綁「當日」— popover 不知道 days,文案必須中性。
 * 痛點:字串目前無測試鎖 → 改文案沒有安全網;這裡把「中性文案」變成合約。
 *
 * Popover 互動樣板同 ChipBubbleView.test.tsx BB-1 節(Radix Portal 掛
 * document.body,開啟後用 document 查)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BubbleBlocklistPopover } from "./BubbleBlocklistPopover";
import type { BrokerTrade } from "../lib/chip-data";

afterEach(() => cleanup());

beforeEach(() => {
  // jsdom 無 ResizeObserver;Radix popper 內部會建構。
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

const trades: BrokerTrade[] = [
  { broker: "Alpha", broker_id: "AL1", price: 100, buy: 10, sell: 0 },
];

function openPopover() {
  const utils = render(
    <BubbleBlocklistPopover
      trades={trades}
      blocked={[]}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onClearAll={vi.fn()}
    />,
  );
  fireEvent.click(
    utils.container.querySelector(
      "[data-testid=bubble-blocklist-trigger]",
    ) as HTMLButtonElement,
  );
  const popover = document.querySelector(
    "[data-testid=bubble-blocklist-popover]",
  ) as HTMLElement | null;
  expect(popover).toBeTruthy();
  const input = popover!.querySelector("input[type=text]") as HTMLInputElement;
  return { ...utils, popover: popover!, input };
}

describe("BubbleBlocklistPopover — 搜尋空態文案", () => {
  it("查無候選 → 顯中性「無符合的分點」,不綁「當日」(多日聚合模式同樣正確)", () => {
    const { popover, input } = openPopover();
    fireEvent.change(input, { target: { value: "ZZZ" } });
    const text = popover.textContent ?? "";
    expect(text.includes("無符合的分點")).toBe(true);
    expect(text.includes("無符合的當日分點")).toBe(false);
  });

  it("有候選時不顯空態文案(空態只在查無結果出現)", () => {
    const { popover, input } = openPopover();
    fireEvent.change(input, { target: { value: "Alpha" } });
    const text = popover.textContent ?? "";
    expect(
      document.querySelector("[data-testid=bubble-blocklist-candidate]"),
    ).toBeTruthy();
    expect(text.includes("無符合的分點")).toBe(false);
  });
});
