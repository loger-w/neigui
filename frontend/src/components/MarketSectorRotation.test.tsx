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

  // MK-3(mod/batch-ui-update):整列點擊展開(不限箭頭)+ 個股巢狀內嵌。
  it("整列點擊主族群 → 子產業列展開/收合(有副族群者不 fetch 成員)", () => {
    const spy = vi.spyOn(marketApi, "fetchSectorMembers");
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    expect(screen.queryByTestId("sub-row-半導體-記憶體IC")).toBeNull();
    const rowBtn = screen.getByTestId("sector-row-btn-半導體");
    fireEvent.click(rowBtn);
    expect(rowBtn.getAttribute("aria-expanded")).toBe("true");
    const sub = screen.getByTestId("sub-row-半導體-記憶體IC");
    expect(sub.textContent).toContain("記憶體IC");
    expect(sub.textContent).toContain("+3.10%");
    expect(sub.querySelector('[data-flag="hot"]')).toBeTruthy();
    const coldSub = screen.getByTestId("sub-row-半導體-IC設計");
    expect(coldSub.querySelector('[data-flag="cold"]')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(rowBtn);
    expect(screen.queryByTestId("sub-row-半導體-記憶體IC")).toBeNull();
  });

  it("整列點擊副族群 → 個股表巢狀內嵌該列之下;再點收合", async () => {
    const members: SectorMembers = {
      industry: "半導體",
      sub_industry: "記憶體IC",
      members: [
        { stock_id: "2330", name: "台積電", change_rate: 1.2, vol_ratio: 1.1, total_amount: 5e10 },
      ],
    };
    const spy = vi.spyOn(marketApi, "fetchSectorMembers").mockResolvedValue(members);
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-row-btn-半導體"));
    fireEvent.click(screen.getByTestId("sub-row-半導體-記憶體IC"));
    expect(spy).toHaveBeenCalledWith(
      "半導體",
      "記憶體IC",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("台積電");
    });
    // 巢狀:成員表在該副族群 li 之內,不在卡片底部
    const subLi = screen.getByTestId("sub-row-半導體-記憶體IC").closest("li")!;
    expect(subLi.querySelector('[data-testid="sector-members-panel"]')).toBeTruthy();
    expect(screen.getByTestId("sector-member-2330").textContent).toContain("+1.20%");
    fireEvent.click(screen.getByTestId("sub-row-半導體-記憶體IC"));
    expect(screen.queryByTestId("sector-members-panel")).toBeNull();
  });

  it("無副族群的主族群整列點擊 → 直接內嵌個股表(industry-level fetch)", async () => {
    const members: SectorMembers = { industry: "金融保險", sub_industry: null, members: [] };
    const spy = vi.spyOn(marketApi, "fetchSectorMembers").mockResolvedValue(members);
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    const rowBtn = screen.getByTestId("sector-row-btn-金融保險");
    fireEvent.click(rowBtn);
    expect(spy).toHaveBeenCalledWith(
      "金融保險",
      null,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rowBtn.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("無成員資料");
    });
    const li = screen.getByTestId("sector-row-金融保險");
    expect(li.querySelector('[data-testid="sector-members-panel"]')).toBeTruthy();
  });

  it("同時僅一個成員表展開(切換目標時舊表收合)", async () => {
    vi.spyOn(marketApi, "fetchSectorMembers").mockResolvedValue({
      industry: "半導體",
      sub_industry: "記憶體IC",
      members: [],
    });
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-row-btn-半導體"));
    fireEvent.click(screen.getByTestId("sub-row-半導體-記憶體IC"));
    await waitFor(() => expect(screen.getByTestId("sector-members-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("sub-row-半導體-IC設計"));
    await waitFor(() => {
      expect(screen.getAllByTestId("sector-members-panel")).toHaveLength(1);
    });
    const li = screen.getByTestId("sub-row-半導體-IC設計").closest("li")!;
    expect(li.querySelector('[data-testid="sector-members-panel"]')).toBeTruthy();
  });

  it("成員 fetch 失敗 → 繁中錯誤字,不 crash", async () => {
    vi.spyOn(marketApi, "fetchSectorMembers").mockRejectedValue(new Error("unknown_sector"));
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    fireEvent.click(screen.getByTestId("sector-row-btn-金融保險"));
    await waitFor(() => {
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("成員股載入失敗");
      expect(screen.getByTestId("sector-members-panel").textContent).toContain("unknown_sector");
    });
  });

  it("PCR/Max Pain 方向性文案禁令同樣適用:不寫做多/做空/賣選/滿倉", () => {
    render(wrap(<MarketSectorRotation data={rotation} loading={false} />));
    expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull();
  });
});
