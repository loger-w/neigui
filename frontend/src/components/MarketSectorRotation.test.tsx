/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as marketApi from "../lib/market-api";
import { MarketSectorRotation } from "./MarketSectorRotation";
import type { SectorMembers, SectorRotation } from "../lib/market-types";

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

const rotation: SectorRotation = {
  as_of: "2026-07-20 13:07:05",
  industries: [
    {
      name: "半導體",
      members: 120,
      avg_change_rate: 0.4,
      vol_ratio: 1.8,
      subs: [
        { name: "記憶體IC", members: 6, avg_change_rate: 3.1, vol_ratio: 2.4 },
        { name: "IC設計", members: 40, avg_change_rate: -0.2, vol_ratio: 0.5 },
      ],
    },
    {
      name: "金融保險",
      members: 30,
      avg_change_rate: -1.1,
      vol_ratio: null,
      subs: [],
    },
  ],
};

describe("MarketSectorRotation", () => {
  it("loading=true → data-state=loading skeleton", () => {
    render(wrap(<MarketSectorRotation data={null} loading={true} />));
    const root = screen.getByTestId("market-sector-rotation");
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it("data=null(SC-5 chain fetch 失敗降級)→ 資料暫缺", () => {
    render(wrap(<MarketSectorRotation data={null} loading={false} />));
    const root = screen.getByTestId("market-sector-rotation");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
  });

  it("主列表:名稱 + 等權漲跌 + 量比 + 成員數,量比 >1.5 標過熱 / <0.7 標冷清", () => {
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    const row = screen.getByTestId("sector-row-半導體");
    expect(row.textContent).toContain("半導體");
    expect(row.textContent).toContain("(120)");
    expect(row.textContent).toContain("+0.40%");
    expect(row.textContent).toContain("1.80x");
    expect(row.querySelector('[data-flag="hot"]')).toBeTruthy();

    const finRow = screen.getByTestId("sector-row-金融保險");
    expect(finRow.textContent).toContain("—"); // vol_ratio null
  });

  it("列可展開 → 子產業列(同 metrics)", () => {
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    expect(screen.queryByTestId("sub-row-半導體-記憶體IC")).toBeNull();
    fireEvent.click(screen.getByTestId("sector-toggle-半導體"));
    const sub = screen.getByTestId("sub-row-半導體-記憶體IC");
    expect(sub.textContent).toContain("記憶體IC");
    expect(sub.textContent).toContain("+3.10%");
    expect(sub.querySelector('[data-flag="hot"]')).toBeTruthy();

    const coldSub = screen.getByTestId("sub-row-半導體-IC設計");
    expect(coldSub.querySelector('[data-flag="cold"]')).toBeTruthy();
  });

  it("點產業列 → fetch sector_members(sub_industry=null),顯示成員股 (R14)", async () => {
    const members: SectorMembers = {
      industry: "半導體",
      sub_industry: null,
      members: [
        { stock_id: "2330", name: "台積電", change_rate: 1.2, vol_ratio: 1.1, total_amount: 5e10 },
      ],
    };
    const spy = vi.spyOn(marketApi, "fetchSectorMembers").mockResolvedValue(members);
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-drill-半導體"));
    expect(spy).toHaveBeenCalledWith("半導體", null, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await waitFor(() => {
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("台積電");
    });
    expect(screen.getByTestId("sector-member-2330").textContent).toContain("+1.20%");
  });

  it("點子產業列 → fetch sector_members(帶 sub_industry)", async () => {
    const members: SectorMembers = { industry: "半導體", sub_industry: "記憶體IC", members: [] };
    const spy = vi.spyOn(marketApi, "fetchSectorMembers").mockResolvedValue(members);
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-toggle-半導體"));
    fireEvent.click(screen.getByTestId("sub-row-半導體-記憶體IC"));
    expect(spy).toHaveBeenCalledWith(
      "半導體",
      "記憶體IC",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("無成員資料");
    });
  });

  it("成員 fetch 失敗 → 繁中錯誤字,不 crash", async () => {
    vi.spyOn(marketApi, "fetchSectorMembers").mockRejectedValue(new Error("unknown_sector"));
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-drill-半導體"));
    await waitFor(() => {
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("成員股載入失敗");
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("unknown_sector");
    });
  });

  it("關閉成員面板", async () => {
    vi.spyOn(marketApi, "fetchSectorMembers").mockResolvedValue({
      industry: "半導體",
      sub_industry: null,
      members: [],
    });
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-drill-半導體"));
    await waitFor(() => expect(screen.getByTestId("sector-members-panel")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("關閉成員列表"));
    expect(screen.queryByTestId("sector-members-panel")).toBeNull();
  });

  it("PCR/Max Pain 方向性文案禁令同樣適用:不寫做多/做空/賣選/滿倉", () => {
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull();
  });
});
