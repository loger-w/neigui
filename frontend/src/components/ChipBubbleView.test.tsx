/**
 * @vitest-environment jsdom
 *
 * F2: bubble-view right-side trade list — sort by 張數 / 價位 via header click;
 * independent state per side; aria-sort reflects current key+dir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChipBubbleView } from "./ChipBubbleView";
import { BROKER_PALETTE } from "../lib/chip-bubble-svg";
import type { BrokerTrade, ChipBubbleData } from "../lib/chip-data";

// C7 A1 test 需要 BubbleChartSvg 真正 render(Y-axis brush overlay 從裡面出)。
// jsdom 沒 layout → useContainerSize 回 {0,0} → svg gate 掉。mock 讓 A1 tests
// 能 exercise brush 路徑。既有 F2 sort header tests 不依賴 svg render,不受影響。
vi.mock("../hooks/useContainerSize", () => ({
  useContainerSize: () => ({ width: 400, height: 300 }),
}));

// bubble-multi-broker:mobile sheet 標題測試需要可控 isMobile(真 hook 在
// jsdom feature-detect 恆 false)。預設 false = 桌面,既有測試不受影響。
const mediaState = vi.hoisted(() => ({ isMobile: false }));
vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => mediaState.isMobile,
}));

afterEach(() => cleanup());

// jsdom lacks ResizeObserver; useContainerSize would otherwise throw on
// observer construction. We give it the minimal shape the hook actually
// calls (constructor + observe + disconnect).
beforeEach(() => {
  // BB-1 blocklist 走 localStorage 全域持久化 — 測試間必清,避免跨 describe 污染。
  localStorage.clear();
  mediaState.isMobile = false;
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
    // mod/broker-label-search-only-id:header 連結非搜尋框 → 只顯名稱
    expect((btn.textContent ?? "").includes("Alpha")).toBe(true);
    expect((btn.textContent ?? "").includes("AL1")).toBe(false);
    expect((btn.textContent ?? "").includes("籌碼總覽")).toBe(true);
  });

  // mod/broker-label-search-only-id:右欄成交明細列只顯去dash名稱。
  // TradeList 走 virtualizer,量測走 offsetWidth/offsetHeight(jsdom 恆 0 不
  // 出列)— stub prototype getter 給高度(frontend-testing 多態渲染條目同型技巧)。
  it("TradeList 明細列只顯名稱不帶 id", async () => {
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true, get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true, get: () => 400,
    });
    try {
      const { container } = render(
        <ChipBubbleView
          symbol="2330"
          bubbleData={mkData(namedTrades)}
          onJumpToOverview={vi.fn()}
        />,
      );
      await waitFor(() => {
        const texts = Array.from(
          container.querySelectorAll("button span.text-left"),
        ).map((s) => s.textContent ?? "");
        expect(texts.some((t) => t === "Alpha")).toBe(true);
        expect(texts.some((t) => t === "Bravo")).toBe(true);
      });
    } finally {
      if (origH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origH);
      if (origW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origW);
    }
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

// BB-1 (mod/batch-ui-update 🟢): 泡泡圖過濾清單 — 排除分點不進泡泡/列表/統計,
// localStorage 全域持久化。Popover 互動樣板同 BrokerFilterPopover.test(Radix
// Portal 掛 document.body,開啟後用 document 查)。
describe("ChipBubbleView — BB-1 過濾清單", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function openBlocklistPopover(container: HTMLElement) {
    const trigger = container.querySelector(
      "[data-testid=bubble-blocklist-trigger]",
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    const popover = document.querySelector(
      "[data-testid=bubble-blocklist-popover]",
    );
    expect(popover).toBeTruthy();
    return popover as HTMLElement;
  }

  it("搜尋分點加入排除 → 計數自 3 降 2,localStorage 寫入", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    expect((container.textContent ?? "").includes("3 個分點")).toBe(true);

    const popover = openBlocklistPopover(container);
    const searchInput = popover.querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "Alpha" } });
    const candidate = document.querySelector(
      "[data-testid=bubble-blocklist-candidate]",
    ) as HTMLElement | null;
    expect(candidate).toBeTruthy();
    expect(candidate!.textContent ?? "").toContain("Alpha");
    fireEvent.click(candidate!);

    await waitFor(() => {
      if (!(container.textContent ?? "").includes("2 個分點")) {
        throw new Error("count not updated after block");
      }
    });
    const stored = JSON.parse(
      localStorage.getItem("neigui.bubble-broker-blocklist.v1") ?? "[]",
    );
    expect(stored).toEqual([{ id: "AL1", name: "Alpha" }]);
  });

  it("過濾清單搜尋 dash-insensitive:照顯示字樣(去dash)輸入命中含 dash 分點", () => {
    const dashedTrades: BrokerTrade[] = [
      { broker: "凱基-信義", broker_id: "9268", price: 100, buy: 10, sell: 0 },
    ];
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(dashedTrades)} />,
    );
    const popover = openBlocklistPopover(container);
    const searchInput = popover.querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "凱基信義" } });
    const candidate = document.querySelector(
      "[data-testid=bubble-blocklist-candidate]",
    ) as HTMLElement | null;
    expect(candidate).toBeTruthy();
    expect(candidate!.textContent ?? "").toContain("凱基信義");
  });

  it("被排除分點不出現在 BrokerSearch 下拉", async () => {
    localStorage.setItem(
      "neigui.bubble-broker-blocklist.v1",
      JSON.stringify([{ id: "AL1", name: "Alpha" }]),
    );
    render(<ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />);
    const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Alpha" } });
    // Bravo/Charlie 不含 Alpha substring → 應完全無下拉項
    await waitFor(() => {
      const items = screen.queryAllByTestId("broker-search-item");
      if (items.some((el) => (el.textContent ?? "").includes("Alpha"))) {
        throw new Error("blocked broker still in search dropdown");
      }
    });
  });

  it("清單逐一移除 → 分點恢復計數", async () => {
    localStorage.setItem(
      "neigui.bubble-broker-blocklist.v1",
      JSON.stringify([{ id: "AL1", name: "Alpha" }]),
    );
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    expect((container.textContent ?? "").includes("2 個分點")).toBe(true);

    const popover = openBlocklistPopover(container);
    const row = popover.querySelector(
      "[data-testid=bubble-blocklist-row]",
    ) as HTMLElement | null;
    expect(row).toBeTruthy();
    expect(row!.textContent ?? "").toContain("Alpha");
    const removeBtn = row!.querySelector(
      "[data-testid=bubble-blocklist-remove]",
    ) as HTMLButtonElement;
    fireEvent.click(removeBtn);

    await waitFor(() => {
      if (!(container.textContent ?? "").includes("3 個分點")) {
        throw new Error("count not restored after remove");
      }
    });
    expect(
      JSON.parse(localStorage.getItem("neigui.bubble-broker-blocklist.v1") ?? "x"),
    ).toEqual([]);
  });

  it("全部清除 → 全部恢復", async () => {
    localStorage.setItem(
      "neigui.bubble-broker-blocklist.v1",
      JSON.stringify([
        { id: "AL1", name: "Alpha" },
        { id: "BR1", name: "Bravo" },
      ]),
    );
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    expect((container.textContent ?? "").includes("1 個分點")).toBe(true);

    openBlocklistPopover(container);
    const clearBtn = document.querySelector(
      "[data-testid=bubble-blocklist-clear-all]",
    ) as HTMLButtonElement | null;
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);

    await waitFor(() => {
      if (!(container.textContent ?? "").includes("3 個分點")) {
        throw new Error("count not restored after clear-all");
      }
    });
    expect(
      JSON.parse(localStorage.getItem("neigui.bubble-broker-blocklist.v1") ?? "x"),
    ).toEqual([]);
  });

  it("trigger 顯示排除數 badge;清單空時不顯", () => {
    const { container, unmount } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    expect(
      container.querySelector("[data-testid=bubble-blocklist-count]"),
    ).toBeNull();
    unmount();

    localStorage.setItem(
      "neigui.bubble-broker-blocklist.v1",
      JSON.stringify([{ id: "AL1", name: "Alpha" }]),
    );
    const { container: c2 } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    const badge = c2.querySelector("[data-testid=bubble-blocklist-count]");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("1");
  });
});

// CH-1(mod/batch-ui-update 🟢):focusRequest 聚焦 — 籌碼總攬「看泡泡圖」鈕
// 跳轉後自動選中該分點。R6:聚焦分點在排除清單 → 自動移除(顯式意圖優先於
// 舊設定)+ R10 繁中提示;當日無成交 → 維持選中 + 空狀態。
describe("ChipBubbleView — CH-1 focusRequest 聚焦", () => {
  it("focusRequest 設定 → 該分點自動選中(totals 出現)", async () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        focusRequest={{ brokerId: "AL1", name: "Alpha", seq: 1 }}
      />,
    );
    await waitFor(() => {
      if (!container.querySelector('[data-testid="bubble-broker-totals"]')) {
        throw new Error("totals not shown — focus did not select broker");
      }
    });
    // 已篩選文案(無 onJumpToOverview)= 選中狀態的 header 呈現
    expect((container.textContent ?? "").includes("已篩選")).toBe(true);
  });

  it("聚焦分點在排除清單 → 自動移除 + 提示「已自過濾清單移除〈名〉」(R6/R10)", async () => {
    localStorage.setItem(
      "neigui.bubble-broker-blocklist.v1",
      JSON.stringify([{ id: "AL1", name: "Alpha" }]),
    );
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        focusRequest={{ brokerId: "AL1", name: "Alpha", seq: 1 }}
      />,
    );
    await waitFor(() => {
      if (!(container.textContent ?? "").includes("已自過濾清單移除〈Alpha〉")) {
        throw new Error("removal notice not shown");
      }
    });
    // 清單真的移除(持久層同步)且分點恢復可見 → 選中 totals 出現
    expect(
      JSON.parse(localStorage.getItem("neigui.bubble-broker-blocklist.v1") ?? "x"),
    ).toEqual([]);
    expect(
      container.querySelector('[data-testid="bubble-broker-totals"]'),
    ).toBeTruthy();
  });

  it("聚焦分點當日無成交 → 維持選中 + 顯示空狀態(R6 case 2)", async () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        focusRequest={{ brokerId: "ZZ9", name: "無成交分點", seq: 1 }}
      />,
    );
    await waitFor(() => {
      if (!(container.textContent ?? "").includes("該分點當日無成交")) {
        throw new Error("no-trades empty state not shown");
      }
    });
    // 名稱也一併呈現,使用者知道是哪個分點
    expect((container.textContent ?? "").includes("無成交分點")).toBe(true);
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

// ===========================================================================
// bubble-multi-broker(SC-1/3/4/5/6):多選分點 — chips / 合併統計 / 三入口
// toggle / 上限 / focusRequest 取代 / blocklist 保留其餘。
// ===========================================================================

function chipEls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-testid="broker-chip"]'));
}

describe("ChipBubbleView — 多選 chips 與合併統計 (SC-1/SC-3/SC-4)", () => {
  // 痛點:多選是本 feature 核心;chips 是唯一的選取狀態載體(搜尋框不再 echo)。
  it("搜尋連續加選 2 個分點 → 2 枚 chip + 合併統計 + 「查看 2 個分點」跳轉", async () => {
    const onJump = vi.fn();
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={onJump}
      />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => {
      expect(chipEls(container)).toHaveLength(2);
    });
    const texts = chipEls(container).map((c) => c.textContent ?? "");
    expect(texts.some((t) => t.includes("Alpha"))).toBe(true);
    expect(texts.some((t) => t.includes("Bravo"))).toBe(true);
    // 合併統計:Alpha buy10 sell30 @100、Bravo buy5 sell50 @102
    // buyLots 15 / sellLots 80;buyAmount 1,510,000 → "151 萬";sell 8,100,000 → "810 萬"
    const totals = container.querySelector('[data-testid="bubble-broker-totals"]');
    expect(totals).toBeTruthy();
    const tt = totals!.textContent ?? "";
    expect(tt.includes("15")).toBe(true);
    expect(tt.includes("80")).toBe(true);
    expect(tt.includes("151 萬")).toBe(true);
    expect(tt.includes("810 萬")).toBe(true);
    // 跳轉鈕:N ≥ 2 改批量文案 + 傳 id 陣列
    const jump = container.querySelector('[data-testid="bubble-jump-to-overview"]') as HTMLButtonElement;
    expect(jump).toBeTruthy();
    expect(jump.textContent ?? "").toContain("查看 2 個分點於籌碼總覽");
    fireEvent.click(jump);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump.mock.calls[0]![0]).toEqual(["AL1", "BR1"]);
  });

  // 痛點:chip × 是唯一逐一移除入口;清除全部只在 ≥ 2 時出現。
  it("chip × 移除單一分點;「清除全部」清空選取", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => expect(chipEls(container)).toHaveLength(2));
    const clearAll = container.querySelector('[data-testid="broker-chips-clear"]');
    expect(clearAll).toBeTruthy();
    // × 移除 Alpha
    fireEvent.click(screen.getByLabelText("移除〈Alpha〉"));
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect(chipEls(container)[0]!.textContent ?? "").toContain("Bravo");
    // 只剩 1 枚 → 清除全部鈕隱藏
    expect(container.querySelector('[data-testid="broker-chips-clear"]')).toBeNull();
    // 再加回一枚後用清除全部
    await selectBrokerViaSearch("Charlie");
    await waitFor(() => expect(chipEls(container)).toHaveLength(2));
    fireEvent.click(
      container.querySelector('[data-testid="broker-chips-clear"]') as HTMLButtonElement,
    );
    await waitFor(() => expect(chipEls(container)).toHaveLength(0));
    expect(container.querySelector('[data-testid="bubble-broker-totals"]')).toBeNull();
  });

  // 痛點(R4):配色是 auto-default 拍板理由 — index-based 配色會在移除時整組
  // 換色,必須鎖「移除不重配、新加選回收最小空 slot」不變式。
  it("配色不變式:移除中間 chip 其餘顏色不動,新加選回收釋出 slot", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    await selectBrokerViaSearch("Charlie");
    await waitFor(() => expect(chipEls(container)).toHaveLength(3));
    const dotColor = (chip: HTMLElement) =>
      chip.querySelector('[data-testid="broker-chip-dot"]')!.getAttribute("data-color");
    const byName = (name: string) =>
      chipEls(container).find((c) => (c.textContent ?? "").includes(name))!;
    expect(dotColor(byName("Alpha"))).toBe(BROKER_PALETTE[0]);
    expect(dotColor(byName("Bravo"))).toBe(BROKER_PALETTE[1]);
    expect(dotColor(byName("Charlie"))).toBe(BROKER_PALETTE[2]);
    // 移除中間的 Bravo → Alpha / Charlie 不變
    fireEvent.click(screen.getByLabelText("移除〈Bravo〉"));
    await waitFor(() => expect(chipEls(container)).toHaveLength(2));
    expect(dotColor(byName("Alpha"))).toBe(BROKER_PALETTE[0]);
    expect(dotColor(byName("Charlie"))).toBe(BROKER_PALETTE[2]);
    // 新加選回收最小空 slot(= 1)
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => expect(chipEls(container)).toHaveLength(3));
    expect(dotColor(byName("Bravo"))).toBe(BROKER_PALETTE[1]);
  });

  // 痛點(R3,鎖 design R5):選中分點自 trades 消失(blocklist / refetch)時
  // chip 不得失效 — selectedNames 必須自 state 導出,不走 trades join。
  it("選中分點自 trades 消失 → chip 仍顯示、統計歸零不 crash", async () => {
    const { container, rerender } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    // refetch 後 Alpha 消失
    const without = namedTrades.filter((t) => t.broker_id !== "AL1");
    rerender(<ChipBubbleView symbol="2330" bubbleData={mkData(without)} />);
    expect(chipEls(container)).toHaveLength(1);
    expect(chipEls(container)[0]!.textContent ?? "").toContain("Alpha");
    const totals = container.querySelector('[data-testid="bubble-broker-totals"]');
    expect(totals).toBeTruthy();
  });
});

describe("ChipBubbleView — 上限 6 + limitNotice (SC-1 edge 1)", () => {
  const seven: BrokerTrade[] = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf",
  ].map((name, i) => ({
    broker: name,
    broker_id: `ID${i}`,
    price: 100,
    buy: 10 + i,
    sell: 5,
  }));

  // 痛點:palette 只有 6 色,第 7 個必須被拒且畫面說明原因。
  it("加選第 7 個 → 不加入 + role=status 提示;再 toggle 提示清除", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(seven)} />,
    );
    for (const n of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]) {
      await selectBrokerViaSearch(n);
    }
    await waitFor(() => expect(chipEls(container)).toHaveLength(6));
    await selectBrokerViaSearch("Golf");
    await waitFor(() => {
      const notice = Array.from(container.querySelectorAll('[role="status"]'))
        .find((el) => (el.textContent ?? "").includes("最多同時選 6 個分點"));
      expect(notice).toBeTruthy();
    });
    expect(chipEls(container)).toHaveLength(6);
    // 移除一枚(toggle)→ 提示清除
    fireEvent.click(screen.getByLabelText("移除〈Alpha〉"));
    await waitFor(() => {
      const notice = Array.from(container.querySelectorAll('[role="status"]'))
        .find((el) => (el.textContent ?? "").includes("最多同時選 6 個分點"));
      expect(notice).toBeUndefined();
    });
    expect(chipEls(container)).toHaveLength(5);
  });
});

describe("ChipBubbleView — 泡泡 / 明細列入口 (SC-1 加選半邊 + 單看)", () => {
  // 痛點:jsdom 的 svg rect getBoundingClientRect 全零 → hitTest 的 mx=clientX,
  // 用 circle cx/cy 直接命中泡泡,驗真實 click 路徑(非 handler mock)。
  // 🔴 mod/bubble-chart-ux-polish SC-3:點已選分點從「移除」改「單看」——
  // 誤點不再破壞篩選組合;移除只走 chip × / 清除全部 / 搜尋下拉。
  it("點泡泡 → 加選;再點同泡泡 → 進單看(chip 保留);三點 → 解除單看", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    const overlay = container.querySelector('[data-testid="bubble-main-overlay"]')!;
    const alphaCircle = await waitFor(() => {
      const c = Array.from(container.querySelectorAll("circle")).find(
        (el) => el.getAttribute("data-broker-id") === "AL1",
      );
      if (!c) throw new Error("Alpha circle not rendered");
      return c;
    });
    const cx = Number(alphaCircle.getAttribute("cx"));
    const cy = Number(alphaCircle.getAttribute("cy"));
    fireEvent.click(overlay, { clientX: cx, clientY: cy });
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect(chipEls(container)[0]!.textContent ?? "").toContain("Alpha");
    // 選中後圖面只剩 Alpha,同位置(F11 axes-stable)再點 → 單看,chip 不動
    fireEvent.click(overlay, { clientX: cx, clientY: cy });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="bubble-solo-badge"]')).toBeTruthy();
    });
    expect(chipEls(container)).toHaveLength(1);
    // 第三點 → 解除單看,chip 仍在
    fireEvent.click(overlay, { clientX: cx, clientY: cy });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="bubble-solo-badge"]')).toBeNull();
    });
    expect(chipEls(container)).toHaveLength(1);
  });

  // 痛點:TradeList 列是第三個入口;virtualizer 在 jsdom 走 offsetWidth/Height,
  // stub prototype getter 才出列(frontend-testing 樣板)。
  // 🔴 SC-3:明細列點已選同泡泡入口 — 進單看不移除。
  it("點明細列 → 加選;再點 → 進單看(chip 保留)", async () => {
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true, get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true, get: () => 400,
    });
    try {
      const { container } = render(
        <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
      );
      const rowFor = (name: string) =>
        Array.from(container.querySelectorAll("button span.text-left"))
          .find((s) => s.textContent === name)
          ?.closest("button") ?? null;
      await waitFor(() => {
        if (!rowFor("Alpha")) throw new Error("row not rendered");
      });
      fireEvent.click(rowFor("Alpha")!);
      await waitFor(() => expect(chipEls(container)).toHaveLength(1));
      // 選中後列表過濾為 Alpha;再點同列 → 單看,chip 不動
      await waitFor(() => {
        if (!rowFor("Alpha")) throw new Error("filtered row not rendered");
      });
      fireEvent.click(rowFor("Alpha")!);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="bubble-solo-badge"]')).toBeTruthy();
      });
      expect(chipEls(container)).toHaveLength(1);
    } finally {
      if (origH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origH);
      if (origW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origW);
    }
  });
});

// mod/bubble-chart-ux-polish SC-3/4/5:單看模式 — 多選篩選中「看看這個泡泡」
// 不破壞花時間建立的選取組合。
describe("ChipBubbleView — 單看模式 (SC-3/4/5)", () => {
  const soloBadge = (c: HTMLElement) =>
    c.querySelector('[data-testid="bubble-solo-badge"]');
  const totalsText = (c: HTMLElement) =>
    c.querySelector('[data-testid="bubble-broker-totals"]')?.textContent ?? "";

  async function clickCircle(container: HTMLElement, brokerId: string) {
    const overlay = container.querySelector('[data-testid="bubble-main-overlay"]')!;
    const circle = await waitFor(() => {
      const c = Array.from(container.querySelectorAll("circle")).find(
        (el) => el.getAttribute("data-broker-id") === brokerId,
      );
      if (!c) throw new Error(`${brokerId} circle not rendered`);
      return c;
    });
    fireEvent.click(overlay, {
      clientX: Number(circle.getAttribute("cx")),
      clientY: Number(circle.getAttribute("cy")),
    });
  }

  async function setupTwoSelected() {
    const utils = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={vi.fn()}
      />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => expect(chipEls(utils.container)).toHaveLength(2));
    return utils;
  }

  // 痛點:整組統計蓋掉單分點資訊是 user 抱怨主因 — 單看必須切到單分點數字。
  it("多選 2 點已選泡泡 → 單看(badge + 單分點統計、chips 保留);再點回整組", async () => {
    const { container } = await setupTwoSelected();
    // 整組:Alpha 買10/賣30 + Bravo 買5/賣50 = 買15/賣80
    expect(totalsText(container)).toContain("15");
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    expect(soloBadge(container)!.textContent ?? "").toContain("Alpha");
    expect(totalsText(container)).toContain("10");
    expect(totalsText(container)).not.toContain("15");
    expect(chipEls(container)).toHaveLength(2);
    // 再點同泡泡 → 回整組
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeNull());
    expect(totalsText(container)).toContain("15");
    expect(chipEls(container)).toHaveLength(2);
  });

  // 痛點:單看是暫態檢視,點另一已選分點應直接切換目標,不是先解除再點。
  it("單看 A 中點另一已選 B 泡泡 → 單看目標切換為 B", async () => {
    const { container } = await setupTwoSelected();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    await clickCircle(container, "BR1");
    await waitFor(() => {
      expect(soloBadge(container)!.textContent ?? "").toContain("Bravo");
    });
    expect(totalsText(container)).toContain("50");
    expect(chipEls(container)).toHaveLength(2);
  });

  // 痛點(SC-5):誤點空白把篩選組合全滅是 user 抱怨第二主因 — 兩段式緩衝。
  it("單看中點空白 → 只解單看(chips 保留);再點空白 → 全清(照舊)", async () => {
    const { container } = await setupTwoSelected();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    const overlay = container.querySelector('[data-testid="bubble-main-overlay"]')!;
    fireEvent.click(overlay); // 無座標 → hitTest miss → broker null
    await waitFor(() => expect(soloBadge(container)).toBeNull());
    expect(chipEls(container)).toHaveLength(2);
    fireEvent.click(overlay);
    await waitFor(() => expect(chipEls(container)).toHaveLength(0));
  });

  // 痛點(SC-4):加選意圖 = 擴組合,不得打斷進行中的單看。
  it("單看中搜尋加選第三分點 → 加選成功、單看維持", async () => {
    const { container } = await setupTwoSelected();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    await selectBrokerViaSearch("Charlie");
    await waitFor(() => expect(chipEls(container)).toHaveLength(3));
    expect(soloBadge(container)).toBeTruthy();
    expect(soloBadge(container)!.textContent ?? "").toContain("Alpha");
  });

  // 痛點:移除單看目標後 badge 不得殘留指向已不在組合裡的分點。
  it("chip × 移除單看分點 → 單看解除;重新加選同分點不復活(review R1)", async () => {
    const { container } = await setupTwoSelected();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    fireEvent.click(screen.getByLabelText("移除〈Alpha〉"));
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect(soloBadge(container)).toBeNull();
    // R1:stale solo 不得在重加選時無聲復活
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => expect(chipEls(container)).toHaveLength(2));
    expect(soloBadge(container)).toBeNull();
  });

  it("清除全部 → 單看一併解除", async () => {
    const { container } = await setupTwoSelected();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    fireEvent.click(
      container.querySelector('[data-testid="broker-chips-clear"]') as HTMLButtonElement,
    );
    await waitFor(() => expect(chipEls(container)).toHaveLength(0));
    expect(soloBadge(container)).toBeNull();
  });

  it("回整組鈕 → 解除單看;單看期間 jump 鈕暫隱", async () => {
    const { container } = await setupTwoSelected();
    expect(container.querySelector('[data-testid="bubble-jump-to-overview"]')).toBeTruthy();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    expect(container.querySelector('[data-testid="bubble-jump-to-overview"]')).toBeNull();
    fireEvent.click(
      container.querySelector('[data-testid="bubble-solo-clear"]') as HTMLButtonElement,
    );
    await waitFor(() => expect(soloBadge(container)).toBeNull());
    expect(container.querySelector('[data-testid="bubble-jump-to-overview"]')).toBeTruthy();
  });

  // 痛點(SC-3 右欄同步):單看 = 該泡泡的單獨買賣超,右欄明細必須跟著只顯該分點。
  it("單看時右欄明細只顯該分點列", async () => {
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true, get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true, get: () => 400,
    });
    try {
      const { container } = await setupTwoSelected();
      await waitFor(() => {
        const names = Array.from(
          container.querySelectorAll("button span.text-left"),
        ).map((s) => s.textContent ?? "");
        expect(names.some((t) => t.includes("Bravo"))).toBe(true);
      });
      await clickCircle(container, "AL1");
      await waitFor(() => expect(soloBadge(container)).toBeTruthy());
      await waitFor(() => {
        const names = Array.from(
          container.querySelectorAll("button span.text-left"),
        ).map((s) => s.textContent ?? "");
        expect(names.length).toBeGreaterThan(0);
        expect(names.every((t) => t.includes("Alpha"))).toBe(true);
      });
    } finally {
      if (origH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origH);
      if (origW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origW);
    }
  });

  // 痛點(CH-1 白名單 5):focusRequest 聚焦 = 取代整組,不得殘留舊單看。
  it("focusRequest 觸發 → 單看清除", async () => {
    const { container, rerender } = await setupTwoSelected();
    await clickCircle(container, "AL1");
    await waitFor(() => expect(soloBadge(container)).toBeTruthy());
    rerender(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        onJumpToOverview={vi.fn()}
        focusRequest={{ brokerId: "CH1", name: "Charlie", seq: 1 }}
      />,
    );
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect(soloBadge(container)).toBeNull();
  });

  // 痛點(review R3):mobile 進單看若不開 sheet,唯一回饋是 header 小字,
  // 近乎靜默 — 對齊「tap 泡泡 → 自動開 sheet」既有心智。
  it("mobile 進單看 → 自動開 sheet,標題顯「單看」", async () => {
    mediaState.isMobile = true;
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="bubble-detail-sheet"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("關閉明細"));
    expect(container.querySelector('[data-testid="bubble-detail-sheet"]')).toBeNull();
    await clickCircle(container, "AL1");
    const sheet = await waitFor(() => {
      const el = container.querySelector('[data-testid="bubble-detail-sheet"]');
      if (!el) throw new Error("sheet not reopened on solo");
      return el;
    });
    expect(sheet.textContent ?? "").toContain("單看");
  });
});

describe("ChipBubbleView — focusRequest 取代 / blocklist 保留其餘 (SC-6)", () => {
  // 痛點:聚焦語意 =「看這個」,必須取代整組而非 append。
  it("已多選 2 個後 focusRequest → 選取被取代為聚焦分點單獨一枚", async () => {
    const { container, rerender } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => expect(chipEls(container)).toHaveLength(2));
    rerender(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        focusRequest={{ brokerId: "CH1", name: "Charlie", seq: 1 }}
      />,
    );
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect(chipEls(container)[0]!.textContent ?? "").toContain("Charlie");
  });

  // 痛點(R5 impl-spec):badge 條件必須 length===1 嚴格判,多選含聚焦分點不現。
  it("focusRequest 無成交分點後再加選 → 無成交 badge 消失(嚴格單選判定)", async () => {
    const { container } = render(
      <ChipBubbleView
        symbol="2330"
        bubbleData={mkData(namedTrades)}
        focusRequest={{ brokerId: "ZZ9", name: "無成交分點", seq: 1 }}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="bubble-focus-no-trades"]'),
      ).toBeTruthy();
    });
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="bubble-focus-no-trades"]'),
      ).toBeNull();
    });
    expect(chipEls(container)).toHaveLength(2);
  });

  // 痛點:blocklist 加入只影響該分點,其餘選中保留(SC-6 後半)。
  it("將選中分點之一加入排除清單 → 該枚移除、其餘保留", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    await waitFor(() => expect(chipEls(container)).toHaveLength(2));
    // 開 blocklist popover,把 Alpha 加入排除
    fireEvent.click(
      container.querySelector("[data-testid=bubble-blocklist-trigger]") as HTMLButtonElement,
    );
    const searchInput = document
      .querySelector("[data-testid=bubble-blocklist-popover]")!
      .querySelector("input[type=text]") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "Alpha" } });
    fireEvent.click(
      document.querySelector("[data-testid=bubble-blocklist-candidate]") as HTMLElement,
    );
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect(chipEls(container)[0]!.textContent ?? "").toContain("Bravo");
  });
});

// Phase 4 review F1/F2:同名不同 broker_id 的入口精準性 — 泡泡 / 明細列點擊
// 必須按實際點擊的 id toggle(svg payload 本就帶 brokerId,不得 name 反查
// 猜第一筆);列首圓點配色以 id 為 key,同名兩分點顏色不得互蓋。
describe("ChipBubbleView — 同名不同 id 入口精準性 (Phase 4 F1/F2)", () => {
  const collideTrades: BrokerTrade[] = [
    { broker: "凱基-台北", broker_id: "9800", price: 100, buy: 50, sell: 0 },
    { broker: "凱基-台北", broker_id: "9801", price: 102, buy: 30, sell: 0 },
    { broker: "別家", broker_id: "X1", price: 101, buy: 20, sell: 0 },
  ];

  it("點 9801 的泡泡 → 選中的是 9801(非同名第一筆 9800)", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(collideTrades)} />,
    );
    const overlay = container.querySelector('[data-testid="bubble-main-overlay"]')!;
    const c9801 = await waitFor(() => {
      const c = Array.from(container.querySelectorAll("circle")).find(
        (el) => el.getAttribute("data-broker-id") === "9801",
      );
      if (!c) throw new Error("9801 circle not rendered");
      return c;
    });
    fireEvent.click(overlay, {
      clientX: Number(c9801.getAttribute("cx")),
      clientY: Number(c9801.getAttribute("cy")),
    });
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    // filter 模式下圖面只剩選中分點 → 全部 circle 必須是 9801
    const shown = Array.from(container.querySelectorAll("circle")).map((c) =>
      c.getAttribute("data-broker-id"),
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((id) => id === "9801")).toBe(true);
  });

  it("點 9801 的明細列 → 選中的是 9801", async () => {
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true, get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true, get: () => 400,
    });
    try {
      const { container } = render(
        <ChipBubbleView symbol="2330" bubbleData={mkData(collideTrades)} />,
      );
      // 9801 那列的張數是 30(9800 是 50)— 以 volume cell 區分同名列
      const row9801 = await waitFor(() => {
        const rows = Array.from(container.querySelectorAll("button"))
          .filter((b) => (b.textContent ?? "").includes("凱基台北"));
        const target = rows.find((b) => (b.textContent ?? "").includes("30"));
        if (!target) throw new Error("9801 row not rendered");
        return target;
      });
      fireEvent.click(row9801);
      await waitFor(() => expect(chipEls(container)).toHaveLength(1));
      const shown = Array.from(container.querySelectorAll("circle")).map((c) =>
        c.getAttribute("data-broker-id"),
      );
      expect(shown.every((id) => id === "9801")).toBe(true);
    } finally {
      if (origH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origH);
      if (origW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origW);
    }
  });

  it("同名兩分點同時選中 → 明細列首圓點兩色不互蓋(id-key 配色)", async () => {
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true, get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true, get: () => 400,
    });
    try {
      const { container } = render(
        <ChipBubbleView symbol="2330" bubbleData={mkData(collideTrades)} />,
      );
      // 以 id 搜尋分別加選兩個同名分點
      await selectBrokerViaSearch("9800");
      await selectBrokerViaSearch("9801");
      await waitFor(() => expect(chipEls(container)).toHaveLength(2));
      const dotColors = await waitFor(() => {
        const dots = Array.from(
          container.querySelectorAll('[data-testid="row-broker-dot"]'),
        ).map((d) => d.getAttribute("data-color"));
        if (dots.length < 2) throw new Error("row dots not rendered");
        return new Set(dots);
      });
      expect(dotColors.size).toBe(2);
      expect(dotColors.has(BROKER_PALETTE[0]!)).toBe(true);
      expect(dotColors.has(BROKER_PALETTE[1]!)).toBe(true);
    } finally {
      if (origH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origH);
      if (origW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origW);
    }
  });
});

describe("ChipBubbleView — mobile sheet 標題三分支 (SC-4 / edge 5)", () => {
  // 痛點(R7):自動開 sheet effect 的條件從 selectedBrokerId 改 selected.length,
  // 標題要能承載多選;N 歸 0 sheet 維持開啟(effect 只開不關,與現行一致)。
  it("mobile 多選 2 個 → sheet 自動開啟,標題「成交明細 — 2 個分點」;歸 0 維持開啟", async () => {
    mediaState.isMobile = true;
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    await selectBrokerViaSearch("Alpha");
    await selectBrokerViaSearch("Bravo");
    const sheet = await waitFor(() => {
      const el = container.querySelector('[data-testid="bubble-detail-sheet"]');
      if (!el) throw new Error("sheet not opened");
      return el;
    });
    expect(sheet.textContent ?? "").toContain("成交明細 — 2 個分點");
    // 清空選取 → sheet 維持開啟、標題退回無選取型
    fireEvent.click(screen.getByLabelText("移除〈Alpha〉"));
    fireEvent.click(screen.getByLabelText("移除〈Bravo〉"));
    await waitFor(() => expect(chipEls(container)).toHaveLength(0));
    expect(container.querySelector('[data-testid="bubble-detail-sheet"]')).toBeTruthy();
  });
});

// mod/bubble-chart-ux-polish SC-1/SC-2:header 空間預留 — 搜尋固定左欄 +
// chips 行 / 統計行常駐,搜尋與加選不再推擠統計(repro-six-selected-1536.png:
// 舊版單一 flex-wrap,6 chip 時搜尋框被壓窄、統計掉第二行被下拉蓋住)。
describe("ChipBubbleView — header 空間預留 (SC-1/SC-2)", () => {
  // 痛點:桌面版面契約 = grid 三欄(360px 搜尋 / 中欄雙行 / 右工具),class
  // 綁 testid 鎖住 — 退回 flex-wrap 混排即紅。
  it("header 根容器帶桌面 grid 三欄 class(固定 360px 搜尋欄)", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    const header = container.querySelector('[data-testid="bubble-header"]');
    expect(header).toBeTruthy();
    expect((header as HTMLElement).className).toContain(
      "lg:grid-cols-[360px_minmax(0,1fr)_auto]",
    );
  });

  // 痛點:統計行常駐(位置固定),未選時也 render(今日共 N 個分點)——
  // 「selected>0 才出現」的舊條件會讓版面在加選瞬間跳動。
  it("統計行常駐:未選時 bubble-stats-row 存在且顯「今日共 N 個分點」", () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    const row = container.querySelector('[data-testid="bubble-stats-row"]');
    expect(row).toBeTruthy();
    expect(row!.textContent ?? "").toContain("今日共");
    expect(row!.textContent ?? "").toContain("3");
  });

  // 痛點:chips 行空態佔位 + 引導,header 高度不因首次加選跳動。
  it("chips 行空態顯引導文字;加選後消失", async () => {
    const { container } = render(
      <ChipBubbleView symbol="2330" bubbleData={mkData(namedTrades)} />,
    );
    expect((container.textContent ?? "").includes("點泡泡或搜尋分點加入比較")).toBe(true);
    await selectBrokerViaSearch("Alpha");
    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    expect((container.textContent ?? "").includes("點泡泡或搜尋分點加入比較")).toBe(false);
  });
});
