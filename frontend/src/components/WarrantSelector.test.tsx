/**
 * @vitest-environment jsdom
 *
 * WarrantSelector — 權證選擇器 tab(SC-2/4/5/6/7)。
 * Mock 走 vi.spyOn(api),不 mock hooks(frontend-testing 慣例)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../lib/api";
import type {
  WarrantQuote, WarrantQuotesPayload, WarrantTerm, WarrantsPayload,
} from "../lib/warrant-data";
import { WarrantSelector } from "./WarrantSelector";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

function term(over: Partial<WarrantTerm> = {}): WarrantTerm {
  return {
    warrant_id: "030012",
    name: "台積凱基57購01",
    kind: "call",
    market: "twse",
    underlying_id: "2330",
    underlying_name: "台積電",
    strike: 950,
    exercise_ratio: 0.1,
    last_trading_date: "2026-07-28",
    maturity_date: "2026-07-30",
    is_reset: false,
    eod_close: 1.0,
    eod_bid: 0.99,
    eod_ask: 1.01,
    underlying_eod_close: 1000,
    iv_prev: 0.3,
    iv_drift: null,
    ...over,
  };
}

function quote(over: Partial<WarrantQuote> = {}): WarrantQuote {
  return {
    price: 1.3,
    best_bid: 1.29,
    best_ask: 1.31,
    best_bid_vol: 50,
    best_ask_vol: 124,
    moneyness: 0.05,
    days_left: 18,
    iv: 0.31,
    delta: 0.6,
    leverage: 4.6,
    spread_ratio: 0.0155,
    spread_lev_ratio: 0.0034,
    theo_price: 1.25,
    mispricing_pct: 0.04,
    mispricing_label: "fair",
    iv_percentile: 40,
    quote_time: "13:30",
    ...over,
  };
}

function mockApis(
  terms: WarrantTerm[],
  quotes: Record<string, WarrantQuote>,
): void {
  const wp: WarrantsPayload = { as_of_date: "2026-07-09", warrants: terms };
  const qp: WarrantQuotesPayload = {
    stock_id: "2330",
    underlying_price: 1000,
    quote_date: "2026-07-10",
    quote_time: "13:30",
    quotes,
  };
  vi.spyOn(api, "warrants").mockResolvedValue(wp);
  vi.spyOn(api, "warrantQuotes").mockResolvedValue(qp);
  vi.spyOn(api, "warrantIvHistory").mockResolvedValue({
    warrant_id: "030013",
    terms_approx_dates: [],
    series: [
      { date: "2026-07-08", iv_bid: 0.42, iv_ask: 0.46 },
      { date: "2026-07-09", iv_bid: 0.41, iv_ask: 0.45 },
    ],
    drift: { label: "stable", slope_bid: 0.0, slope_ask: 0.0, n_valid: 25 },
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

const THREE = [
  term(),
  term({ warrant_id: "030013", name: "台積元大58購02" }),
  term({ warrant_id: "03001P", name: "台積富邦57售01", kind: "put" }),
];
const THREE_QUOTES: Record<string, WarrantQuote> = {
  "030012": quote({ spread_lev_ratio: 0.005 }),
  "030013": quote({ spread_lev_ratio: 0.001 }),
  "03001P": quote({ spread_lev_ratio: null, mispricing_label: "expensive" }),
};

describe("WarrantSelector", () => {
  it("表格欄 header 齊全(SC-2)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    // 排序中欄位 header 帶 ↑/↓ 尾綴 → 比對前剝掉;/IV/ 寬 regex 會撞 IV百分位
    // (frontend-testing:selector 過鬆就收斂,不用 portal hack)
    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").replace(/ [↑↓]$/, ""));
    for (const h of [
      "代號", "名稱", "類型", "履約價", "價內外", "剩餘天數", "行使比例",
      "現價", "委買", "委賣", "IV", "理論價", "估價差", "IV百分位",
      "實質槓桿", "價差比", "差槓比",
    ]) {
      expect(headerTexts).toContain(h);
    }
  });

  it("市場欄 / preset 按鈕 / 載入分點欄已移除(mod warrant-ux-feedback item 2/6)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").replace(/ [↑↓]$/, ""));
    expect(headerTexts).not.toContain("市場");
    expect(headerTexts).not.toContain("分點買賣超");
    expect(screen.queryByTestId("preset-swing")).toBeNull();
    expect(screen.queryByTestId("flow-load-btn")).toBeNull();
    expect(screen.queryByTestId("flow-net-cell")).toBeNull();
  });

  it("預設差槓比升序,null 沉底(SC-2)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const ids = screen
      .getAllByTestId("warrant-row")
      .map((r) => r.getAttribute("data-warrant-id"));
    expect(ids).toEqual(["030013", "030012", "03001P"]);
  });

  it("認售 toggle 篩選(SC-4)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "認售" }));
    const rows = screen.getAllByTestId("warrant-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-warrant-id")).toBe("03001P");
  });

  it("kind badge 用 data-testid 正向鎖(SC-5)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const badges = screen.getAllByTestId("warrant-kind-badge");
    expect(badges).toHaveLength(3);
    expect(badges.map((b) => b.textContent)).toEqual(["認購", "認購", "認售"]);
    const labels = screen.getAllByTestId("mispricing-label");
    expect(labels.map((l) => l.textContent)).toContain("合理");
    expect(labels.map((l) => l.textContent)).toContain("偏貴");
    // real-env 2026-07-11:--color-accent 與 --color-bull 同色值(#e85a4f)—
    // 資料標籤(非互動態)用 accent 即是多頭紅,SC-5 鎖死不得出現
    for (const el of [...badges, ...labels]) {
      expect(el.className).not.toMatch(/accent|bull|bear/);
    }
  });

  it("嚴禁方向性文案(SC-5)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    expect(screen.queryByText(/做多|做空|買進|賣出|建議|滿倉|賣選/)).toBeNull();
  });

  it("無權證空狀態(SC-7)", async () => {
    mockApis([], {});
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() =>
      expect(screen.getByText("此標的無掛牌權證")).toBeTruthy(),
    );
  });

  it("未選標的顯示提示,不打 API", () => {
    const spy = vi.spyOn(api, "warrants").mockResolvedValue({
      as_of_date: null,
      warrants: [],
    });
    render(<WarrantSelector symbol="" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    expect(screen.getByText(/先搜尋標的/)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("快照基準日與最後更新顯示(SC-3 顯示面)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText(/最後更新 13:30/)).toBeTruthy());
    expect(screen.getByText(/快照基準日 2026-07-09/)).toBeTruthy();
  });

  it("重整鈕只刷 quotes 層(design R11)", async () => {
    mockApis(THREE, THREE_QUOTES);
    const wSpy = vi.spyOn(api, "warrants");
    const qSpy = vi.spyOn(api, "warrantQuotes");
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    // 等 data settle(isFetching 中重整鈕 disabled,click 會 no-op)
    await waitFor(() => expect(screen.getByText(/最後更新 13:30/)).toBeTruthy());
    expect(qSpy).toHaveBeenCalledTimes(1);
    const wCalls = wSpy.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重新整理權證報價" }));
    await waitFor(() => expect(qSpy).toHaveBeenCalledTimes(2));
    expect(qSpy.mock.calls[1]?.[1]).toBe(true); // refresh=true 跳 cooldown
    expect(wSpy.mock.calls.length).toBe(wCalls); // 快照層不重抓
  });

  it("IV趨勢欄:label 對映中性文案,stable/null 顯示 —(SC-6)", async () => {
    mockApis(
      [
        term({ iv_drift: "declining" }),
        term({ warrant_id: "030013", name: "台積元大58購02", iv_drift: "rising" }),
        term({ warrant_id: "03001P", name: "台積富邦57售01", kind: "put", iv_drift: "stable" }),
      ],
      THREE_QUOTES,
    );
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").replace(/ [↑↓]$/, ""));
    expect(headerTexts).toContain("IV趨勢");
    const cells = screen.getAllByTestId("iv-drift-label");
    expect(cells).toHaveLength(3);
    const byRow = new Map(
      screen
        .getAllByTestId("warrant-row")
        .map((r) => [
          r.getAttribute("data-warrant-id"),
          within(r).getByTestId("iv-drift-label").textContent,
        ]),
    );
    expect(byRow.get("030012")).toBe("長期遞減");
    expect(byRow.get("030013")).toBe("長期遞增");
    expect(byRow.get("03001P")).toBe("—"); // stable 不標,降表格噪音
    // 中性鐵則:不用紅綠方向色、不用指控性文案
    for (const el of cells) expect(el.className).not.toMatch(/accent|bull|bear/);
    expect(screen.queryByText(/惡意|坑殺|亂調/)).toBeNull();
  });

  it("row 展開 lazy 抓 IV 歷史並渲染時序圖(SC-7)", async () => {
    mockApis(THREE, THREE_QUOTES);
    const ivSpy = vi.spyOn(api, "warrantIvHistory");
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    expect(ivSpy).not.toHaveBeenCalled(); // 未展開不抓
    fireEvent.click(screen.getAllByRole("button", { name: /展開明細/ })[0]!);
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(ivSpy).toHaveBeenCalledTimes(1);
    expect(ivSpy.mock.calls[0]?.[0]).toBe("030013"); // 排序後首列
  });
});

// ---------------------------------------------------------------- warrant-selector-enhance

describe("WarrantSelector 欄位選單整合(mod warrant-ux-feedback SC-6)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("localStorage 隱藏欄 → th 消失,展開列 colSpan 跟著縮(= th 總數)", async () => {
    localStorage.setItem(
      "neigui.warrant-columns.v1",
      JSON.stringify({ order: [], hidden: ["iv", "exercise_ratio"] }),
    );
    mockApis([term()], {});
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").replace(/ [↑↓]$/, ""));
    expect(headerTexts).not.toContain("IV");
    expect(headerTexts).not.toContain("行使比例");
    expect(headerTexts).toContain("IV百分位"); // 只隱藏 iv,不誤傷同字根欄
    fireEvent.click(screen.getByRole("button", { name: /展開明細/ }));
    const expandedTd = document.querySelector("td[colspan]") as HTMLTableCellElement;
    expect(expandedTd.colSpan).toBe(screen.getAllByRole("columnheader").length);
  });

  it("localStorage 順序 → 表頭依偏好排列;th 帶 title 說明", async () => {
    const order = ["slr", "warrant_id", "name", "kind", "strike", "moneyness", "days_left",
      "exercise_ratio", "price", "bid", "ask", "iv", "theo_price", "mispricing",
      "iv_percentile", "iv_drift", "leverage", "spread_ratio"];
    localStorage.setItem(
      "neigui.warrant-columns.v1",
      JSON.stringify({ order, hidden: [] }),
    );
    mockApis([term()], {});
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    const ths = screen.getAllByRole("columnheader");
    expect((ths[1]?.textContent ?? "").replace(/ [↑↓]$/, "")).toBe("差槓比");
    const slrTh = ths[1]!;
    expect(slrTh.getAttribute("title")).toContain("價差比 ÷ 實質槓桿");
  });

  it("經選單勾掉欄位 → 表格即時反映且寫入 localStorage", async () => {
    mockApis([term()], {});
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("column-menu-btn"));
    const ivRow = document.querySelector('[data-column-id="iv"]')!;
    fireEvent.click(ivRow.querySelector("input[type=checkbox]")!);
    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").replace(/ [↑↓]$/, ""));
    expect(headerTexts).not.toContain("IV");
    const saved = JSON.parse(localStorage.getItem("neigui.warrant-columns.v1")!);
    expect(saved.hidden).toContain("iv");
  });
});

describe("WarrantSelector 篩選列改造(mod warrant-ux-feedback item 4)", () => {
  it("number input 換 NumberField:帶 name 屬性 + stepper 按鈕可調值", async () => {
    mockApis([term()], {});
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    const days = screen.getByLabelText("剩餘天數下限") as HTMLInputElement;
    expect(days.name).toBe("minDaysLeft"); // next-time a11y:form field 帶 name
    fireEvent.click(screen.getByLabelText("剩餘天數下限 增加"));
    // 剩餘天數 step=10(天數級距;% 欄 step=1、差槓比 0.05、委賣價 0.1)
    expect((screen.getByLabelText("剩餘天數下限") as HTMLInputElement).value).toBe("10");
  });

  it("stepper 調值會真的過濾(filters state 同步)", async () => {
    mockApis(
      [term(), term({ warrant_id: "030013" })],
      {
        "030012": quote({ days_left: 40 }),
        "030013": quote({ days_left: 0 }),
      },
    );
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(2));
    fireEvent.click(screen.getByLabelText("剩餘天數下限 增加")); // → 10;030013 days_left 0 被濾
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    expect(screen.getAllByTestId("warrant-row")[0]?.getAttribute("data-warrant-id")).toBe(
      "030012",
    );
  });
});

describe("WarrantSelector 重製篩選(mod warrant-ux-feedback item 3)", () => {
  it("調整篩選與排序後按重製 → 篩選/排序回預設、input 清空、rows 回全量", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "認售" }));
    expect(screen.getAllByTestId("warrant-row")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("剩餘天數下限"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /^履約價/ })); // 改排序
    fireEvent.click(screen.getByTestId("filter-reset-btn"));
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(3));
    expect((screen.getByLabelText("剩餘天數下限") as HTMLInputElement).value).toBe("");
    // 排序回預設差槓比 asc(null 沉底)
    const ids = screen
      .getAllByTestId("warrant-row")
      .map((r) => r.getAttribute("data-warrant-id"));
    expect(ids).toEqual(["030013", "030012", "03001P"]);
  });
});

describe("WarrantSelector 價量兩行呈現(mod warrant-ux-feedback item 6b)", () => {
  it("委買/委賣:價格主體 + ×N張 第二行", async () => {
    mockApis([term()], {
      "030012": quote({ best_bid: 1.23, best_bid_vol: 45, best_ask: 1.26, best_ask_vol: 12 }),
    });
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    const bid = screen.getByTestId("bid-cell");
    expect(bid.textContent).toContain("1.23");
    expect(bid.textContent).toContain("×45張");
    const ask = screen.getByTestId("ask-cell");
    expect(ask.textContent).toContain("1.26");
    expect(ask.textContent).toContain("×12張");
  });

  it("價 null → 單行 —;價在量 null → 無第二行;量 0 → ×0張(缺報價≠零掛單)", async () => {
    mockApis(
      [term(), term({ warrant_id: "030013" })],
      {
        // 030012:bid 全缺、ask 有價量 0;030013:bid 有價量 null
        "030012": quote({
          best_bid: null, best_bid_vol: null, best_ask: 2.5, best_ask_vol: 0, days_left: 60,
        }),
        "030013": quote({ best_bid: 1.0, best_bid_vol: null, days_left: 60 }),
      },
    );
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("warrant-row");
    const r12 = rows.find((r) => r.getAttribute("data-warrant-id") === "030012")!;
    const r13 = rows.find((r) => r.getAttribute("data-warrant-id") === "030013")!;
    const bid12 = within(r12).getByTestId("bid-cell");
    expect(bid12.textContent?.replace(/\s/g, "")).toBe("—");
    expect(within(r12).getByTestId("ask-cell").textContent).toContain("×0張");
    const bid13 = within(r13).getByTestId("bid-cell");
    expect(bid13.textContent).toContain("1.00");
    expect(bid13.textContent).not.toContain("×");
  });
});

describe("WarrantSelector 懸崖 / 近售罄 badge(SC-8/SC-9)", () => {
  it("days_left ≤21 顯示近到期 badge,title 含法規口徑", async () => {
    mockApis([term()], { "030012": quote({ days_left: 18 }) });
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("cliff-badge")).toBeTruthy());
    expect(screen.getByTestId("cliff-badge").getAttribute("title")).toContain("15 個交易日");
  });

  it("days_left >21 無懸崖 badge", async () => {
    mockApis([term()], { "030012": quote({ days_left: 60 }) });
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    expect(screen.queryByTestId("cliff-badge")).toBeNull();
  });

  it("委賣消失+委買在 → 近售罄 badge;懸崖區內抑制", async () => {
    mockApis(
      [term(), term({ warrant_id: "030013" })],
      {
        "030012": quote({ best_ask: null, best_ask_vol: null, days_left: 60 }),
        "030013": quote({ best_ask: null, best_ask_vol: null, days_left: 10 }),
      },
    );
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("soldout-badge")).toHaveLength(1));
    const row = screen.getAllByTestId("warrant-row")[0]!;
    expect(within(row).getByTestId("soldout-badge")).toBeTruthy();
  });
});

describe("WarrantSelector 分點買賣超移除(mod warrant-selector-table SC-3)", () => {
  it("展開列只剩 IV 時序,無分點買賣超區塊", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /展開明細/ })[0]!);
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(screen.queryByTestId("warrant-brokers-detail")).toBeNull();
    expect(screen.queryByText(/分點買賣超/)).toBeNull();
  });
});

describe("WarrantSelector 發行商篩選(mod warrant-selector-table SC-2)", () => {
  it("下拉選項 = 全部 + 該標的實際發行商;選定後過濾;重製回全部", async () => {
    // THREE 的名稱含凱基/元大/富邦三家 → 選項自 terms 推導(不隨其他篩選縮)
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const select = screen.getByLabelText("發行商篩選") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "全部", "元大", "凱基", "富邦",
    ]);
    fireEvent.change(select, { target: { value: "凱基" } });
    const rows = screen.getAllByTestId("warrant-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-warrant-id")).toBe("030012");
    fireEvent.click(screen.getByTestId("filter-reset-btn"));
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(3));
    expect((screen.getByLabelText("發行商篩選") as HTMLSelectElement).value).toBe("all");
  });
});

describe("WarrantSelector 表頭對齊(mod warrant-selector-table SC-1)", () => {
  it("代號/名稱/類型表頭靠左、其餘資料欄表頭靠右(與 td 對齊一致)", async () => {
    // first:text-left 打在展開空 th(真正的 :first-child)上,資料欄表頭
    // 全部右對齊 — 依欄位 align 屬性渲染後,文字欄表頭須與 td 同向。
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const byLabel = new Map(
      screen
        .getAllByRole("columnheader")
        .map((th) => [(th.textContent ?? "").replace(/ [↑↓]$/, ""), th.className]),
    );
    for (const h of ["代號", "名稱", "類型"]) {
      expect(byLabel.get(h)).toContain("text-left");
      expect(byLabel.get(h)).not.toContain("text-right");
    }
    for (const h of ["履約價", "現價", "差槓比"]) {
      expect(byLabel.get(h)).toContain("text-right");
      expect(byLabel.get(h)).not.toContain("text-left");
    }
  });
});

describe("WarrantSelector review 修正批(Phase 5)", () => {
  it("篩選 input 打字值不被無關 filter 變更沖掉(uncontrolled+epoch 機制)", async () => {
    // 「-」「0.」badInput 中間態 jsdom 一律 sanitize 成 "",controlled/uncontrolled
    // 不可分辨 → 該情境由 Phase 7 真實環境(DevTools)驗;這裡鎖 epoch 機制:
    // 無關 state 變更(kind toggle)不 remount(重製按鈕的 remount 覆寫由
    // 重製篩選測試鎖)
    mockApis([term()], {});
    render(<WarrantSelector symbol="2330" active />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    const days = screen.getByLabelText("剩餘天數下限") as HTMLInputElement;
    fireEvent.change(days, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "認購" })); // 無關 filter 變更
    expect((screen.getByLabelText("剩餘天數下限") as HTMLInputElement).value).toBe("45");
  });

  it("手動輸入篩選值後切 symbol,篩選歸零且 input 清空(epoch remount)", async () => {
    mockApis([term()], {});
    const { rerender } = render(<WarrantSelector symbol="2330" active />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getAllByTestId("warrant-row")).toHaveLength(1));
    const daysInput = screen.getByLabelText("剩餘天數下限") as HTMLInputElement;
    fireEvent.change(daysInput, { target: { value: "45" } });
    expect(daysInput.value).toBe("45");
    rerender(<WarrantSelector symbol="2317" active />);
    await waitFor(() =>
      expect((screen.getByLabelText("剩餘天數下限") as HTMLInputElement).value).toBe(""),
    );
  });
});
