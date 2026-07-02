/**
 * @vitest-environment jsdom
 *
 * F2: bubble-view right-side trade list — sort by 張數 / 價位 via header click;
 * independent state per side; aria-sort reflects current key+dir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChipBubbleView } from "./ChipBubbleView";
import type { BrokerTrade, ChipBubbleData } from "../lib/chip-data";

// C7 A1 test 需要 BubbleChartSvg 真正 render(Y-axis brush overlay 從裡面出)。
// jsdom 沒 layout → useContainerSize 回 {0,0} → svg gate 掉。mock 讓 A1 tests
// 能 exercise brush 路徑。既有 F2 sort header tests 不依賴 svg render,不受影響。
vi.mock("../hooks/useContainerSize", () => ({
  useContainerSize: () => ({ width: 400, height: 300 }),
}));

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

// Select a broker via BrokerSearch input (TradeList rows are virtualized and
// bubble SVG requires size, both no-op in jsdom). BrokerSearch input +
// mousedown-select the dropdown item is the deterministic path.
async function selectBrokerViaSearch(brokerName: string) {
  const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: brokerName } });
  await waitFor(() => {
    const items = screen.queryAllByTestId("broker-search-item");
    const match = items.find((el) => (el.textContent ?? "").includes(brokerName));
    if (!match) throw new Error(`dropdown item for ${brokerName} not visible yet`);
  });
  const items = screen.getAllByTestId("broker-search-item");
  const target = items.find((el) => (el.textContent ?? "").includes(brokerName))!;
  fireEvent.mouseDown(target);
}

// Distinct broker names — avoid single-letter substring ambiguity in BrokerSearch
// (case-insensitive .includes() would treat "A" as substring of "Alpha").
const namedTrades: BrokerTrade[] = [
  { broker: "Alpha", broker_id: "AL1", price: 100, buy: 10, sell: 30 },
  { broker: "Bravo", broker_id: "BR1", price: 102, buy: 5, sell: 50 },
  { broker: "Charlie", broker_id: "CH1", price: 101, buy: 20, sell: 10 },
];

describe("ChipBubbleView — A2 jump-to-overview button (C2 🔴)", () => {
  it("no selection: shows '今日共 N 個分點' text, no jump button", () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={vi.fn()}
      />,
    );
    expect((container.textContent ?? "").includes("今日共")).toBe(true);
    expect(container.querySelector('[data-testid="bubble-jump-to-overview"]')).toBeNull();
  });

  it("selected broker + onJumpToOverview: button appears with broker name", async () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={vi.fn()}
      />,
    );
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => {
      const btn = container.querySelector('[data-testid="bubble-jump-to-overview"]');
      if (!btn) throw new Error("jump button not rendered yet");
    });
    const btn = container.querySelector('[data-testid="bubble-jump-to-overview"]') as HTMLButtonElement;
    expect((btn.textContent ?? "").includes("Alpha")).toBe(true);
    expect((btn.textContent ?? "").includes("籌碼總覽")).toBe(true);
  });

  it("clicking the jump button calls onJumpToOverview with broker_id (not name)", async () => {
    const onJump = vi.fn();
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={onJump}
      />,
    );
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => {
      const btn = container.querySelector('[data-testid="bubble-jump-to-overview"]');
      if (!btn) throw new Error("jump button not rendered yet");
    });
    const btn = container.querySelector('[data-testid="bubble-jump-to-overview"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onJump).toHaveBeenCalledWith("AL1"); // broker_id, not "Alpha"
  });

  it("selected broker + NO onJumpToOverview prop: fallback to '已篩選 1 個分點' text", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => {
      if (!(container.textContent ?? "").includes("已篩選")) {
        throw new Error("fallback text not shown yet");
      }
    });
    expect(container.querySelector('[data-testid="bubble-jump-to-overview"]')).toBeNull();
  });
});

// A5 (C5 🟢): 搜尋後 fetch 期間顯 loading badge,對齊 ChipKlineChart pattern。
// 未搜尋狀態(symbol 空 + bubbleData 空)顯原有的搜尋提示;
// 搜尋後 fetch 中(loading=true + bubbleData null)顯 badge;
// 搜尋後 fetch 完(bubbleData 有)顯 chart(loading=true 疊 overlay)。
describe("ChipBubbleView — A5 loading badge (C5 🟢)", () => {
  it("loading=false + bubbleData=null:顯搜尋提示,不顯 badge", () => {
    const { container } = render(
      <ChipBubbleView symbol="" bubbleData={null} />,
    );
    expect((container.textContent ?? "").includes("請搜尋股票代號")).toBe(true);
    expect(container.querySelector('[data-testid="bubble-loading-badge"]')).toBeNull();
  });

  it("loading=true + bubbleData=null + symbol=2330:顯 badge '載入 2330 泡泡圖中…',不顯搜尋提示", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={null} loading={true} />,
    );
    const badge = container.querySelector('[data-testid="bubble-loading-badge"]');
    expect(badge).toBeTruthy();
    expect((badge!.textContent ?? "").includes("載入 2330")).toBe(true);
    expect((badge!.textContent ?? "").includes("泡泡圖")).toBe(true);
    expect((container.textContent ?? "").includes("請搜尋股票代號")).toBe(false);
  });

  it("loading=true + bubbleData 已存在:badge 疊在 chart 上", () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        loading={true}
      />,
    );
    const badge = container.querySelector('[data-testid="bubble-loading-badge"]');
    expect(badge).toBeTruthy();
    // Empty state 不該同時出現
    expect((container.textContent ?? "").includes("請搜尋股票代號")).toBe(false);
  });
});

// A3 (C6 🟢): 選單一分點時顯示總買/賣張/金額。
describe("ChipBubbleView — A3 分點總買/賣張/金額 (C6 🟢)", () => {
  it("未選 broker:不顯示 totals 區塊", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    expect(container.querySelector('[data-testid="bubble-broker-totals"]')).toBeNull();
  });

  it("選中 broker:顯示買張/賣張/買額/賣額,金額用 fmtAmount 格式", async () => {
    // Alpha: buy=10 sell=30 price=100 → buyLots=10 sellLots=30
    //        buyAmount=10*1000*100=1,000,000 → "100 萬"
    //        sellAmount=30*1000*100=3,000,000 → "300 萬"
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => {
      const totals = container.querySelector('[data-testid="bubble-broker-totals"]');
      if (!totals) throw new Error("totals not rendered yet");
    });
    const totals = container.querySelector('[data-testid="bubble-broker-totals"]') as HTMLElement;
    const text = totals.textContent ?? "";
    expect(text.includes("10")).toBe(true);       // buy lots
    expect(text.includes("30")).toBe(true);       // sell lots
    expect(text.includes("100 萬")).toBe(true);    // buyAmount
    expect(text.includes("300 萬")).toBe(true);    // sellAmount
  });
});

// A1 (C7 🟢): Y-axis brush 端到端流程(ChipBubbleView 整合 svg + summary panel)。
// hasPointerCapture 也 stub 對齊 handleBrushUp §E-compliant guard 邏輯。
function stubPointerCaptureOn(el: Element) {
  const anyEl = el as unknown as {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    hasPointerCapture?: (id: number) => boolean;
    _capturedPointers?: Set<number>;
  };
  if (typeof anyEl.setPointerCapture !== "function") {
    anyEl._capturedPointers = new Set<number>();
    anyEl.setPointerCapture = (id: number) => { anyEl._capturedPointers!.add(id); };
    anyEl.releasePointerCapture = (id: number) => { anyEl._capturedPointers!.delete(id); };
    anyEl.hasPointerCapture = (id: number) => anyEl._capturedPointers!.has(id);
  }
}

async function triggerBrush(container: HTMLElement) {
  const overlay = await waitFor(() => {
    const el = container.querySelector("[data-testid=bubble-yaxis-brush]") as SVGRectElement | null;
    if (!el) throw new Error("brush overlay not rendered");
    return el;
  });
  stubPointerCaptureOn(overlay);
  fireEvent.pointerDown(overlay, { clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(overlay, { clientY: 200, pointerId: 1 });
  fireEvent.pointerUp(overlay, { clientY: 200, pointerId: 1 });
}

describe("ChipBubbleView — A1 Y-axis brush integration (C7 🟢)", () => {
  it("brush drag 完成 → summary panel 出現", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await triggerBrush(container);
    await waitFor(() => {
      if (!container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary not shown yet");
      }
    });
  });

  it("summary panel 內「篩選這 N 個分點」button → onJumpToOverview 收 brokerIds array", async () => {
    const onJump = vi.fn();
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={onJump}
      />,
    );
    await triggerBrush(container);
    const applyBtn = await waitFor(() => {
      const el = container.querySelector('[data-testid="brush-apply-filter"]') as HTMLButtonElement | null;
      if (!el) throw new Error("apply button not visible");
      return el;
    });
    fireEvent.click(applyBtn);
    expect(onJump).toHaveBeenCalledTimes(1);
    const arg = onJump.mock.calls[0]![0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it("summary panel 「清除」button → summary 消失", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await triggerBrush(container);
    const clearBtn = await waitFor(() => {
      const el = container.querySelector('[data-testid="brush-clear"]') as HTMLButtonElement | null;
      if (!el) throw new Error("clear button not visible");
      return el;
    });
    fireEvent.click(clearBtn);
    await waitFor(() => {
      if (container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary still visible");
      }
    });
  });

  it("ESC 鍵 → summary 消失", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await triggerBrush(container);
    await waitFor(() => {
      if (!container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary not visible pre-ESC");
      }
    });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      if (container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary still visible after ESC");
      }
    });
  });

  it("點空白處(main overlay click)→ summary + selection 一起消失(SC-A1c)", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    // 先建立 brush + selection 兩個狀態
    await selectBrokerViaSearch("Alpha");
    await triggerBrush(container);
    await waitFor(() => {
      if (!container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary not visible pre-blank-click");
      }
    });
    // 點空白處觸發 handleBubbleClick(null) — hitTest 在 jsdom 找不到 bubble
    // 回 null,handleClick 呼叫 onBubbleClick(null),ChipBubbleView 清 selection
    // 與 brush。
    const mainOverlay = container.querySelector('[data-testid="bubble-main-overlay"]') as SVGRectElement | null;
    expect(mainOverlay).toBeTruthy();
    fireEvent.click(mainOverlay!);
    await waitFor(() => {
      if (container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary still visible after blank click");
      }
    });
    // Selection 也一起清:jump-to-overview button 應消失(未選狀態下沒有)
    expect(container.querySelector('[data-testid="bubble-jump-to-overview"]')).toBeNull();
  });

  it("symbol 變更 → brush range 一併清空", async () => {
    const { container, rerender } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await triggerBrush(container);
    await waitFor(() => {
      if (!container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary not visible pre-symbol-change");
      }
    });
    rerender(<ChipBubbleView symbol="2454" bubbleData={mkData(namedTrades)} />);
    await waitFor(() => {
      if (container.querySelector('[data-testid="brush-summary"]')) {
        throw new Error("summary still visible after symbol change");
      }
    });
  });
});

// C10 (🟢 Item 4): 手動輸入價位區間 mini form。
describe("ChipBubbleView — C10 手動輸入區間 (🟢 Item 4)", () => {
  it("header 有「輸入區間」trigger,點擊後 panel 出現", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    const trigger = container.querySelector(
      "[data-testid=bubble-manual-range-trigger]",
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    expect(
      container.querySelector("[data-testid=manual-range-panel]"),
    ).toBeTruthy();
  });

  it("輸入合法 min/max + 套用 → brushRange 被設定(brush-summary 出現)", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=bubble-manual-range-trigger]",
      ) as HTMLButtonElement,
    );
    const minInput = container.querySelector(
      "[data-testid=manual-range-min]",
    ) as HTMLInputElement;
    const maxInput = container.querySelector(
      "[data-testid=manual-range-max]",
    ) as HTMLInputElement;
    fireEvent.change(minInput, { target: { value: "100" } });
    fireEvent.change(maxInput, { target: { value: "102" } });
    const applyBtn = container.querySelector(
      "[data-testid=manual-range-apply]",
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    fireEvent.click(applyBtn);
    await waitFor(() => {
      if (!container.querySelector("[data-testid=brush-summary]")) {
        throw new Error("brush-summary not shown after manual apply");
      }
    });
    // input panel closed
    expect(
      container.querySelector("[data-testid=manual-range-panel]"),
    ).toBeNull();
  });

  it("min >= max → 套用按鈕 disabled", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=bubble-manual-range-trigger]",
      ) as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-min]",
      ) as HTMLInputElement,
      { target: { value: "105" } },
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-max]",
      ) as HTMLInputElement,
      { target: { value: "100" } },
    );
    const applyBtn = container.querySelector(
      "[data-testid=manual-range-apply]",
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it("取消 → panel 關閉,brushRange 保持原狀", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=bubble-manual-range-trigger]",
      ) as HTMLButtonElement,
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=manual-range-cancel]",
      ) as HTMLButtonElement,
    );
    expect(
      container.querySelector("[data-testid=manual-range-panel]"),
    ).toBeNull();
    expect(container.querySelector("[data-testid=brush-summary]")).toBeNull();
  });
});

// C10 (🟢 Item 5): help '?' trigger 存在。popover 內容走 Radix Portal,
// jsdom 環境 Portal fireEvent.click 觸發成本高;測 trigger 存在 + aria-label 即可。
describe("ChipBubbleView — C10 help '?' icon (🟢 Item 5)", () => {
  it("header 右上角有 help '?' trigger 按鈕,aria-label 為使用說明", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(trades)} />,
    );
    const help = container.querySelector(
      "[data-testid=bubble-help-trigger]",
    ) as HTMLButtonElement | null;
    expect(help).toBeTruthy();
    expect(help!.getAttribute("aria-label")).toBe("泡泡圖使用說明");
  });
});

// C10 (🔴 Item 3 擴充):brushRange 設定後,分點計數 header 同步只算區間內。
// (Trade list 本身的 row 過濾靠 buildTradeRows 純函式覆蓋;右側 TradeList 走
// react-virtual,jsdom 無 layout 幾何,rows 不 render — 用 header 可觀察值驗證。)
describe("ChipBubbleView — brushRange 同步右側計數 header", () => {
  it("套用區間 [101.5, 102.5](涵蓋 Bravo@102)→ header 顯「此區間 1 個分點」", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=bubble-manual-range-trigger]",
      ) as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-min]",
      ) as HTMLInputElement,
      { target: { value: "101.5" } },
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-max]",
      ) as HTMLInputElement,
      { target: { value: "102.5" } },
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=manual-range-apply]",
      ) as HTMLButtonElement,
    );
    await waitFor(() => {
      if (!container.querySelector("[data-testid=brush-summary]")) {
        throw new Error("summary not shown");
      }
    });
    const text = container.textContent ?? "";
    expect(text.includes("此區間")).toBe(true);
    expect(text.includes("今日共")).toBe(false);
    // 只涵蓋 Bravo → uniqueBrokerCount = 1
    expect(text.includes("1 個分點")).toBe(true);
  });

  // C11 (🔴):broker 選擇時 range 退為視覺參考 — brush-summary 顯示 hint,
  // header 走「查看 X 於籌碼總覽 →」而非「此區間 N 個分點」。
  it("已選 broker + 有 brushRange → brush-summary 顯示 range-parked hint", async () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={vi.fn()}
      />,
    );
    // 先套區間
    fireEvent.click(
      container.querySelector(
        "[data-testid=bubble-manual-range-trigger]",
      ) as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-min]",
      ) as HTMLInputElement,
      { target: { value: "101.5" } },
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-max]",
      ) as HTMLInputElement,
      { target: { value: "102.5" } },
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=manual-range-apply]",
      ) as HTMLButtonElement,
    );
    await waitFor(() => {
      if (!container.querySelector("[data-testid=brush-summary]")) {
        throw new Error("summary not shown");
      }
    });
    // 再選 broker
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => {
      if (!container.querySelector("[data-testid=brush-range-parked]")) {
        throw new Error("range-parked hint not shown");
      }
    });
    // range 仍在(band + summary),但 header 改走 broker 路線
    expect(container.querySelector("[data-testid=brush-summary]")).toBeTruthy();
    expect(
      container.querySelector('[data-testid="bubble-jump-to-overview"]'),
    ).toBeTruthy();
  });

  it("清除 brush → header 回「今日共 3 個分點」", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=bubble-manual-range-trigger]",
      ) as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-min]",
      ) as HTMLInputElement,
      { target: { value: "101.5" } },
    );
    fireEvent.change(
      container.querySelector(
        "[data-testid=manual-range-max]",
      ) as HTMLInputElement,
      { target: { value: "102.5" } },
    );
    fireEvent.click(
      container.querySelector(
        "[data-testid=manual-range-apply]",
      ) as HTMLButtonElement,
    );
    await waitFor(() => {
      if (!container.querySelector("[data-testid=brush-summary]")) {
        throw new Error("summary not shown");
      }
    });
    fireEvent.click(
      container.querySelector("[data-testid=brush-clear]") as HTMLButtonElement,
    );
    await waitFor(() => {
      if (container.querySelector("[data-testid=brush-summary]")) {
        throw new Error("summary still visible after clear");
      }
    });
    const text = container.textContent ?? "";
    expect(text.includes("今日共")).toBe(true);
    expect(text.includes("3 個分點")).toBe(true);
  });
});
