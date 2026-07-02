/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketUniverseBanner } from "./MarketUniverseBanner";
import type { ExcludedCount } from "../lib/market-types";

afterEach(() => cleanup());

const excludedCount: ExcludedCount = { etf: 347, warrant: 67, watch_list: 57 };

describe("MarketUniverseBanner", () => {
  it("文案全文:total 加總正確(347+67+57=471)+ 含「處置股」+ 含「以本次掃描範圍為準」+ 納入 1917 (SC-8)", () => {
    render(
      <MarketUniverseBanner universeSize={1917} excludedCount={excludedCount} stale={false} />,
    );
    const root = screen.getByTestId("market-universe-banner");
    expect(root.textContent).toBe(
      "已過濾 ETF / 權證 / 處置股 共 471 檔 · 納入 1917 檔(以本次掃描範圍為準)",
    );
  });

  it("禁分項數字:queryByText(/ETF 347|權證 67|處置股 57/) → null (SC-8)", () => {
    render(
      <MarketUniverseBanner universeSize={1917} excludedCount={excludedCount} stale={false} />,
    );
    expect(screen.queryByText(/ETF 347|權證 67|處置股 57/)).toBeNull();
  });

  it("禁 overclaim:queryByText(/注意股|全額交割/) → null (D-1)", () => {
    render(
      <MarketUniverseBanner universeSize={1917} excludedCount={excludedCount} stale={false} />,
    );
    expect(screen.queryByText(/注意股|全額交割/)).toBeNull();
  });

  it("stale=true → 含「資料停滯」;false → 不含 (SC-8)", () => {
    const { rerender } = render(
      <MarketUniverseBanner universeSize={1917} excludedCount={excludedCount} stale={true} />,
    );
    const root = screen.getByTestId("market-universe-banner");
    expect(root.textContent).toContain("資料停滯");

    rerender(
      <MarketUniverseBanner universeSize={1917} excludedCount={excludedCount} stale={false} />,
    );
    expect(root.textContent).not.toContain("資料停滯");
  });

  it("方向性文案 lock (SC-10a)", () => {
    render(
      <MarketUniverseBanner universeSize={1917} excludedCount={excludedCount} stale={false} />,
    );
    expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull();
  });
});
