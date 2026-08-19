/**
 * @vitest-environment jsdom
 *
 * Audit X7:brainstorm.md SC-4 要求驗 mode='market' → MarketPage + localStorage
 * 持久化。ModeSwitch.test.tsx 只測單一 button 行為,App level 的 mode 切換 +
 * 持久化 + 對應 view 的 mount 一直沒 test 蓋。
 *
 * 策略:mock 所有重元件(各 mode 的內容)+ 所有 data hook,只驗 mode 路由邏輯。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// feat/bubble-streak-screenshot(impl-review R4):bubbleDays 接線與 intraday
// gate 需要觀察 hook 收到的參數 → hoisted 記錄器(vi.mock factory 提升到
// import 之上,不能引用一般 module-scope const)。
const spies = vi.hoisted(() => ({
  bubbleCalls: [] as { symbol: string; date: string; days: number | undefined }[],
  intradayCalls: [] as { symbol: string; date: string }[],
  // [review-1 WHITELIST3-NO-TEST] 泡泡天數與總覽 windowDays 是兩個獨立 state,
  // 互不影響是白名單 3 —— 要驗「不變」就得看得到 brokers_window 收到的 days。
  brokersWindowCalls: [] as { symbol: string; date: string; days: number }[],
  bubbleRefresh: vi.fn(),
  intradayRefresh: vi.fn(),
  // SC-4:dayMarks 組裝要看得到「windowMeta.tradingDates × history.candles」兩個
  // 輸入的交集結果 → 兩個來源都做成可控 state(預設值 = 既有 mock 行為)。
  bubbleWindowMeta: null as
    | { windowDays: number; actualDays: number; tradingDates: string[] }
    | null,
  chipHistory: null as { candles: { date: string; open: number; high: number; low: number; close: number; volume: number }[] } | null,
}));

vi.mock("./components/ChipBubbleView", () => ({
  ChipBubbleView: ({
    days,
    onDaysChange,
    dayMarks,
  }: {
    days?: number;
    onDaysChange?: (d: number) => void;
    dayMarks?: { dates: string[]; candles: { date: string }[] } | null;
  }) => (
    <div
      data-testid="chip-bubble"
      data-days={String(days)}
      data-daymarks={dayMarks ? String(dayMarks.dates.length) : "null"}
      data-daymark-candles={dayMarks ? dayMarks.candles.map((c) => c.date).join(",") : ""}
    >
      <button onClick={() => onDaysChange?.(5)}>stub-days-5</button>
    </div>
  ),
}));
vi.mock("./components/OptionsPage", () => ({
  OptionsPage: () => <div data-testid="options-page">options</div>,
}));
vi.mock("./components/MarketPage", () => ({
  // fix/cross-mode-symbol-name:市場頁只帶 stock_id 跳轉(無 name 通道)
  MarketPage: ({ onSymbolPick }: { onSymbolPick: (sid: string) => void }) => (
    <div data-testid="market-page">
      <button onClick={() => onSymbolPick("2330")}>market-pick-2330</button>
      <button onClick={() => onSymbolPick("9999")}>market-pick-9999</button>
    </div>
  ),
}));
vi.mock("./components/BorrowFeePage", () => ({
  BorrowFeePage: ({ onSymbolPick }: { onSymbolPick?: (sid: string) => void }) => (
    <div data-testid="borrow-fee-page">
      <button onClick={() => onSymbolPick?.("2454")}>borrow-pick-2454</button>
    </div>
  ),
}));
// fix/cross-mode-symbol-name:App 以全股票目錄補跨 mode 跳轉缺的股名
vi.mock("./hooks/useAllSymbols", () => ({
  useAllSymbols: () => ({
    // 目錄名故意與 SymbolSearch mock 不同(哨兵),鎖「搜尋 name 優先於目錄」
    symbols: [
      { symbol: "2330", name: "目錄-台積電" },
      { symbol: "2454", name: "聯發科" },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock("./components/WarrantSelector", () => ({
  WarrantSelector: () => <div data-testid="warrant-selector">warrants</div>,
}));
vi.mock("./components/WarrantFlowPanel", () => ({
  WarrantFlowPanel: ({ active }: { active: boolean }) => (
    <div data-testid="warrant-flow-panel" data-active={String(active)}>flow</div>
  ),
}));
vi.mock("./components/BrokerFlowsPanel", () => ({
  BrokerFlowsPanel: ({
    active,
    onPickStock,
  }: {
    active: boolean;
    onPickStock: (sid: string, name: string | null, brokerId: string) => void;
  }) => (
    <div data-testid="broker-flows-panel" data-active={String(active)}>
      <button onClick={() => onPickStock("2330", "台積電", "9600")}>pick-2330</button>
      <button onClick={() => onPickStock("2454", null, "9600")}>pick-2454-noname</button>
    </div>
  ),
}));
vi.mock("./components/SymbolSearch", () => ({
  SymbolSearch: ({ onPick }: { onPick: (sid: string, name: string | null) => void }) => (
    <div data-testid="symbol-search">
      <button onClick={() => onPick("2330", "台積電")}>sym-pick-2330</button>
      <button onClick={() => onPick("2454", "聯發科")}>sym-pick-2454</button>
    </div>
  ),
}));
vi.mock("./components/ChipBrokersPanel", () => ({
  ChipBrokersPanel: () => <div data-testid="brokers-panel">brokers</div>,
}));
vi.mock("./components/ChipKlineChart", () => ({
  // data-selected:S1 lock — 分點反查跳轉的預選 broker 必須流進 K 線 props
  ChipKlineChart: ({ selectedBrokerIds }: { selectedBrokerIds?: Set<string> }) => (
    <div data-testid="kline-chart" data-selected={Array.from(selectedBrokerIds ?? []).join(",")}>
      kline
    </div>
  ),
}));
vi.mock("./components/VersionBadge", () => ({
  VersionBadge: () => <div data-testid="version-badge">v</div>,
}));
vi.mock("./hooks/useChipData", () => ({
  useChipData: () => ({
    history: spies.chipHistory, loading: false, majorLoading: false,
    majorFetching: false, majorCoverageStart: null, ensureMajorCoverage: vi.fn(),
    error: null, refresh: vi.fn(),
  }),
}));
vi.mock("./hooks/useChipBubble", () => ({
  useChipBubble: (symbol: string, date: string, days?: number) => {
    spies.bubbleCalls.push({ symbol, date, days });
    return {
      data: null, windowMeta: spies.bubbleWindowMeta, loading: false, error: null,
      refresh: spies.bubbleRefresh,
    };
  },
}));
vi.mock("./hooks/useChipIntraday", () => ({
  useChipIntraday: (symbol: string, date: string) => {
    spies.intradayCalls.push({ symbol, date });
    return { data: null, loading: false, error: null, refresh: spies.intradayRefresh };
  },
}));
vi.mock("./hooks/useBrokerHistory", () => ({
  useBrokerHistory: () => ({ series: {}, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./hooks/useChipBrokersWindow", () => ({
  useChipBrokersWindow: (symbol: string, date: string, days: number) => {
    spies.brokersWindowCalls.push({ symbol, date, days });
    return { data: null, loading: false, error: null, refresh: vi.fn() };
  },
}));

import App from "./App";

beforeEach(() => {
  localStorage.clear();
  spies.bubbleCalls.length = 0;
  spies.intradayCalls.length = 0;
  spies.brokersWindowCalls.length = 0;
  spies.bubbleRefresh.mockClear();
  spies.intradayRefresh.mockClear();
  spies.bubbleWindowMeta = null;
  spies.chipHistory = null;
});
afterEach(() => {
  cleanup();
});

describe("App mode persistence (SC-4)", () => {
  it("mounts MarketPage when localStorage mode=market on cold start", async () => {
    localStorage.setItem("mode", "market");
    render(<App />);
    // MarketPage 是 lazy import,等 Suspense resolve
    await waitFor(() => {
      expect(screen.queryByTestId("market-page")).toBeTruthy();
    });
    expect(screen.queryByTestId("kline-chart")).toBeNull();
    expect(screen.queryByTestId("options-page")).toBeNull();
  });

  it("writes localStorage when clicking 大盤 from equity mode", async () => {
    // No initial value → defaults to 'equity'
    render(<App />);
    expect(localStorage.getItem("mode")).toBe("equity");
    fireEvent.click(screen.getByRole("button", { name: "大盤" }));
    expect(localStorage.getItem("mode")).toBe("market");
    // 切過去後 MarketPage 也該掛上(Suspense)
    await waitFor(() => {
      expect(screen.queryByTestId("market-page")).toBeTruthy();
    });
  });

  it("clicking 個股 from market mode writes localStorage and unmounts MarketPage", async () => {
    localStorage.setItem("mode", "market");
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId("market-page")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "個股" }));
    expect(localStorage.getItem("mode")).toBe("equity");
    // equity view mount → market view 不在
    expect(screen.queryByTestId("kline-chart")).toBeTruthy();
    expect(screen.queryByTestId("market-page")).toBeNull();
  });

  it("跨 mode:market → equity 跳轉後 header 顯示股名而非只有代號", async () => {
    localStorage.setItem("mode", "market");
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId("market-page")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("market-pick-2330"));
    expect(localStorage.getItem("mode")).toBe("equity");
    expect(screen.getByText("2330")).toBeTruthy();
    expect(screen.getByText("目錄-台積電")).toBeTruthy();
  });

  it("搜尋帶來的 name 優先於目錄名;換股後舊名不殘留", () => {
    render(<App />);
    fireEvent.click(screen.getByText("sym-pick-2330"));
    expect(screen.getByText("台積電")).toBeTruthy();
    expect(screen.queryByText("目錄-台積電")).toBeNull();
    fireEvent.click(screen.getByText("sym-pick-2454"));
    expect(screen.getByText("聯發科")).toBeTruthy();
    expect(screen.queryByText("台積電")).toBeNull();
  });

  it("跨 mode:代號不在目錄 → 只顯代號、不 crash、不誤借他股名", async () => {
    localStorage.setItem("mode", "market");
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId("market-page")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("market-pick-9999"));
    expect(screen.getByText("9999")).toBeTruthy();
    expect(screen.queryByText("目錄-台積電")).toBeNull();
    expect(screen.queryByText("聯發科")).toBeNull();
  });

  it("跨 mode:分點反查 null name → header 以目錄補名,且分點預選保留", async () => {
    localStorage.setItem("mode", "flows");
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId("broker-flows-panel")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("pick-2454-noname"));
    expect(screen.getByText("2454")).toBeTruthy();
    expect(screen.getByText("聯發科")).toBeTruthy();
    expect(screen.getByTestId("kline-chart").getAttribute("data-selected")).toBe("9600");
  });

  it("跨 mode:borrow → equity 跳轉後 header 顯示股名而非只有代號", async () => {
    localStorage.setItem("mode", "borrow");
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId("borrow-fee-page")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("borrow-pick-2454"));
    expect(screen.getByText("2454")).toBeTruthy();
    expect(screen.getByText("聯發科")).toBeTruthy();
  });

  it("mounts BorrowFeePage when localStorage mode=borrow on cold start", async () => {
    localStorage.setItem("mode", "borrow");
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId("borrow-fee-page")).toBeTruthy();
    });
    expect(screen.queryByTestId("kline-chart")).toBeNull();
    expect(screen.queryByTestId("market-page")).toBeNull();
  });

  it("clicking 券差 from equity writes localStorage and mounts BorrowFeePage", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "券差" }));
    expect(localStorage.getItem("mode")).toBe("borrow");
    await waitFor(() => {
      expect(screen.queryByTestId("borrow-fee-page")).toBeTruthy();
    });
  });

  it("權證分點 tab:點擊切換 mount panel 並帶 active(SC-1)", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "權證分點" }));
    await waitFor(() => {
      expect(screen.queryByTestId("warrant-flow-panel")).toBeTruthy();
    });
    expect(screen.getByTestId("warrant-flow-panel").getAttribute("data-active")).toBe("true");
    // 切回總覽:hidden 保 DOM(active gate 停止 fetch),panel 仍 mounted
    fireEvent.click(screen.getByRole("button", { name: "籌碼總覽" }));
    expect(screen.getByTestId("warrant-flow-panel").getAttribute("data-active")).toBe("false");
  });

  // NAV-1(mod/batch-ui-update):分點反查升格為 mode(券差旁),不再是 equity tab。
  it("分點反查 mode:點擊 mount panel + localStorage 寫 flows,切回個股 unmount", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "分點反查" }));
    expect(localStorage.getItem("mode")).toBe("flows");
    await waitFor(() => {
      expect(screen.queryByTestId("broker-flows-panel")).toBeTruthy();
    });
    expect(screen.getByTestId("broker-flows-panel").getAttribute("data-active")).toBe("true");
    // mode 層 ternary → 切回個股時 panel unmount(非 hidden)
    fireEvent.click(screen.getByRole("button", { name: "個股" }));
    expect(screen.queryByTestId("broker-flows-panel")).toBeNull();
    expect(localStorage.getItem("mode")).toBe("equity");
  });

  it("equity tab 列不再包含分點反查(NAV-1)", async () => {
    render(<App />);
    // equity header tab 列:籌碼總覽 / 泡泡圖 / 權證 / 權證分點,無分點反查
    expect(screen.getByRole("button", { name: "權證分點" })).toBeTruthy();
    const flowsButtons = screen.getAllByRole("button", { name: "分點反查" });
    expect(flowsButtons.length).toBe(1); // 僅 ModeSwitch 一顆
  });

  it("分點反查點股票 → 跨 mode 跳回 equity 總覽 + 該分點預選流進 K 線(SC-5 lock)", async () => {
    // 痛點:handlePick 會 reset selectedBrokerIds,預選必須在其後
    // (App.tsx handleFlowStockPick 註解點名的順序陷阱)— 順序反轉此測試必紅。
    // NAV-1 後跳轉是跨 mode:flows → equity。
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "分點反查" }));
    await waitFor(() => {
      expect(screen.queryByTestId("broker-flows-panel")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "pick-2330" }));
    expect(localStorage.getItem("mode")).toBe("equity");
    await waitFor(() => {
      expect(screen.getByTestId("kline-chart").getAttribute("data-selected")).toBe("9600");
    });
    expect(screen.queryByTestId("broker-flows-panel")).toBeNull();
  });

  // feat/bubble-streak-screenshot SC-4(impl-review R4):bubbleDays 接線。
  // 痛點:多日聚合下分時線(當日 1 分 K)與畫面語意不符且白花一次請求 —
  // gate 沒接上時 useChipIntraday 仍收到 symbol,此測試即紅。
  it("bubbleDays > 1 → useChipIntraday 收到 symbol \"\"(不 fetch 分時線),bubble hook 收 days", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2330" }));
    fireEvent.click(screen.getByRole("button", { name: "泡泡圖" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chip-bubble")).toBeTruthy();
    });
    // 基準:單日模式下分時線照抓
    expect(spies.intradayCalls[spies.intradayCalls.length - 1]!.symbol).toBe("2330");

    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });
    expect(spies.intradayCalls[spies.intradayCalls.length - 1]!.symbol).toBe("");
    const lastBubble = spies.bubbleCalls[spies.bubbleCalls.length - 1]!;
    expect(lastBubble.symbol).toBe("2330");
    expect(lastBubble.days).toBe(5);
  });

  // [impl-review R8]:refresh() 也要 gate — days>1 時對 disabled query 發
  // refresh 會打出 GET /api/chip//intraday 無效請求。
  it("bubbleDays > 1 時按重新整理 → bubble refresh 有、intraday refresh 無(R8)", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2330" }));
    fireEvent.click(screen.getByRole("button", { name: "泡泡圖" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chip-bubble")).toBeTruthy();
    });
    // 單日模式:兩者都刷
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(spies.bubbleRefresh).toHaveBeenCalledTimes(1);
    expect(spies.intradayRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(spies.bubbleRefresh).toHaveBeenCalledTimes(2);
    expect(spies.intradayRefresh).toHaveBeenCalledTimes(1);
  });

  // 視角偏好非資料 state:換股保留(對齊 windowDays 不隨 symbol 重置的現況)。
  it("換 symbol → bubbleDays 不重置", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2330" }));
    fireEvent.click(screen.getByRole("button", { name: "泡泡圖" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chip-bubble")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2454" }));
    await waitFor(() => {
      expect(spies.bubbleCalls[spies.bubbleCalls.length - 1]!.symbol).toBe("2454");
    });
    expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    expect(spies.bubbleCalls[spies.bubbleCalls.length - 1]!.days).toBe(5);
  });

  // [review-1 WHITELIST3-NO-TEST] lock test:brainstorm 白名單 3 —— 籌碼總覽的
  // windowDays 與泡泡圖天數是兩個獨立 state(前者 localStorage 持久化、後者
  // 刻意不持久化)。兩顆選擇器長得幾乎一樣,接線接錯不會有任何畫面異常,
  // 只會讓使用者調 A 時 B 也跟著跳、還把泡泡天數寫進 chip_window_days。
  it("切泡泡天數 → windowDays 與 chip_window_days 不動", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2330" }));
    fireEvent.click(screen.getByRole("button", { name: "泡泡圖" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chip-bubble")).toBeTruthy();
    });
    expect(localStorage.getItem("chip_window_days")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });
    // brokers_window 仍收 1;localStorage 未被泡泡天數污染
    const lastWindow = spies.brokersWindowCalls[spies.brokersWindowCalls.length - 1]!;
    expect(lastWindow.days).toBe(1);
    expect(localStorage.getItem("chip_window_days")).toBe("1");
    expect(
      screen.getByRole("button", { name: "設為 1 日" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("切 windowDays → 泡泡天數不動(反向)", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2330" }));
    fireEvent.click(screen.getByRole("button", { name: "泡泡圖" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chip-bubble")).toBeTruthy();
    });
    // 先把泡泡切到 5,確保「windowDays 改動不得把它拉回 1」也在鎖住範圍
    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });

    fireEvent.click(screen.getByRole("button", { name: "設為 10 日" }));
    await waitFor(() => {
      expect(localStorage.getItem("chip_window_days")).toBe("10");
    });
    expect(spies.brokersWindowCalls[spies.brokersWindowCalls.length - 1]!.days).toBe(10);
    // 泡泡天數不受影響
    expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    expect(spies.bubbleCalls[spies.bubbleCalls.length - 1]!.days).toBe(5);
  });

  it("invalid localStorage mode value falls back to equity(R5 白名單)", async () => {
    localStorage.setItem("mode", "INVALID" as string);
    render(<App />);
    // R5:mode 初始化白名單 — 未知值 fallback equity(equity 內容掛載)。
    await waitFor(() => {
      expect(screen.queryByTestId("kline-chart")).toBeTruthy();
    });
  });
});

// SC-4(mod/kline-date-bubble-days-ux):每日開收標示的資料組裝在 App —— 視窗的
// trading_dates 與 K 線 history.candles 的交集。兩個來源缺一(尤其 history 尚未
// 回)一律退回 null,ChipBubbleView 端等同現行為(W2/R18)。
describe("App — SC-4 bubbleDayMarks 組裝", () => {
  const mkCandle = (date: string) => ({
    date, open: 100, high: 102, low: 99, close: 101, volume: 1000,
  });

  async function openBubbleTab() {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "sym-pick-2330" }));
    fireEvent.click(screen.getByRole("button", { name: "泡泡圖" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chip-bubble")).toBeTruthy();
    });
  }

  it("windowMeta + history 皆有 → dates 全帶、candles 只留 trading_dates 命中的日", async () => {
    spies.bubbleWindowMeta = {
      windowDays: 5, actualDays: 3,
      tradingDates: ["2026-06-23", "2026-06-24", "2026-06-25"],
    };
    spies.chipHistory = {
      candles: [
        mkCandle("2026-06-22"),
        mkCandle("2026-06-23"),
        mkCandle("2026-06-25"),
      ],
    };
    await openBubbleTab();
    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });
    const el = screen.getByTestId("chip-bubble");
    // 欄位數 = trading_dates(缺 candle 的 6/24 仍算一欄)
    expect(el.getAttribute("data-daymarks")).toBe("3");
    // candles 濾掉視窗外的 6/22,缺的 6/24 不補
    expect(el.getAttribute("data-daymark-candles")).toBe("2026-06-23,2026-06-25");
  });

  it("history 尚未回 → dayMarks 為 null(退回現行為)", async () => {
    spies.bubbleWindowMeta = {
      windowDays: 5, actualDays: 5, tradingDates: ["2026-06-23", "2026-06-24"],
    };
    spies.chipHistory = null;
    await openBubbleTab();
    fireEvent.click(screen.getByRole("button", { name: "stub-days-5" }));
    await waitFor(() => {
      expect(screen.getByTestId("chip-bubble").getAttribute("data-days")).toBe("5");
    });
    expect(screen.getByTestId("chip-bubble").getAttribute("data-daymarks")).toBe("null");
  });

  it("windowMeta 為 null(單日 / 視窗未回)→ dayMarks 為 null", async () => {
    spies.bubbleWindowMeta = null;
    spies.chipHistory = { candles: [mkCandle("2026-06-23")] };
    await openBubbleTab();
    expect(screen.getByTestId("chip-bubble").getAttribute("data-daymarks")).toBe("null");
  });
});
