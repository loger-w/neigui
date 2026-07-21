/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketIndexStrength } from "./MarketIndexStrength";
import type { IndexStrength } from "../lib/market-types";

afterEach(() => cleanup());

const full: IndexStrength = {
  twse: { close: 42650.6, change_rate: -0.04, median_change_rate: -1.8, spread: 1.76 },
  tpex: { close: 370.4, change_rate: -2.11, median_change_rate: -2.4, spread: 0.29 },
  tsmc: { change_rate: 1.2, contrib_points: 210.5 },
  ex_tsmc: { change_points: -45.3, change_rate: -0.21 },
  contrib: {
    twse: {
      up: [{ stock_id: "2330", name: "台積電", change_rate: 1.2, contrib_points: 210.5 }],
      down: [{ stock_id: "2454", name: "聯發科", change_rate: -1.5, contrib_points: -30.2 }],
    },
    tpex: { up: [], down: [] },
  },
};

describe("MarketIndexStrength", () => {
  it("loading=true → data-state=loading skeleton", () => {
    render(<MarketIndexStrength data={null} loading={true} />);
    const root = screen.getByTestId("market-index-strength");
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it("loading=false + data=null → 資料暫缺(SC-5 全域尚未載入)", () => {
    render(<MarketIndexStrength data={null} loading={false} />);
    const root = screen.getByTestId("market-index-strength");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
    expect(root.textContent).toContain("資料暫缺");
  });

  it("twse/tpex 側正常 → 顯示漲跌 + spread 判讀(SC-1)", () => {
    render(<MarketIndexStrength data={full} loading={false} />);
    const twse = screen.getByTestId("idx-side-twse");
    expect(twse.textContent).toContain("-0.04%");
    expect(twse.textContent).toContain("權值拉抬");
    expect(twse.textContent).toContain("+1.76pp");

    const tpex = screen.getByTestId("idx-side-tpex");
    expect(tpex.textContent).toContain("-2.11%");
    expect(tpex.textContent).toContain("權值拉抬");
    expect(tpex.textContent).toContain("+0.29pp");
  });

  it("spread<0 → 顯示「中小強於指數」判讀(獨立於 twse/tpex 具體數值)", () => {
    const negSpread: IndexStrength = {
      ...full,
      twse: { ...full.twse!, spread: -0.5 },
    };
    render(<MarketIndexStrength data={negSpread} loading={false} />);
    const twse = screen.getByTestId("idx-side-twse");
    expect(twse.textContent).toContain("中小強於指數");
    expect(twse.textContent).toContain("-0.50pp");
  });

  it("R5:twse index row 缺席 → 該側 null,不 crash,顯示資料暫缺", () => {
    const degraded: IndexStrength = {
      ...full,
      twse: null,
      contrib: { twse: null, tpex: full.contrib.tpex },
    };
    render(<MarketIndexStrength data={degraded} loading={false} />);
    const twse = screen.getByTestId("idx-side-twse");
    expect(twse.getAttribute("data-state")).toBe("unavailable");
    // tpex 側不受影響
    const tpex = screen.getByTestId("idx-side-tpex");
    expect(tpex.textContent).toContain("-2.11%");
  });

  it("台積電列顯示漲跌 + 對加權貢獻點數(估算字樣)", () => {
    render(<MarketIndexStrength data={full} loading={false} />);
    const tsmc = screen.getByTestId("idx-tsmc");
    expect(tsmc.textContent).toContain("+1.20%");
    expect(tsmc.textContent).toContain("估算");
    expect(tsmc.textContent).toContain("+210.5");
  });

  it("貢獻 top5:up/down 各自列出,contrib null → 該側資料暫缺", () => {
    render(<MarketIndexStrength data={full} loading={false} />);
    const twseContrib = screen.getByTestId("idx-contrib-twse");
    expect(twseContrib.querySelector('[data-testid="idx-contrib-twse-up"]')?.textContent).toContain(
      "台積電",
    );
    expect(
      twseContrib.querySelector('[data-testid="idx-contrib-twse-down"]')?.textContent,
    ).toContain("聯發科");

    const tpexContrib = screen.getByTestId("idx-contrib-tpex");
    expect(tpexContrib.textContent).toContain("無資料");
  });

  it("contrib.tpex 整組 null(R12)→ 該側資料暫缺,不影響 twse", () => {
    const degraded: IndexStrength = { ...full, contrib: { twse: full.contrib.twse, tpex: null } };
    render(<MarketIndexStrength data={degraded} loading={false} />);
    const tpexContrib = screen.getByTestId("idx-contrib-tpex");
    expect(tpexContrib.getAttribute("data-state")).toBe("unavailable");
  });

  it("PCR/Max Pain 方向性文案禁令同樣適用:不寫做多/做空/賣選/滿倉", () => {
    render(<MarketIndexStrength data={full} loading={false} />);
    expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull();
  });
});

// MK-1/MK-2(mod/batch-ui-update):扣除台積電列 + 拉抬 pp 說明 hint。
describe("MarketIndexStrength — MK-1 扣除台積電 / MK-2 pp hint", () => {
  // 痛點:MK-1 — 加權被 2330 單股綁架時,扣除後的點數/% 才看得出大盤真貌。
  it("顯示扣除台積電後的加權漲跌點數與 %", () => {
    render(<MarketIndexStrength data={full} loading={false} />);
    const row = screen.getByTestId("idx-ex-tsmc");
    expect(row.textContent).toContain("扣除台積電");
    expect(row.textContent).toContain("-45.3 點");
    expect(row.textContent).toContain("-0.21%");
  });

  it("ex_tsmc 兩欄 null → 顯示 —", () => {
    const degraded: IndexStrength = {
      ...full,
      ex_tsmc: { change_points: null, change_rate: null },
    };
    render(<MarketIndexStrength data={degraded} loading={false} />);
    expect(screen.getByTestId("idx-ex-tsmc").textContent).toContain("—");
  });

  // 痛點:MK-2 — user 直問「拉抬 多少 pp 這是甚麼意思」;文案要自我解釋。
  it("卡片標題附 pp 說明 hint,點開含百分點解釋", () => {
    render(<MarketIndexStrength data={full} loading={false} />);
    const hint = screen.getByLabelText("拉抬指標說明");
    fireEvent.click(hint);
    expect(document.body.textContent).toContain("百分點");
    expect(document.body.textContent).toContain("中位數");
  });
});
