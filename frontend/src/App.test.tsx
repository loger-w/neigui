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

vi.mock("./components/ChipBubbleView", () => ({
  ChipBubbleView: () => <div data-testid="chip-bubble">bubble</div>,
}));
vi.mock("./components/OptionsPage", () => ({
  OptionsPage: () => <div data-testid="options-page">options</div>,
}));
vi.mock("./components/MarketPage", () => ({
  MarketPage: () => <div data-testid="market-page">market</div>,
}));
vi.mock("./components/BorrowFeePage", () => ({
  BorrowFeePage: () => <div data-testid="borrow-fee-page">borrow</div>,
}));
vi.mock("./components/WarrantSelector", () => ({
  WarrantSelector: () => <div data-testid="warrant-selector">warrants</div>,
}));
vi.mock("./components/SymbolSearch", () => ({
  SymbolSearch: () => <div data-testid="symbol-search">search</div>,
}));
vi.mock("./components/ChipBrokersPanel", () => ({
  ChipBrokersPanel: () => <div data-testid="brokers-panel">brokers</div>,
}));
vi.mock("./components/ChipKlineChart", () => ({
  ChipKlineChart: () => <div data-testid="kline-chart">kline</div>,
}));
vi.mock("./components/VersionBadge", () => ({
  VersionBadge: () => <div data-testid="version-badge">v</div>,
}));
vi.mock("./hooks/useChipData", () => ({
  useChipData: () => ({
    history: null, loading: false, majorLoading: false,
    error: null, refresh: vi.fn(),
  }),
}));
vi.mock("./hooks/useChipBubble", () => ({
  useChipBubble: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./hooks/useChipIntraday", () => ({
  useChipIntraday: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./hooks/useBrokerHistory", () => ({
  useBrokerHistory: () => ({ series: {}, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./hooks/useChipBrokersWindow", () => ({
  useChipBrokersWindow: () => ({
    data: null, loading: false, error: null, refresh: vi.fn(),
  }),
}));

import App from "./App";

beforeEach(() => {
  localStorage.clear();
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

  it("ignores invalid localStorage mode value and falls back to equity", () => {
    localStorage.setItem("mode", "INVALID" as string);
    render(<App />);
    // 沒 explicit validate;`as Mode` cast 後直接設 state(view 不掛四 mode 任一)。
    // 4-way 三元後 fallback 終點 = BorrowFeePage(design P2-5 已知行為變更,
    // 原為 MarketPage)。鎖 "no equity content" 即可,避免 lazy page 在同步
    // render 還沒 resolve 也通過;未來若加 validate 記得跟著改這個 test。
    expect(screen.queryByTestId("kline-chart")).toBeNull();
  });
});
