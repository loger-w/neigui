/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketCapTiers } from "./MarketCapTiers";
import type { CapTier } from "../lib/market-types";

afterEach(() => cleanup());

const tiers: CapTier[] = [
  { tier: "top50", members: 50, avg_change_rate: -0.3, up_ratio: 0.32 },
  { tier: "mid100", members: 100, avg_change_rate: -1.9, up_ratio: 0.18 },
  { tier: "rest", members: 1600, avg_change_rate: -2.2, up_ratio: 0.15 },
];

describe("MarketCapTiers", () => {
  it("loading=true → data-state=loading skeleton", () => {
    render(<MarketCapTiers data={null} loading={true} />);
    const root = screen.getByTestId("market-cap-tiers");
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it("data=null(SC-5 mv_map 失敗降級)→ 資料暫缺", () => {
    render(<MarketCapTiers data={null} loading={false} />);
    const root = screen.getByTestId("market-cap-tiers");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
  });

  it("三桶各顯示等權漲跌 + 上漲家數比例", () => {
    render(<MarketCapTiers data={tiers} loading={false} />);
    const top50 = screen.getByTestId("cap-tier-top50");
    expect(top50.textContent).toContain("權值前 50");
    expect(top50.textContent).toContain("(50)");
    expect(top50.textContent).toContain("-0.30%");
    expect(top50.textContent).toContain("32%");

    expect(screen.getByTestId("cap-tier-mid100").textContent).toContain("中型 51–150");
    expect(screen.getByTestId("cap-tier-rest").textContent).toContain("其餘");
  });

  it("up_ratio bar 寬度反映比例(R8 邊界:mv/change_rate 缺者已由 backend 剔除)", () => {
    render(<MarketCapTiers data={tiers} loading={false} />);
    const top50 = screen.getByTestId("cap-tier-top50");
    const bar = top50.querySelector("div.bg-bull\\/70") as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar?.style.width).toBe("32%");
  });

  it("只回單桶(其餘桶因空略過)也能正確 render,不 crash", () => {
    render(<MarketCapTiers data={[tiers[0]!]} loading={false} />);
    expect(screen.getByTestId("cap-tier-top50")).toBeTruthy();
    expect(screen.queryByTestId("cap-tier-mid100")).toBeNull();
  });
});
