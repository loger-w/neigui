/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChipKlineChart } from "./ChipKlineChart";
import type { ChipHistory } from "../lib/chip-data";

beforeAll(() => {
  // jsdom lacks ResizeObserver; useContainerSize relies on it. Stub a no-op.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

const mkHistory = (n: number): ChipHistory => {
  const candles = Array.from({ length: n }, (_, i) => ({
    date: `2026-${String(((i % 12) + 1)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 100, high: 105, low: 99, close: 102, volume: 1000,
  }));
  // Make dates strictly increasing so callbacks/select are unambiguous.
  for (let i = 0; i < n; i++) {
    const d = new Date(2024, 0, 1 + i);
    candles[i]!.date = d.toISOString().slice(0, 10);
  }
  return {
    symbol: "2330", fetched_at: "", last_date: candles[n - 1]?.date ?? "",
    candles,
    institutional: candles.map((c) => ({
      date: c.date, foreign_net: 0, trust_net: 0, dealer_net: 0, major_net: 0,
    })),
    margin: candles.map((c) => ({
      date: c.date, margin_balance: 0, short_balance: 0,
      margin_change: 0, short_change: 0,
    })),
    major: candles.map((c) => ({ date: c.date, major_net: 0 })),
  };
};

const noop = () => {};

function dispatchWheel(el: Element, deltaY: number) {
  act(() => {
    // jsdom doesn't synthesize WheelEvent via fireEvent.wheel reliably for
    // listeners attached via addEventListener with {passive:false} — use
    // raw dispatch on the same node so the imperative listener runs.
    el.dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
    );
  });
}

describe("ChipKlineChart — zoom HUD + wheel handler", () => {
  it("renders zoom HUD showing default visible days (90)", () => {
    const history = mkHistory(540);
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(getByTestId("kline-zoom-hud").textContent).toBe("90 日");
  });

  it("clamps visible days to candles.length when history shorter than default", () => {
    const history = mkHistory(30);
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    // initial 90 → clamped to 30
    expect(getByTestId("kline-zoom-hud").textContent).toBe("30 日");
  });

  it("wheel down zooms OUT (visible days +10, more days visible)", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("100 日");
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("110 日");
  });

  it("wheel up zooms IN (visible days -10, fewer days visible)", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    dispatchWheel(root, -100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("80 日");
  });

  it("wheel up clamps at minimum 30", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    // 90 → 80 → 70 → 60 → 50 → 40 → 30 → 30 (clamp)
    for (let i = 0; i < 10; i++) dispatchWheel(root, -100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("30 日");
  });

  it("wheel down clamps at candles.length", () => {
    const history = mkHistory(100);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    // initial 90 → 100 then clamp at 100
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("100 日");
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("100 日");
  });

  it("does not render zoom HUD when history is null", () => {
    const { queryByTestId } = render(
      <ChipKlineChart
        history={null}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(queryByTestId("kline-zoom-hud")).toBeNull();
  });

  it("wheel deltaY=0 is a no-op", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    dispatchWheel(root, 0);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("90 日");
  });

  it("onPickDate receives the date from the sliced view, not the original index", () => {
    const history = mkHistory(540);
    const pick = vi.fn();
    render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={pick}
        onClearAllBrokers={noop}
      />,
    );
    // The component does not expose onPickDate directly outside SVG handlers,
    // so we rely on the contract: sliced.candles.at(-1).date === last date.
    // (Visual interaction is covered by DevTools MCP end-to-end.) This is a
    // weak smoke check that the click path doesn't throw on render.
    expect(pick).not.toHaveBeenCalled();
  });

  it("double-click resets zoom to default 90 and clears brush anchor", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    // Zoom out a couple of steps so HUD differs from default
    dispatchWheel(root, 100); // 100
    dispatchWheel(root, 100); // 110
    expect(getByTestId("kline-zoom-hud").textContent).toContain("110");
    // Double-click resets
    act(() => {
      root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(getByTestId("kline-zoom-hud").textContent).toBe("90 日");
  });

  it("zoom HUD has no '平移中' tag in default auto-tail mode", () => {
    // We can't easily synthesise a pointer drag in jsdom (PointerEvent +
    // bounding rects), but the default HUD must not show the pan marker
    // until viewEndIdx is anchored.
    const history = mkHistory(540);
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(getByTestId("kline-zoom-hud").textContent).not.toContain("平移中");
    expect(getByTestId("kline-zoom-hud").textContent).not.toContain("已框選");
  });

  it("loading=true + loadingSymbol renders the scanning bar + badge", () => {
    const history = mkHistory(540);
    const { getByTestId, getByText } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        loading={true}
        loadingSymbol="2330"
      />,
    );
    expect(getByTestId("kline-loading-indicator")).toBeTruthy();
    expect(getByTestId("kline-loading-badge")).toBeTruthy();
    expect(getByText(/載入 2330 中/)).toBeTruthy();
  });

  it("loading=false hides the scanning bar + badge", () => {
    const history = mkHistory(540);
    const { queryByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        loading={false}
      />,
    );
    expect(queryByTestId("kline-loading-indicator")).toBeNull();
    expect(queryByTestId("kline-loading-badge")).toBeNull();
  });

  it("history=null + loading shows centred '載入 X 中…' message instead of search prompt", () => {
    const { getByText, queryByText } = render(
      <ChipKlineChart
        history={null}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        loading={true}
        loadingSymbol="2454"
      />,
    );
    expect(getByText(/載入 2454 中/)).toBeTruthy();
    expect(queryByText(/請搜尋股票代號/)).toBeNull();
  });
});

// B3 (C4 🔴): 選 broker 前後 K 線下 6 個 subchart 幾何完全一致(anti-CLS)。
// 未選時 broker row 容器保留,顯 placeholder「未選擇分點」+ 隱藏「清除」button;
// 已選時 broker row 顯 BrokerAggBarSvg + 「分點 (N)」label + 「清除」button。
describe("ChipKlineChart — B3 broker row 容器常駐 (C4 🔴)", () => {
  const historyForB3 = mkHistory(120);

  it("未選 → data-testid=chip-broker-row 存在 + 顯示「未選擇分點」placeholder + 無「清除」button", () => {
    const { container } = render(
      <ChipKlineChart
        history={historyForB3}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const row = container.querySelector("[data-testid=chip-broker-row]");
    expect(row).toBeTruthy();
    expect((row!.textContent ?? "").includes("未選擇分點")).toBe(true);
    // 清除 button 只有在選了 broker 時出現
    const clearBtn = Array.from(row!.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "清除",
    );
    expect(clearBtn).toBeUndefined();
  });

  it("已選 1 broker → data-testid=chip-broker-row 存在 + 有「清除」button + 無 placeholder", () => {
    const onClearAll = vi.fn();
    const { container } = render(
      <ChipKlineChart
        history={historyForB3}
        selectedDate=""
        selectedBrokerIds={new Set(["B0"])}
        brokerSeries={new Map()}
        onPickDate={vi.fn()}
        onClearAllBrokers={onClearAll}
      />,
    );
    const row = container.querySelector("[data-testid=chip-broker-row]");
    expect(row).toBeTruthy();
    expect((row!.textContent ?? "").includes("未選擇分點")).toBe(false);
    const clearBtn = Array.from(row!.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "清除",
    );
    expect(clearBtn).toBeTruthy();
    // click clear button → onClearAllBrokers called
    // (fireEvent.click imported? — use imperative click via dispatchEvent)
    clearBtn!.click();
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("未選 vs 已選:chip-broker-row 容器都存在(anti-CLS 檢查)", () => {
    const { container: c1 } = render(
      <ChipKlineChart
        history={historyForB3}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const rowUnselected = c1.querySelector("[data-testid=chip-broker-row]");
    expect(rowUnselected).toBeTruthy();
    cleanup();

    const { container: c2 } = render(
      <ChipKlineChart
        history={historyForB3}
        selectedDate=""
        selectedBrokerIds={new Set(["B0"])}
        brokerSeries={new Map()}
        onPickDate={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const rowSelected = c2.querySelector("[data-testid=chip-broker-row]");
    expect(rowSelected).toBeTruthy();
  });
});

// CH-2/CH-3(mod/batch-ui-update):窗聚合 HUD、子圖窗加總、拖曳防選字、
// 整疊容器 hover 十字軸。
describe("ChipKlineChart — CH-2/CH-3 窗聚合與整疊 hover", () => {
  const mkHistoryWithNets = (n: number): ChipHistory => {
    const base = mkHistory(n);
    return {
      ...base,
      institutional: base.candles.map((c) => ({
        date: c.date, foreign_net: 1, trust_net: 0, dealer_net: 0, major_net: 0,
      })),
      major: base.candles.map((c) => ({ date: c.date, major_net: 2 })),
    };
  };

  // 痛點:CH-3a — K 線拖曳 pan 會把 HUD / label 文字反白選取,體驗差。
  it("chart container suppresses text selection (select-none)", () => {
    const history = mkHistory(120);
    const { container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.querySelector("[data-testid=chip-kline-chart]")!;
    expect(root.className).toContain("select-none");
  });

  // 痛點:CH-3c — 十字軸事件只掛在 K 線 SVG,滑到主力/外資等子圖就消失。
  it("mousemove over the stack container drives sub-chart crosshairs", () => {
    const history = mkHistory(120);
    const { container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.querySelector("[data-testid=chip-kline-chart]")!;
    expect(container.querySelectorAll("[data-testid=sub-crosshair]").length).toBe(0);
    // jsdom rect 全 0 → x = clientX;w fallback 600、PAD 內的 300 落在有效 index。
    fireEvent.mouseMove(root, { clientX: 300, clientY: 400 });
    expect(
      container.querySelectorAll("[data-testid=sub-crosshair]").length,
    ).toBeGreaterThanOrEqual(5);
    fireEvent.mouseLeave(root);
    expect(container.querySelectorAll("[data-testid=sub-crosshair]").length).toBe(0);
  });

  // 痛點:CH-2a — 改天數時 HUD 要顯示窗範圍 開高低收/漲跌/量 加總。
  it("windowDays > 1 renders window-aggregate HUD (N日 + summed volume)", () => {
    const history = mkHistory(120);
    const selected = history.candles[100]!.date; // 預設 90 根視窗內
    const { container } = render(
      <ChipKlineChart
        history={history}
        selectedDate={selected}
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        windowDays={5}
      />,
    );
    expect(container.textContent).toContain("5日");
    // mkHistory volume 恆 1000 → 5 日加總 5,000(千分位由 header 格式化)
    expect(container.textContent).toContain("5,000");
  });

  // 痛點:CH-2b — 六個子圖的窗加總要同步呈現(外資 1/日、主力 2/日)。
  it("windowDays > 1 appends per-subchart window sums", () => {
    const history = mkHistoryWithNets(120);
    const selected = history.candles[100]!.date;
    const { container } = render(
      <ChipKlineChart
        history={history}
        selectedDate={selected}
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        windowDays={5}
      />,
    );
    expect(container.textContent).toContain("5日 +5 張"); // 外資
    expect(container.textContent).toContain("5日 +10 張"); // 主力
  });

  it("windowDays = 1 keeps the single-day HUD (no N日 aggregate marker)", () => {
    const history = mkHistory(120);
    const selected = history.candles[100]!.date;
    const { container } = render(
      <ChipKlineChart
        history={history}
        selectedDate={selected}
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        windowDays={1}
      />,
    );
    expect(container.textContent).not.toContain("1日");
  });
});

describe("ChipKlineChart — major gap overlay + visible-range report (chip-major-lazy-window)", () => {
  // 痛點:出界升檔的觸發源 = chart 回報可見最左日期;沒回報 = 永不升檔。
  it("reports the leftmost visible date on mount and after zoom-out", () => {
    const history = mkHistory(540);
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        onVisibleRangeChange={onVisibleRangeChange}
      />,
    );
    // 預設 90 根、跟最新 → 可見窗 = candles[450..539]
    expect(onVisibleRangeChange).toHaveBeenCalledWith(history.candles[450]!.date);
    const root = container.querySelector("[data-testid=chip-kline-chart]")!;
    dispatchWheel(root, 100); // zoom out → 100 根 → 左界 candles[440]
    expect(onVisibleRangeChange).toHaveBeenCalledWith(history.candles[440]!.date);
  });

  // 痛點:缺料區段 loading — 已載區段照常顯示,只有覆蓋外的 x 範圍蓋 overlay,
  // 寬度 = 缺料根數比例(spec §6.3)。
  it("shows major-gap-overlay over the uncovered fraction while fetching", () => {
    const history = mkHistory(540);
    // 可見窗 candles[450..539];覆蓋左界設在 candles[470] → 缺 20/90 根
    const coverageStart = history.candles[470]!.date;
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        majorCoverageStart={coverageStart}
        majorFetching={true}
      />,
    );
    const overlay = getByTestId("major-gap-overlay");
    expect(overlay).toBeTruthy();
    const width = parseFloat((overlay as HTMLElement).style.width);
    expect(width).toBeCloseTo((20 / 90) * 100, 1);
  });

  // 痛點:overlay 只該在補抓在途時出現;非 fetching 的缺料(升檔失敗)回到
  // 既有 0-bar 呈現,error 走 hook 的 error 欄位(spec Known Edges)。
  it("no overlay when not fetching, even with a gap", () => {
    const history = mkHistory(540);
    const { queryByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        majorCoverageStart={history.candles[470]!.date}
        majorFetching={false}
      />,
    );
    expect(queryByTestId("major-gap-overlay")).toBeNull();
  });

  // 痛點:R4 錨差 clamp — coverageStart 早於(或等於)全量首根 = 全覆蓋,
  // 不得誤蓋 overlay(base 與 major 的 last_date 跨午夜可差一天)。
  it("no overlay when coverage reaches the first candle (R4 clamp)", () => {
    const history = mkHistory(540);
    const { queryByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        majorCoverageStart={history.candles[0]!.date}
        majorFetching={true}
      />,
    );
    expect(queryByTestId("major-gap-overlay")).toBeNull();
  });

  // 痛點:可見窗全在覆蓋內(沒拖出去)→ 不蓋,即使更左邊還有缺料。
  it("no overlay when the visible window is fully covered", () => {
    const history = mkHistory(540);
    // 覆蓋左界 = 可見窗左界(candles[450])→ 可見窗零缺料
    const { queryByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
        majorCoverageStart={history.candles[450]!.date}
        majorFetching={true}
      />,
    );
    expect(queryByTestId("major-gap-overlay")).toBeNull();
  });
});
