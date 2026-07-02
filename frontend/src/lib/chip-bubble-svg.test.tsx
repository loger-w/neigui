/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BubbleChartSvg } from "./chip-bubble-svg";
import type { BrokerTrade } from "./chip-data";

afterEach(() => cleanup());

const mkTrade = (overrides: Partial<BrokerTrade> = {}): BrokerTrade => ({
  broker: "凱基台北",
  broker_id: "9201A",
  price: 100,
  buy: 50,
  sell: 0,
  ...overrides,
});

describe("BubbleChartSvg — default unfiltered render", () => {
  it("renders bubbles when trades have significant volume", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
      mkTrade({ broker: "B", broker_id: "B1", price: 101, buy: 0, sell: 30 }),
    ];
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("shows 'No significant volume' when no broker selected and all volumes ≤ threshold", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 2, sell: 1 }),
    ];
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    expect(container.textContent).toContain("No significant volume");
  });
});

describe("BubbleChartSvg F1 — no yellow highlight on selected broker", () => {
  it("selected broker's bubbles use normal stroke (not CHIP.ma5 #f0b429) and strokeWidth=1", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 100, buy: 50, sell: 0 }),
      mkTrade({ broker: "其他", broker_id: "X1", price: 100, buy: 50, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    expect(circles.length).toBeGreaterThan(0);
    for (const c of circles) {
      const stroke = c.getAttribute("stroke") ?? "";
      const sw = c.getAttribute("stroke-width") ?? "";
      // Bug requirement: no circle uses the MA5 yellow stroke or the 2px width
      expect(stroke.toLowerCase()).not.toBe("#f0b429");
      expect(sw).not.toBe("2");
    }
  });
});

describe("BubbleChartSvg F2 — single-broker search bypasses global empty-state", () => {
  it("low-volume day + selectedBroker WITH (sub-threshold) trades → renders broker bubbles, NO 'No significant volume'", () => {
    // EVERY broker is sub-threshold (buy/sell ≤ 5). Pre-fix this triggered
    // the global "No significant volume" early-return regardless of the
    // selectedBroker. Post-fix: single-broker mode bypasses the threshold
    // so the broker's bubbles still render.
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 100, buy: 3, sell: 0 }),
      mkTrade({ broker: "其他甲", broker_id: "X1", price: 100, buy: 1, sell: 1 }),
      mkTrade({ broker: "其他乙", broker_id: "X2", price: 100, buy: 1, sell: 1 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    expect(container.textContent).not.toContain("No significant volume");
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("low-volume day + selectedBroker NOT in trades → per-broker hint shown (not global empty-state)", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "其他甲", broker_id: "X1", price: 100, buy: 1, sell: 1 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="找不到的分點"
      />,
    );
    expect(container.textContent).toContain("找不到的分點 今日無顯著成交量");
    expect(container.textContent).not.toContain("No significant volume");
  });

});

describe("BubbleChartSvg F11 — filter hides non-matched bubbles; axes stay invariant", () => {
  // 🔴 Behavior change vs prior F2 single-broker filter: the user reported that
  // selecting a broker reshuffles the chart (bubble count drops AND remaining
  // bubbles reposition because axes rescale to the filtered subset). The new
  // contract is:
  //   1. Axes (and therefore pixel positions) are derived from the unfiltered
  //      `layoutTrades` regardless of the broker filter.
  //   2. When a filter is active, NON-matching bubbles are HIDDEN entirely —
  //      only the matched broker's bubbles render, at the SAME pixel positions
  //      they would have in the unfiltered view.
  it("filter renders ONLY the matched broker's bubbles, at the SAME positions as unfiltered", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "其他", broker_id: "X1", price: 100, buy: 100, sell: 0 }),
      mkTrade({ broker: "其他", broker_id: "X1", price: 99, buy: 0, sell: 50 }),
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 101, buy: 80, sell: 0 }),
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 102, buy: 40, sell: 0 }),
    ];

    const { container: unfiltered } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const unfilteredCircles = Array.from(unfiltered.querySelectorAll("circle"));
    // 4 trades, each contributing exactly one bubble (only buy>threshold or
    // only sell>threshold per row) → 4 bubbles total in the unfiltered view.
    expect(unfilteredCircles.length).toBe(4);

    // Snapshot the matched broker's bubble positions in the unfiltered view.
    const matchedUnfilteredPositions = unfilteredCircles
      .filter((c) => c.getAttribute("data-broker-id") === "9201A")
      .map(
        (c) =>
          `${c.getAttribute("cx")},${c.getAttribute("cy")},${c.getAttribute("r")}`,
      )
      .sort();
    expect(matchedUnfilteredPositions).toHaveLength(2);

    cleanup();

    const { container: filtered } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    const filteredCircles = Array.from(filtered.querySelectorAll("circle"));

    // Only the matched broker's bubbles remain on screen.
    expect(filteredCircles).toHaveLength(2);
    for (const c of filteredCircles) {
      expect(c.getAttribute("data-broker-id")).toBe("9201A");
    }

    // Pixel positions are IDENTICAL to the matched bubbles in the unfiltered
    // view — proves the axes did not rescale to the filtered subset.
    const matchedFilteredPositions = filteredCircles
      .map(
        (c) =>
          `${c.getAttribute("cx")},${c.getAttribute("cy")},${c.getAttribute("r")}`,
      )
      .sort();
    expect(matchedFilteredPositions).toEqual(matchedUnfilteredPositions);
  });

  it("filter targeting a broker not present in trades → 0 bubbles + per-broker hint", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "其他", broker_id: "X1", price: 100, buy: 100, sell: 0 }),
      mkTrade({ broker: "另一個", broker_id: "X2", price: 101, buy: 60, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="不存在的分點"
      />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.textContent).toContain("不存在的分點 今日無顯著成交量");
  });

  // F11.b — regression guard: previously, a normal-volume day with a sub-
  // threshold matched broker (or a matched broker outside the top-100
  // `layoutTrades` slice) would render 0 bubbles after filter because the
  // bubble loop iterated `layoutTrades` and gated by VOLUME_THRESHOLD. The
  // new contract is: once a broker filter is active, EVERY trade for that
  // broker renders — regardless of size or top-100 membership — so the user
  // always sees what they searched for. Axes still come from `layoutTrades`
  // so positions stay invariant.
  it("filter renders the matched broker even when their trades are sub-threshold", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "其他", broker_id: "X1", price: 100, buy: 200, sell: 0 }),
      // Matched broker has only a sub-threshold buy=3 (< VOLUME_THRESHOLD=5).
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 101, buy: 3, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    expect(circles).toHaveLength(1);
    expect(circles[0]!.getAttribute("data-broker-id")).toBe("9201A");
  });

  it("filter renders the matched broker even when they fall OUTSIDE the top-100 layout slice", () => {
    // Build a top-100 of larger brokers, then append one extra broker with
    // smaller (but still above-threshold) volume — they are excluded from
    // `layoutTrades` (top-100 by max(buy,sell)) but the filter must still
    // surface them.
    const trades: BrokerTrade[] = Array.from({ length: 100 }, (_, i) =>
      mkTrade({
        broker: `broker-${i}`,
        broker_id: `B${i}`,
        price: 100,
        buy: 1000 - i,
        sell: 0,
      }),
    );
    trades.push(
      mkTrade({
        broker: "目標分點",
        broker_id: "TARGET",
        price: 100,
        buy: 50,
        sell: 0,
      }),
    );

    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="目標分點"
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    expect(circles).toHaveLength(1);
    expect(circles[0]!.getAttribute("data-broker-id")).toBe("TARGET");
  });
});

// ---------------------------------------------------------------------------
// Intraday line overlay — additive optional prop (向下相容)
// ---------------------------------------------------------------------------

describe("BubbleChartSvg intraday line overlay (additive optional prop)", () => {
  const baseTrades: BrokerTrade[] = [
    mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
    mkTrade({ broker: "B", broker_id: "B1", price: 110, buy: 0, sell: 30 }),
  ];

  it("no intradayPoints prop → no polyline rendered (向下相容)", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={400} height={300} />,
    );
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector('[data-testid="intraday-line"]')).toBeNull();
  });

  it("intradayPoints=[] → no polyline (空 series 不畫)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={baseTrades}
        width={400}
        height={300}
        intradayPoints={[]}
      />,
    );
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("intradayPoints with data → polyline rendered with correct style", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={baseTrades}
        width={400}
        height={300}
        intradayPoints={[
          { t: "09:00", price: 105 },
          { t: "13:30", price: 108 },
        ]}
      />,
    );
    const line = container.querySelector('[data-testid="intraday-line"]');
    expect(line).not.toBeNull();
    expect(line!.getAttribute("stroke")).toBe("#7c6f55");
    expect(line!.getAttribute("stroke-width")).toBe("1");
    expect(line!.getAttribute("fill")).toBe("none");
  });

  it("crosshair group + 6 child elements exist, all opacity=0 by default (hidden)", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={400} height={300} />,
    );
    const g = container.querySelector('[data-testid="crosshair"]');
    expect(g).not.toBeNull();
    const lines = g!.querySelectorAll("line");
    const rects = g!.querySelectorAll("rect");
    const texts = g!.querySelectorAll("text");
    expect(lines).toHaveLength(2);   // V + H
    expect(rects).toHaveLength(2);   // X label bg + Y label bg
    expect(texts).toHaveLength(2);   // X label + Y label
    for (const el of [...Array.from(lines), ...Array.from(rects), ...Array.from(texts)]) {
      expect(el.getAttribute("opacity")).toBe("0");
    }
  });

  it("crosshair lines have dashed stroke + pointer-events none on parent group", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={400} height={300} />,
    );
    const g = container.querySelector('[data-testid="crosshair"]');
    expect(g!.getAttribute("pointer-events")).toBe("none");
    const lines = g!.querySelectorAll("line");
    for (const l of Array.from(lines)) {
      expect(l.getAttribute("stroke-dasharray")).toBe("4 3");
      expect(l.getAttribute("stroke-width")).toBe("1");
    }
  });

  it("bubble pixel positions are unchanged regardless of intradayPoints presence", () => {
    const { container: without } = render(
      <BubbleChartSvg trades={baseTrades} width={400} height={300} />,
    );
    const withoutPositions = Array.from(without.querySelectorAll("circle"))
      .map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")},${c.getAttribute("r")}`)
      .sort();

    cleanup();

    const { container: withPts } = render(
      <BubbleChartSvg
        trades={baseTrades}
        width={400}
        height={300}
        intradayPoints={[
          { t: "09:00", price: 105 },
          { t: "13:30", price: 108 },
        ]}
      />,
    );
    const withPositions = Array.from(withPts.querySelectorAll("circle"))
      .map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")},${c.getAttribute("r")}`)
      .sort();

    expect(withPositions).toEqual(withoutPositions);
  });
});

// C7 A1 (🟢): Y-axis brush overlay 交互驗證。
describe("BubbleChartSvg — A1 Y-axis brush overlay (C7 🟢)", () => {
  // jsdom pointer-capture 方法可能未實作。用 vi.spyOn 兜住,測試前設 stub。
  // hasPointerCapture 也 stub 讓 handleBrushUp §E-compliant guard 邏輯生效。
  function stubPointerCapture(el: Element) {
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

  const brushTrades: BrokerTrade[] = [
    { broker: "A", broker_id: "A1", price: 100, buy: 20, sell: 0 },
    { broker: "B", broker_id: "B1", price: 105, buy: 15, sell: 0 },
    { broker: "C", broker_id: "C1", price: 110, buy: 10, sell: 0 },
  ];

  it("Y-axis brush overlay 存在 (data-testid=bubble-yaxis-brush)", () => {
    const { container } = render(
      <BubbleChartSvg trades={brushTrades} width={400} height={300} onYBrush={vi.fn()} />,
    );
    const overlay = container.querySelector("[data-testid=bubble-yaxis-brush]");
    expect(overlay).toBeTruthy();
  });

  it("Y-axis brush drag (≥ 4px):onYBrush 被呼叫", () => {
    const onYBrush = vi.fn();
    const { container } = render(
      <BubbleChartSvg trades={brushTrades} width={400} height={300} onYBrush={onYBrush} />,
    );
    const overlay = container.querySelector("[data-testid=bubble-yaxis-brush]") as SVGRectElement;
    stubPointerCapture(overlay);
    fireEvent.pointerDown(overlay, { clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientY: 200, pointerId: 1 });
    expect(onYBrush).toHaveBeenCalledTimes(1);
    const [min, max] = onYBrush.mock.calls[0]!;
    expect(min).toBeLessThan(max);
  });

  it("Y-axis brush 單擊或短拖曳 (< 4px):onYBrush 不呼叫", () => {
    const onYBrush = vi.fn();
    const { container } = render(
      <BubbleChartSvg trades={brushTrades} width={400} height={300} onYBrush={onYBrush} />,
    );
    const overlay = container.querySelector("[data-testid=bubble-yaxis-brush]") as SVGRectElement;
    stubPointerCapture(overlay);
    // 單擊(down + up 同位置)
    fireEvent.pointerDown(overlay, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientY: 100, pointerId: 1 });
    expect(onYBrush).not.toHaveBeenCalled();
    // 3px 短拖曳
    fireEvent.pointerDown(overlay, { clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(overlay, { clientY: 102, pointerId: 2 });
    fireEvent.pointerUp(overlay, { clientY: 102, pointerId: 2 });
    expect(onYBrush).not.toHaveBeenCalled();
  });

  it("onYBrush 未 pass:brush overlay 仍存在但 pointer 事件無 side-effect", () => {
    const { container } = render(
      <BubbleChartSvg trades={brushTrades} width={400} height={300} />,
    );
    const overlay = container.querySelector("[data-testid=bubble-yaxis-brush]") as SVGRectElement;
    stubPointerCapture(overlay);
    expect(overlay).toBeTruthy();
    // 沒 onYBrush handleBrushDown early-return,不設 dragBrush,不會 throw
    fireEvent.pointerDown(overlay, { clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientY: 200, pointerId: 1 });
  });

  it("brushRange prop 傳入:persistent band 顯示 (data-testid=bubble-brush-band)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={brushTrades}
        width={400}
        height={300}
        brushRange={{ min: 102, max: 108 }}
      />,
    );
    expect(container.querySelector("[data-testid=bubble-brush-band]")).toBeTruthy();
  });

  it("brushRange=null:persistent band 不顯示", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={brushTrades}
        width={400}
        height={300}
        brushRange={null}
      />,
    );
    expect(container.querySelector("[data-testid=bubble-brush-band]")).toBeNull();
  });
});

// C10 (🔴 Item 3): priceRange 過濾 — 泡泡只 render 在 [min, max] 內,軸不變。
// 對齊 F11 axes-invariant 契約:filter 前後同一 broker id 的泡泡 cx/cy/r 一致,
// 只是區間外的被移除。
describe("BubbleChartSvg — C10 priceRange 過濾泡泡 (🔴 Item 3)", () => {
  const trades: BrokerTrade[] = [
    mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 80, sell: 0 }),
    mkTrade({ broker: "B", broker_id: "B1", price: 105, buy: 60, sell: 0 }),
    mkTrade({ broker: "C", broker_id: "C1", price: 110, buy: 40, sell: 0 }),
    mkTrade({ broker: "D", broker_id: "D1", price: 115, buy: 20, sell: 0 }),
  ];

  it("priceRange=[103,108] → 只留 price 在 [103,108] 內的 bubble", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        priceRange={{ min: 103, max: 108 }}
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    // 只有 B (price=105) 在 [103,108] 內
    expect(circles).toHaveLength(1);
    expect(circles[0]!.getAttribute("data-broker-id")).toBe("B1");
  });

  it("priceRange 過濾後 axes 位置不變(泡泡 cx/cy/r 跟未過濾同 broker 一致)", () => {
    const { container: unfiltered } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const bBubbleUnfiltered = Array.from(
      unfiltered.querySelectorAll("circle"),
    ).find((c) => c.getAttribute("data-broker-id") === "B1");
    expect(bBubbleUnfiltered).toBeTruthy();
    const posUnfiltered = [
      bBubbleUnfiltered!.getAttribute("cx"),
      bBubbleUnfiltered!.getAttribute("cy"),
      bBubbleUnfiltered!.getAttribute("r"),
    ].join(",");

    cleanup();

    const { container: filtered } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        priceRange={{ min: 103, max: 108 }}
      />,
    );
    const bBubbleFiltered = Array.from(
      filtered.querySelectorAll("circle"),
    ).find((c) => c.getAttribute("data-broker-id") === "B1");
    expect(bBubbleFiltered).toBeTruthy();
    const posFiltered = [
      bBubbleFiltered!.getAttribute("cx"),
      bBubbleFiltered!.getAttribute("cy"),
      bBubbleFiltered!.getAttribute("r"),
    ].join(",");

    // 軸不變 → 同一 broker 泡泡的 pixel 位置完全一致
    expect(posFiltered).toBe(posUnfiltered);
  });

  it("priceRange 內完全無成交 → 顯示 fallback 提示", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        priceRange={{ min: 200, max: 300 }}
      />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.textContent).toContain("此價位區間");
  });

  it("priceRange=null → 全 render(對齊 default)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        priceRange={null}
      />,
    );
    expect(container.querySelectorAll("circle").length).toBe(4);
  });

  // C11: 分點選擇 + brushRange 有效但 priceRange 傳 null(caller 決定停用 filter)
  //   → broker 的所有 bubble 全 render,不受 range 限制;brushRange 仍畫 band。
  it("selectedBroker + brushRange 有效 + priceRange=null → broker 全成交點顯示,band 保留", () => {
    const multi: BrokerTrade[] = [
      mkTrade({ broker: "X", broker_id: "X1", price: 100, buy: 50, sell: 0 }),
      mkTrade({ broker: "X", broker_id: "X1", price: 105, buy: 30, sell: 0 }),
      mkTrade({ broker: "X", broker_id: "X1", price: 110, buy: 20, sell: 0 }),
      mkTrade({ broker: "Y", broker_id: "Y1", price: 105, buy: 40, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={multi}
        width={400}
        height={300}
        selectedBroker="X"
        brushRange={{ min: 104, max: 106 }}
        priceRange={null}
      />,
    );
    // X 的三筆(價位 100 / 105 / 110)全 render,即使 brushRange 只涵蓋 105
    const bubbles = Array.from(container.querySelectorAll("circle")).filter(
      (c) => c.getAttribute("data-broker-id") === "X1",
    );
    expect(bubbles).toHaveLength(3);
    // brushRange band 仍在
    expect(container.querySelector("[data-testid=bubble-brush-band]")).toBeTruthy();
  });
});
