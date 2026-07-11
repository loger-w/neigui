/**
 * @vitest-environment jsdom
 *
 * WarrantIvHistory — 展開區 bid/ask IV 時序圖(SC-7)。
 * Mock 走 vi.spyOn(api),不 mock hooks(frontend-testing 慣例)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantIvHistoryPayload } from "../lib/warrant-data";
import { WarrantIvHistory } from "./WarrantIvHistory";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantIvHistoryPayload>): WarrantIvHistoryPayload => ({
  warrant_id: "030012",
  terms_approx_dates: [],
  series: [
    { date: "2026-07-07", iv_bid: 0.43, iv_ask: 0.47 },
    { date: "2026-07-08", iv_bid: 0.42, iv_ask: 0.46 },
    { date: "2026-07-09", iv_bid: 0.41, iv_ask: 0.45 },
  ],
  drift: { label: "declining", slope_bid: -0.002, slope_ask: -0.001, n_valid: 25 },
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("WarrantIvHistory", () => {
  it("loading 狀態(繁中)", () => {
    vi.spyOn(api, "warrantIvHistory").mockReturnValue(new Promise(() => {}));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    expect(screen.getByText("載入引波歷史...")).toBeTruthy();
  });

  it("error 狀態顯示訊息", async () => {
    vi.spyOn(api, "warrantIvHistory").mockRejectedValue(new Error("上游資料源異常"));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByText("上游資料源異常")).toBeTruthy(), {
      timeout: 5000,
    });
  });

  it("空序列 → 無歷史引波資料", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(
      mk({ series: [], drift: { label: "insufficient", slope_bid: null, slope_ask: null, n_valid: 0 } }),
    );
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByText("無歷史引波資料")).toBeTruthy());
  });

  it("正常渲染:svg 兩線 path 非空 + 圖例(資料級)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    const svg = screen.getByTestId("warrant-iv-chart");
    const paths = svg.querySelectorAll("path[data-side]");
    expect(paths.length).toBe(2);
    for (const p of paths) expect(p.getAttribute("d")).toMatch(/^M/);
    expect(screen.getByText(/買價IV/)).toBeTruthy();
    expect(screen.getByText(/賣價IV/)).toBeTruthy();
  });

  it("近似註記:terms_approx_dates 非空才顯示(edge 4)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk({ terms_approx_dates: ["2026-07-07"] }));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() =>
      expect(screen.getByText("歷史 IV 以現行條款近似")).toBeTruthy(),
    );
  });

  it("無近似日不顯示註記", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(screen.queryByText("歷史 IV 以現行條款近似")).toBeNull();
  });
});
