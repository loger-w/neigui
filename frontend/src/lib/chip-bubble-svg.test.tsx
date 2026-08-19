/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BROKER_PALETTE, BubbleChartSvg, buildVolumeProfile } from "./chip-bubble-svg";
import type { BubbleSelectedBroker } from "./chip-bubble-svg";
import type { BrokerTrade } from "./chip-data";

const sel = (id: string, name: string, colorIdx: number): BubbleSelectedBroker => ({
  id,
  name,
  colorIdx,
});

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
        selectedBrokers={[sel("9201A", "凱基台北", 0)]}
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
        selectedBrokers={[sel("9201A", "凱基台北", 0)]}
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
        selectedBrokers={[sel("NOPE", "找不到的分點", 0)]}
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
        selectedBrokers={[sel("9201A", "凱基台北", 0)]}
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
        selectedBrokers={[sel("MISSING", "不存在的分點", 0)]}
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
        selectedBrokers={[sel("9201A", "凱基台北", 0)]}
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
        selectedBrokers={[sel("TARGET", "目標分點", 0)]}
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

  it("quiet day + selectedBroker fallback 軸下 intraday line 用 broker 自身 price scale (F-P3-16)", () => {
    // 全 trades ≤ VOLUME_THRESHOLD → 全局軸空;selectedBroker 觸發 F2 fallback,
    // yLow/yHigh 從 broker A 自身資料(price 100 ± pad 1 → [99, 101])。
    // 若 fallback 軸沒接到 intraday layer,此情境根本是 HintSvg(無 polyline 可言)。
    const quiet: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 3, sell: 0 }),
      mkTrade({ broker: "B", broker_id: "B1", price: 500, buy: 4, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={quiet}
        width={400}
        height={300}
        selectedBrokers={[sel("A1", "A", 0)]}
        intradayPoints={[
          { t: "09:00", price: 100.5 },  // broker 軸 [99,101] 內 → 保留
          { t: "11:00", price: 100.8 },  // 內 → 保留
          { t: "13:30", price: 200 },    // 外(但在全局 [100,500] 內)→ clip
        ]}
      />,
    );
    const line = container.querySelector('[data-testid="intraday-line"]');
    expect(line).not.toBeNull();
    // 200 被 broker 軸 clip 掉 → 只剩 2 個座標;若誤用全局軸會是 3 個
    expect(line!.getAttribute("points")!.split(" ").length).toBe(2);
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
        selectedBrokers={[sel("X1", "X", 0)]}
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

describe("BubbleChartSvg — Y 軸拖曳篩選提示", () => {
  const trades: BrokerTrade[] = [
    mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
    mkTrade({ broker: "B", broker_id: "B1", price: 101, buy: 0, sell: 30 }),
  ];

  it("有 onYBrush(桌面)且無 brushRange 時顯示提示", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} onYBrush={() => {}} />,
    );
    const hint = container.querySelector('[data-testid="bubble-brush-hint"]');
    expect(hint).toBeTruthy();
    expect(hint!.textContent).toContain("拖曳");
  });

  it("無 onYBrush(mobile,brush 停用)時不顯示提示", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    expect(container.querySelector('[data-testid="bubble-brush-hint"]')).toBeNull();
  });

  it("已有 brushRange 時隱藏提示(避免與區間帶疊字)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        onYBrush={() => {}}
        brushRange={{ min: 99, max: 102 }}
      />,
    );
    expect(container.querySelector('[data-testid="bubble-brush-hint"]')).toBeNull();
  });
});

// SC-2(bubble-multi-broker):多選分點 union filter + per-broker 專屬色外框。
// 買賣 fill 維持紅買綠賣;外框只在 N ≥ 2 時切 BROKER_PALETTE(N = 1 維持現行
// COLOR stroke,SC-5 單選視覺零回歸)。
describe("BubbleChartSvg — 多選分點外框色 (SC-2)", () => {
  const trades: BrokerTrade[] = [
    mkTrade({ broker: "甲", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
    mkTrade({ broker: "乙", broker_id: "B1", price: 101, buy: 0, sell: 30 }),
    mkTrade({ broker: "丙", broker_id: "C1", price: 102, buy: 40, sell: 0 }),
  ];

  it("BROKER_PALETTE 有 6 色且不含買賣紅綠(多空色相保留)", () => {
    expect(BROKER_PALETTE).toHaveLength(6);
    expect(BROKER_PALETTE).not.toContain("#e85a4f");
    expect(BROKER_PALETTE).not.toContain("#7fc99a");
  });

  it("選 2 個分點 → 兩分點的泡泡都 render,外框分別為 PALETTE[colorIdx]、寬 2", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBrokers={[sel("A1", "甲", 0), sel("C1", "丙", 2)]}
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    const byId = (id: string) =>
      circles.filter((c) => c.getAttribute("data-broker-id") === id);
    expect(byId("A1")).toHaveLength(1);
    expect(byId("C1")).toHaveLength(1);
    expect(byId("B1")).toHaveLength(0); // 未選中不 render(union filter)
    // 正向 assertion:外框 = 各自 colorIdx 對應的 palette 色
    expect(byId("A1")[0]!.getAttribute("stroke")).toBe(BROKER_PALETTE[0]);
    expect(byId("C1")[0]!.getAttribute("stroke")).toBe(BROKER_PALETTE[2]);
    expect(byId("A1")[0]!.getAttribute("stroke-width")).toBe("2");
    expect(byId("C1")[0]!.getAttribute("stroke-width")).toBe("2");
    // fill 維持買賣色(甲是買方紅、丙是買方紅 — 皆非 palette 色)
    expect(byId("A1")[0]!.getAttribute("fill")).toBe("rgba(232, 90, 79, 0.45)");
  });

  it("只選 1 個分點 → 外框維持現行買賣 stroke(無 palette 色)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBrokers={[sel("A1", "甲", 0)]}
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    expect(circles).toHaveLength(1);
    expect(circles[0]!.getAttribute("stroke")).toBe("#e85a4f"); // COLOR.buyStroke
    expect(circles[0]!.getAttribute("stroke-width")).not.toBe("2");
  });

  it("選 2 個皆無成交的分點 → 複數空狀態 hint「選中分點今日無顯著成交量」", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBrokers={[sel("NOPE1", "沒有甲", 0), sel("NOPE2", "沒有乙", 1)]}
      />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.textContent).toContain("選中分點今日無顯著成交量");
  });

  it("空陣列 selectedBrokers → 等同未選取(全體 top-100 render)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBrokers={[]}
      />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });
});
// mod/bubble-chart-ux-polish SC-3:單看泡泡聚焦外框(soloBrokerId)。
describe("BubbleChartSvg — soloBrokerId 聚焦外框 (SC-3)", () => {
  const twoSelectedTrades: BrokerTrade[] = [
    mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
    mkTrade({ broker: "B", broker_id: "B1", price: 100, buy: 30, sell: 0 }),
  ];
  const twoSelected = [sel("A1", "A", 0), sel("B1", "B", 1)];

  // 痛點:單看的圖面錨點 — 命中分點 ink 外框 + painter's order 排最後
  // (review R6-1:重合泡泡下 ring 否則被後繪 palette 框遮蓋)。
  it("命中分點 circle 帶 data-solo + ink stroke 2.5,且 render 於所有非 solo 泡泡之後", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={twoSelectedTrades}
        width={400}
        height={300}
        selectedBrokers={twoSelected}
        soloBrokerId="A1"
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    const soloFlags = circles.map((c) => c.getAttribute("data-solo") === "true");
    const soloCircles = circles.filter((_, i) => soloFlags[i]);
    expect(soloCircles.length).toBeGreaterThan(0);
    for (const c of soloCircles) {
      expect(c.getAttribute("data-broker-id")).toBe("A1");
      expect((c.getAttribute("stroke") ?? "").toLowerCase()).toBe("#ede4d3");
      expect(c.getAttribute("stroke-width")).toBe("2.5");
    }
    // painter's order:第一個 solo 必在最後一個非 solo 之後
    expect(soloFlags.indexOf(true)).toBeGreaterThan(soloFlags.lastIndexOf(false));
    // 非 solo 的選中泡泡維持 palette 外框(identity encoding 不動)
    const b1 = circles.find((c) => c.getAttribute("data-broker-id") === "B1")!;
    expect(b1.getAttribute("stroke")).toBe(BROKER_PALETTE[1]);
  });

  // 痛點:optional prop 向下相容 — 不傳 / null 輸出與現行為完全一致。
  it("soloBrokerId 未提供 / null → 無 data-solo,輸出一致", () => {
    const base = {
      trades: twoSelectedTrades,
      width: 400,
      height: 300,
      selectedBrokers: twoSelected,
    };
    const { container: a } = render(<BubbleChartSvg {...base} />);
    const { container: b } = render(<BubbleChartSvg {...base} soloBrokerId={null} />);
    expect(a.querySelector("svg")!.outerHTML).toBe(b.querySelector("svg")!.outerHTML);
    expect(a.querySelector("[data-solo]")).toBeNull();
  });
});

// feat/bubble-volume-profile:每價位量能分布背景層(volume profile)。
// SC-1 圖內水平條 / SC-2 不影響互動 / SC-3 恆全量計算不隨過濾變。
describe("buildVolumeProfile — 每價位總量聚合 (SC-1)", () => {
  // 痛點:分點資料買賣雙邊各 ≈ 該價位總成交量,(Σbuy+Σsell)/2 是不偏估計;
  // 直接加總會虛報兩倍。
  it("同價位跨分點聚合,volume = (Σbuy+Σsell)/2,價位由高到低排序", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 60, sell: 40 }),
      mkTrade({ broker: "B", broker_id: "B1", price: 100, buy: 40, sell: 60 }),
      mkTrade({ broker: "C", broker_id: "C1", price: 99, buy: 10, sell: 0 }),
    ];
    expect(buildVolumeProfile(trades)).toEqual([
      { price: 100, volume: 100 },
      { price: 99, volume: 5 },
    ]);
  });

  it("空 trades → 空陣列", () => {
    expect(buildVolumeProfile([])).toEqual([]);
  });
});

describe("BubbleChartSvg — 每價位量能分布背景層 (SC-1/2/3)", () => {
  const trades: BrokerTrade[] = [
    mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 100, sell: 100 }),
    mkTrade({ broker: "B", broker_id: "B1", price: 105, buy: 50, sell: 50 }),
  ];

  it("SC-1: 每個價位一條 rect,長度 ∝ 總量,錨定左緣", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const layer = container.querySelector('[data-testid="bubble-volume-profile"]');
    expect(layer).not.toBeNull();
    const bars = Array.from(layer!.querySelectorAll("rect"));
    expect(bars).toHaveLength(2); // 兩個相異價位
    // 全部錨定 x = PADDING.left(56)
    for (const b of bars) expect(b.getAttribute("x")).toBe("56");
    // 長度比例:price 100 量 100 vs price 105 量 50 → 寬度比 2:1
    const widthByY = bars
      .map((b) => ({ y: Number(b.getAttribute("y")), w: Number(b.getAttribute("width")) }))
      .sort((a, b) => a.y - b.y); // y 小 = 價高(105)在前
    expect(widthByY[1]!.w / widthByY[0]!.w).toBeCloseTo(2, 5);
    // [lock S-P1-1] 最大條寬 = cW × 20% 絕對值:(400-56-16) × 0.2 = 65.6。
    // 只鎖比例的話 PROFILE_MAX_FRAC 改 0.8(壓過泡泡主體)測試照樣綠。
    expect(widthByY[1]!.w).toBeCloseTo(65.6, 5);
    expect(widthByY[0]!.w).toBeCloseTo(32.8, 5);
  });

  // [lock S-P1-2] 大量價位(60 檔)下條高公式 min(8, max(1, cH/n×0.7)) 的
  // 密度分支從未被 1-2 價位的測試執行到 — 鎖住高度區間與不重疊。
  it("edge: 60 檔價位 → 60 條、高度在 [1,8]、相鄰不重疊", () => {
    const dense: BrokerTrade[] = Array.from({ length: 60 }, (_, i) =>
      mkTrade({
        broker: `b${i}`,
        broker_id: `B${i}`,
        price: 100 + i,
        buy: 50,
        sell: 50,
      }),
    );
    const { container } = render(
      <BubbleChartSvg trades={dense} width={400} height={300} />,
    );
    const bars = Array.from(
      container.querySelectorAll('[data-testid="bubble-volume-profile"] rect'),
    )
      .map((b) => ({
        y: Number(b.getAttribute("y")),
        h: Number(b.getAttribute("height")),
      }))
      .sort((a, b) => a.y - b.y);
    expect(bars).toHaveLength(60);
    for (const b of bars) {
      expect(b.h).toBeGreaterThanOrEqual(1);
      expect(b.h).toBeLessThanOrEqual(8);
    }
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.y).toBeGreaterThanOrEqual(bars[i - 1]!.y + bars[i - 1]!.h);
    }
  });

  it("SC-1: 條垂直置中對齊該價位的 sY(與同價位泡泡 cy 一致)", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const bubble100 = Array.from(container.querySelectorAll("circle")).find(
      (c) => c.getAttribute("data-broker-id") === "A1",
    )!;
    const cy = Number(bubble100.getAttribute("cy"));
    const bars = Array.from(
      container.querySelectorAll('[data-testid="bubble-volume-profile"] rect'),
    );
    const centers = bars.map(
      (b) => Number(b.getAttribute("y")) + Number(b.getAttribute("height")) / 2,
    );
    expect(centers.some((c) => Math.abs(c - cy) < 0.01)).toBe(true);
  });

  it("SC-1: z-order — 量能層繪於泡泡之前(DOM 序在第一個 circle 前)", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const svg = container.querySelector("svg")!;
    const all = Array.from(svg.querySelectorAll("*"));
    const layerIdx = all.findIndex(
      (el) => el.getAttribute("data-testid") === "bubble-volume-profile",
    );
    const firstCircleIdx = all.findIndex((el) => el.tagName === "circle");
    expect(layerIdx).toBeGreaterThanOrEqual(0);
    expect(layerIdx).toBeLessThan(firstCircleIdx);
  });

  it("SC-2: 量能層 pointer-events=none,且不用紅綠/accent 色", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const layer = container.querySelector('[data-testid="bubble-volume-profile"]')!;
    expect(layer.getAttribute("pointer-events")).toBe("none");
    for (const b of Array.from(layer.querySelectorAll("rect"))) {
      const fill = (b.getAttribute("fill") ?? "").toLowerCase();
      expect(fill).not.toContain("232, 90, 79"); // bull 紅 rgba
      expect(fill).not.toContain("127, 201, 154"); // bear 綠 rgba
      expect(fill).not.toBe("#e85a4f");
      expect(fill).not.toBe("#7fc99a");
    }
  });

  it("SC-3: selectedBrokers / priceRange 過濾下,量能條完全不變(恆全量)", () => {
    const snapshot = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('[data-testid="bubble-volume-profile"] rect'))
        .map(
          (b) =>
            `${b.getAttribute("x")},${b.getAttribute("y")},${b.getAttribute("width")},${b.getAttribute("height")}`,
        )
        .sort();

    const { container: base } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    const baseBars = snapshot(base);
    expect(baseBars).toHaveLength(2);

    cleanup();
    const { container: withSel } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBrokers={[sel("A1", "A", 0)]}
      />,
    );
    expect(snapshot(withSel)).toEqual(baseBars);

    cleanup();
    const { container: withRange } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        priceRange={{ min: 99, max: 101 }}
      />,
    );
    expect(snapshot(withRange)).toEqual(baseBars);
  });

  // 痛點:F2 broker-axes fallback(安靜日 + 選取)時 y-scale 只涵蓋該分點
  // 價位 — 全量 profile 中越界價位必須跳過,不畫出圖外。
  // [amendment S-P2-1] 比例分母恆用全量 max:clip 只決定畫不畫,存活條不得
  // 被拉伸成滿格(price 100 量 1.5 / 全量 max 2 → 寬 = 0.75 × maxBarW)。
  it("edge: broker-axes fallback 下,只畫 y-range 內價位條,且分母仍為全量 max", () => {
    const quiet: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 3, sell: 0 }),
      mkTrade({ broker: "B", broker_id: "B1", price: 500, buy: 4, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={quiet}
        width={400}
        height={300}
        selectedBrokers={[sel("A1", "A", 0)]}
      />,
    );
    // broker 軸 [99,101]:price 500 越界 → 只剩 price 100 一條
    const bars = container.querySelectorAll(
      '[data-testid="bubble-volume-profile"] rect',
    );
    expect(bars).toHaveLength(1);
    // maxBarW = (400-56-16) × 0.2 = 65.6;vol 1.5 / 全量 max 2 = 0.75
    expect(Number(bars[0]!.getAttribute("width"))).toBeCloseTo(65.6 * 0.75, 5);
  });

  // [amendment C-P2-1] 邊界價位的條(sY ± barH/2)必須整條落在 chart 內區,
  // 不得半截畫進上下 padding / 刻度帶。height=80(cH=36)時 min/max 價位的
  // 條若不 clamp 會上下各溢出 ~1.5px。
  it("edge: 條繪製範圍 clamp 進 chart 內區(小圖高不溢出上下邊界)", () => {
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={80} />,
    );
    const bars = Array.from(
      container.querySelectorAll('[data-testid="bubble-volume-profile"] rect'),
    );
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      const y = Number(b.getAttribute("y"));
      const h = Number(b.getAttribute("height"));
      expect(y).toBeGreaterThanOrEqual(12); // PADDING.top
      expect(y + h).toBeLessThanOrEqual(80 - 32); // height - PADDING.bottom
    }
  });

  it("edge: 單一價位 → 1 條,寬度 > 0(無除零)", () => {
    const single: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 80, sell: 20 }),
    ];
    const { container } = render(
      <BubbleChartSvg trades={single} width={400} height={300} />,
    );
    const bars = Array.from(
      container.querySelectorAll('[data-testid="bubble-volume-profile"] rect'),
    );
    expect(bars).toHaveLength(1);
    expect(Number(bars[0]!.getAttribute("width"))).toBeGreaterThan(0);
  });
});

// [review-1 COPY-DAY-SCOPED-EMPTY-HINT / SC5-COPY-TODAY-LEFTOVER]
// 痛點:SC-5 文案分流只改了 ChipBubbleView 的統計行與聚焦 badge,圖面空狀態
// 仍寫死「今日」。多日模式下選到一個近 N 日都沒成交的分點,畫面會說
// 「XX 今日無顯著成交量」—— 與 header「近 5 日共」互相打臉。
// days=1(不傳 / 傳 1)的字串必須 bit-for-bit 不變(白名單 1)。
describe("BubbleChartSvg — days-scoped 空狀態文案", () => {
  const subThreshold: BrokerTrade[] = [
    mkTrade({ broker: "其他甲", broker_id: "X1", price: 100, buy: 1, sell: 1 }),
  ];
  const significant: BrokerTrade[] = [
    mkTrade({ broker: "甲", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
    mkTrade({ broker: "乙", broker_id: "B1", price: 101, buy: 0, sell: 30 }),
  ];

  it("days 未傳 → 單選空狀態維持「今日無顯著成交量」(白名單:字串不變)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={subThreshold}
        width={400}
        height={300}
        selectedBrokers={[sel("NOPE", "找不到的分點", 0)]}
      />,
    );
    expect(container.textContent).toContain("找不到的分點 今日無顯著成交量");
  });

  it("days=1 → 與未傳 days 同字串", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={subThreshold}
        width={400}
        height={300}
        days={1}
        selectedBrokers={[sel("NOPE", "找不到的分點", 0)]}
      />,
    );
    expect(container.textContent).toContain("找不到的分點 今日無顯著成交量");
    expect(container.textContent).not.toContain("近 1 日");
  });

  it("days=5 單選 → 「XX 近 5 日無顯著成交量」(HintSvg 路徑)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={subThreshold}
        width={400}
        height={300}
        days={5}
        selectedBrokers={[sel("NOPE", "找不到的分點", 0)]}
      />,
    );
    expect(container.textContent).toContain("找不到的分點 近 5 日無顯著成交量");
    expect(container.textContent).not.toContain("今日無顯著成交量");
  });

  it("days=5 多選 → 「選中分點近 5 日無顯著成交量」(HintSvg 路徑)", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={subThreshold}
        width={400}
        height={300}
        days={5}
        selectedBrokers={[sel("NOPE1", "沒有甲", 0), sel("NOPE2", "沒有乙", 1)]}
      />,
    );
    expect(container.textContent).toContain("選中分點近 5 日無顯著成交量");
    expect(container.textContent).not.toContain("今日");
  });

  it("days=20 單選 + 有量的圖面(inline <text> 路徑)→ 同樣走多日文案", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={significant}
        width={400}
        height={300}
        days={20}
        selectedBrokers={[sel("NOPE", "找不到的分點", 0)]}
      />,
    );
    // 圖有量(軸畫得出來)但選中分點無泡泡 → 走 bubbles.length === 0 的 <text>
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.textContent).toContain("找不到的分點 近 20 日無顯著成交量");
    expect(container.textContent).not.toContain("今日");
  });
});

// ---------------------------------------------------------------------------
// SC-4(mod/kline-date-bubble-days-ux):多日每欄開 / 收標示 — additive optional prop
// ---------------------------------------------------------------------------

describe("BubbleChartSvg dayMarks 每日開收層(SC-4)", () => {
  const baseTrades: BrokerTrade[] = [
    mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
    mkTrade({ broker: "B", broker_id: "B1", price: 110, buy: 0, sell: 30 }),
  ];
  const dates = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"];
  const candles = dates.map((date, i) => ({
    date, open: 102 + i * 0.5, high: 108, low: 100, close: 104 + i * 0.5, volume: 1000,
  }));
  const marks = { dates, candles };

  it("未傳 dayMarks → 不畫日期欄(向下相容 W2)", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} />,
    );
    expect(container.querySelector('[data-testid="bubble-day-marks"]')).toBeNull();
  });

  it("dayMarks=null → 不畫(history 尚未回)", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} dayMarks={null} />,
    );
    expect(container.querySelector('[data-testid="bubble-day-marks"]')).toBeNull();
  });

  it("days=1 + dayMarks 有值 → 完全不畫(W2 單日行為 bit-for-bit)", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={1} dayMarks={marks} />,
    );
    expect(container.querySelector('[data-testid="bubble-day-marks"]')).toBeNull();
  });

  it("dates 為空陣列 → 不畫", () => {
    const { container } = render(
      <BubbleChartSvg
        trades={baseTrades} width={600} height={400} days={5}
        dayMarks={{ dates: [], candles: [] }}
      />,
    );
    expect(container.querySelector('[data-testid="bubble-day-marks"]')).toBeNull();
  });

  it("days=5 + dayMarks → group 內 5 個 [data-date]", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} dayMarks={marks} />,
    );
    const g = container.querySelector('[data-testid="bubble-day-marks"]');
    expect(g).not.toBeNull();
    expect(g!.querySelectorAll("[data-date]")).toHaveLength(5);
    expect(g!.getAttribute("pointer-events")).toBe("none");
  });

  // [review F6] 日期標籤上浮到泡泡之後:最低價附近的泡泡原本會整片蓋掉日期。
  // 順序 profile → day-marks(K 身)→ circles → day-marks-dates。
  it("z-order:volume profile → 每日開收 → 泡泡 → 日期標籤", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} dayMarks={marks} />,
    );
    const profile = container.querySelector('[data-testid="bubble-volume-profile"]')!;
    const marksG = container.querySelector('[data-testid="bubble-day-marks"]')!;
    const circles = container.querySelector('[data-testid="bubble-circles"]')!;
    const datesG = container.querySelector('[data-testid="bubble-day-marks-dates"]')!;
    expect(profile).not.toBeNull();
    expect(datesG).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING = 4:後者在 DOM 順序上位於前者之後
    expect(profile.compareDocumentPosition(marksG) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(marksG.compareDocumentPosition(circles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(circles.compareDocumentPosition(datesG) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("[review F6] 日期標籤層帶 pointer-events none 且含每欄日期文字", () => {
    const { container } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} dayMarks={marks} />,
    );
    const datesG = container.querySelector('[data-testid="bubble-day-marks-dates"]')!;
    expect(datesG.getAttribute("pointer-events")).toBe("none");
    expect(datesG.textContent).toContain("6/26");
  });

  it("[review F6] 未傳 dayMarks / days=1 → 日期標籤層也不畫", () => {
    const { container: a } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} />,
    );
    expect(a.querySelector('[data-testid="bubble-day-marks-dates"]')).toBeNull();
    cleanup();
    const { container: b } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={1} dayMarks={marks} />,
    );
    expect(b.querySelector('[data-testid="bubble-day-marks-dates"]')).toBeNull();
  });

  it("bubble 像素位置不因 dayMarks 有無而改變(W2)", () => {
    const { container: without } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} />,
    );
    const withoutPositions = Array.from(without.querySelectorAll('[data-testid="bubble-circles"] circle'))
      .map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")},${c.getAttribute("r")}`)
      .sort();
    expect(withoutPositions.length).toBeGreaterThan(0);

    cleanup();

    const { container: withMarks } = render(
      <BubbleChartSvg trades={baseTrades} width={600} height={400} days={5} dayMarks={marks} />,
    );
    const withPositions = Array.from(withMarks.querySelectorAll('[data-testid="bubble-circles"] circle'))
      .map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")},${c.getAttribute("r")}`)
      .sort();
    expect(withPositions).toEqual(withoutPositions);
  });
});
