/**
 * @vitest-environment jsdom
 *
 * F2: bubble-view right-side trade list — sort by 張數 / 價位 via header click;
 * independent state per side; aria-sort reflects current key+dir.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChipBubbleView } from "./ChipBubbleView";
import type { BrokerTrade, ChipBubbleData } from "../lib/chip-data";

afterEach(() => cleanup());

// jsdom lacks ResizeObserver; useContainerSize would otherwise throw on
// observer construction. We give it the minimal shape the hook actually
// calls (constructor + observe + disconnect).
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

const mkTrade = (overrides: Partial<BrokerTrade> = {}): BrokerTrade => ({
  broker: "Broker",
  broker_id: "ID",
  price: 100,
  buy: 10,
  sell: 0,
  ...overrides,
});

function mkData(trades: BrokerTrade[]): ChipBubbleData {
  return {
    symbol: "2330",
    date: "2026-06-25",
    fetched_at: "",
    trades,
  };
}

function findHeaderButton(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const btn = buttons.find((b) => (b.textContent ?? "").startsWith(label));
  if (!btn) throw new Error(`header button not found: ${label}`);
  return btn as HTMLButtonElement;
}

const trades: BrokerTrade[] = [
  mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 10, sell: 30 }),
  mkTrade({ broker: "B", broker_id: "B1", price: 102, buy: 5, sell: 50 }),
  mkTrade({ broker: "C", broker_id: "C1", price: 101, buy: 20, sell: 10 }),
];

describe("ChipBubbleView trade-list sort headers — F2", () => {
  it("default: 張數 header has aria-sort=descending; 價位 = none", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    // Two trade lists (buy/sell). Default: each has 張數=descending, 價位=none.
    const volBtns = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("張數"));
    const priceBtns = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));
    expect(volBtns.length).toBe(2);
    expect(priceBtns.length).toBe(2);
    for (const b of volBtns) {
      expect(b.getAttribute("aria-sort")).toBe("descending");
    }
    for (const b of priceBtns) {
      expect(b.getAttribute("aria-sort")).toBe("none");
    }
  });

  it("clicking 價位 in the buy list: buy 價位 → descending, buy 張數 → none; sell unaffected", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    // The buy list is the first of the two TradeLists in DOM order. We find
    // the first 價位 header (buy side) and click it.
    const priceBtns = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));
    const buyPriceBtn = priceBtns[0]!;
    fireEvent.click(buyPriceBtn);

    const volBtns = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("張數"));
    const priceBtnsAfter = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));
    // Buy side now sorted by price desc, vol none.
    expect(priceBtnsAfter[0]!.getAttribute("aria-sort")).toBe("descending");
    expect(volBtns[0]!.getAttribute("aria-sort")).toBe("none");
    // Sell side untouched.
    expect(priceBtnsAfter[1]!.getAttribute("aria-sort")).toBe("none");
    expect(volBtns[1]!.getAttribute("aria-sort")).toBe("descending");
  });

  it("clicking same header twice toggles desc → asc", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    const priceBtns = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));

    fireEvent.click(priceBtns()[0]!);
    expect(priceBtns()[0]!.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(priceBtns()[0]!);
    expect(priceBtns()[0]!.getAttribute("aria-sort")).toBe("ascending");
  });

  it("switching from 價位 (asc) back to 張數: 張數 resets to descending", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    const priceBtns = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));
    const volBtns = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("張數"));

    // 價位 → desc → asc, then switch to 張數
    fireEvent.click(priceBtns()[0]!);
    fireEvent.click(priceBtns()[0]!);
    fireEvent.click(volBtns()[0]!);
    expect(volBtns()[0]!.getAttribute("aria-sort")).toBe("descending");
    expect(priceBtns()[0]!.getAttribute("aria-sort")).toBe("none");
  });

  it("buy + sell sort state are independent", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    const priceBtns = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));
    const volBtns = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("張數"));

    // Buy: switch to 價位
    fireEvent.click(priceBtns()[0]!);
    // Sell: keep 張數 but toggle to asc
    fireEvent.click(volBtns()[1]!);

    expect(priceBtns()[0]!.getAttribute("aria-sort")).toBe("descending"); // buy
    expect(volBtns()[0]!.getAttribute("aria-sort")).toBe("none");          // buy
    expect(priceBtns()[1]!.getAttribute("aria-sort")).toBe("none");        // sell
    expect(volBtns()[1]!.getAttribute("aria-sort")).toBe("ascending");     // sell
  });

  it("header buttons render arrow indicators that match the dir", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    // Default buy 張數 desc → contains ↓
    const volBtns = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("張數"));
    expect(volBtns[0]!.textContent ?? "").toContain("↓");

    // After switching to 價位 asc, the 價位 header carries ↑
    const priceBtns = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent ?? "").startsWith("價位"));
    fireEvent.click(priceBtns()[0]!);
    fireEvent.click(priceBtns()[0]!);
    expect(priceBtns()[0]!.textContent ?? "").toContain("↑");
  });

  // Verify findHeaderButton helper works.
  it("findHeaderButton: locates 張數 header", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    const btn = findHeaderButton(container, "張數");
    expect(btn).toBeTruthy();
  });
});
