/**
 * @vitest-environment jsdom
 *
 * Cluster C 🔴: ChipBrokersPanel F4 (drop symbol/date + 三大法人 block),
 * F5 (split top-15 buyers + sellers into two scroll halves in net mode),
 * F7 (move 主力買賣超 above 融資融券).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChipBrokersPanel } from "./ChipBrokersPanel";
import type { ChipSummary, TopBroker } from "../lib/chip-data";

afterEach(() => cleanup());

const mkBroker = (overrides: Partial<TopBroker>): TopBroker => ({
  name: "凱基台北",
  broker_id: "9201A",
  buy: 100,
  sell: 50,
  net: 50,
  avg_buy_price: 100,
  avg_sell_price: 100,
  ...overrides,
});

const mkSummary = (top: TopBroker[]): ChipSummary =>
  ({
    symbol: "2330",
    date: "2026-06-22",
    fetched_at: "",
    institutional: {
      foreign: { buy: 100, sell: 50, net: 50 },
      trust: { buy: 0, sell: 0, net: 0 },
      dealer: { buy: 0, sell: 0, net: 0 },
    },
    margin: {
      margin_purchase: { balance: 1000, change: 100, limit: 5000 },
      short_sale: { balance: 200, change: -10, limit: 5000 },
      short_balance_ratio: 20,
    },
    top_brokers: top,
  }) as ChipSummary;

const topBrokers: TopBroker[] = [
  ...Array.from({ length: 8 }, (_, i) =>
    mkBroker({ broker_id: `B${i}`, name: `Buyer-${i}`, buy: 100, sell: 10, net: 90 }),
  ),
  ...Array.from({ length: 6 }, (_, i) =>
    mkBroker({ broker_id: `S${i}`, name: `Seller-${i}`, buy: 10, sell: 100, net: -90 }),
  ),
];

const noop = () => {};

describe("ChipBrokersPanel — broker name tooltip (full name on hover)", () => {
  it("each broker row has a tooltip element carrying the full name", () => {
    const long = mkBroker({
      broker_id: "LONG1", name: "瑞士信貸-香港分行台北辦事處",
      buy: 100, sell: 0, net: 100,
    });
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([long])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const tooltips = container.querySelectorAll(
      "[data-testid=broker-name-tooltip]",
    );
    expect(tooltips.length).toBeGreaterThan(0);
    expect(tooltips[0]!.textContent).toBe("瑞士信貸-香港分行台北辦事處");
  });

  it("broker name span carries title attribute for native tooltip fallback", () => {
    const long = mkBroker({
      broker_id: "LONG2", name: "凱基證券台北",
      buy: 100, sell: 0, net: 100,
    });
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([long])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const titled = container.querySelector("[title='凱基證券台北']");
    expect(titled).toBeTruthy();
  });
});

// CH-4(mod/batch-ui-update):右欄瘦身 — 日期 header 刪除、主力併入法人
// grid(無「三大法人」標題)、「融資融券」標題刪除,騰空間給前 15 大列表。
describe("ChipBrokersPanel — CH-4 右欄瘦身", () => {
  // 痛點:CH-4a — 日期/過去N日 header 佔一列;N 日脈絡已由 K 線 HUD 承載。
  it("does NOT render the window/date header for any windowDays", () => {
    for (const days of [undefined, 1, 30]) {
      const { container, unmount } = render(
        <ChipBrokersPanel
          summary={mkSummary(topBrokers)}
          dayTotalLots={1000}
          selectedBrokerIds={new Set()}
          onToggleBroker={noop}
          onClearAllBrokers={noop}
          windowDays={days}
        />,
      );
      expect(container.querySelector("[data-testid=window-header]")).toBeFalsy();
      expect(container.textContent).not.toContain("當日");
      expect(container.textContent).not.toContain("日加總");
      unmount();
    }
  });

  // 痛點:CH-4b — 主力/外資/投信/自營商同層 4 欄,不再有「三大法人」標題列。
  it("renders 主力 alongside 外資/投信/自營商 in one grid without the 三大法人 heading", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const inst = container.querySelector("[data-testid=panel-institutional]")!;
    expect(inst).toBeTruthy();
    expect(inst.textContent).toContain("主力");
    expect(inst.textContent).toContain("外資");
    expect(inst.textContent).toContain("投信");
    expect(inst.textContent).toContain("自營商");
    expect(inst.querySelector("[data-testid=inst-major-net]")).toBeTruthy();
    expect(container.textContent).not.toContain("三大法人");
  });

  // 痛點:CH-4c — 「融資融券」標題刪除,數值列(增減/券資比/餘額)保留。
  it("drops the 融資融券 heading but keeps its data rows", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(container.textContent).not.toContain("融資融券");
    expect(container.textContent).toContain("融資增減");
    expect(container.textContent).toContain("融券增減");
    expect(container.textContent).toContain("券資比");
    expect(container.textContent).toContain("融資餘額");
    expect(container.textContent).toContain("融券餘額");
  });
});

// (chip-controls-v2 2026-06-29) panel-window-frame describe deprecated —
// 區間視覺改在 K 線上,panel 不再做左緣 accent 直條。對應實作 + testid 已移除。

describe("ChipBrokersPanel — 三大法人 N-day net (chip-controls-v3)", () => {
  // F4 (v0.16.0) removed 三大法人 block under the assumption that K-line
  // subcharts cover that info. chip-controls-v3 brings it back into the
  // panel because subcharts no longer carry the N-day range band — user
  // needs aggregate net numbers visible alongside 主力買賣超.
  const instSummary = (foreignNet: number, trustNet: number, dealerNet: number) =>
    ({
      symbol: "2330",
      date: "2026-06-22",
      fetched_at: "",
      institutional: {
        foreign: { buy: foreignNet > 0 ? foreignNet : 0, sell: foreignNet < 0 ? -foreignNet : 0, net: foreignNet },
        trust: { buy: trustNet > 0 ? trustNet : 0, sell: trustNet < 0 ? -trustNet : 0, net: trustNet },
        dealer: { buy: dealerNet > 0 ? dealerNet : 0, sell: dealerNet < 0 ? -dealerNet : 0, net: dealerNet },
      },
      margin: {
        margin_purchase: { balance: 1000, change: 100, limit: 5000 },
        short_sale: { balance: 200, change: -10, limit: 5000 },
        short_balance_ratio: 20,
      },
      top_brokers: topBrokers,
    }) as ChipSummary;

  it("renders 外資 / 投信 / 自營商 net rows", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={instSummary(50000, -3000, 1234)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        windowDays={30}
      />,
    );
    const inst = container.querySelector("[data-testid=panel-institutional]");
    expect(inst).toBeTruthy();
    expect(inst!.textContent).toContain("外資");
    expect(inst!.textContent).toContain("投信");
    expect(inst!.textContent).toContain("自營商");
    // Net values formatted with thousand separators + sign
    expect(inst!.textContent).toContain("+50,000");
    expect(inst!.textContent).toContain("-3,000");
    expect(inst!.textContent).toContain("+1,234");
  });

  it("positive net uses bull color (台股紅), negative uses bear (綠)", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={instSummary(50000, -3000, 0)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        windowDays={1}
      />,
    );
    const inst = container.querySelector("[data-testid=panel-institutional]")!;
    const foreignVal = inst.querySelector("[data-testid=inst-foreign-net]");
    const trustVal = inst.querySelector("[data-testid=inst-trust-net]");
    expect(foreignVal!.className).toContain("accent"); // bull = accent
    expect(trustVal!.className).toContain("bear");
  });

  it("zero net renders as 0 with neutral color", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={instSummary(0, 0, 0)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        windowDays={1}
      />,
    );
    const inst = container.querySelector("[data-testid=panel-institutional]")!;
    const dealerVal = inst.querySelector("[data-testid=inst-dealer-net]");
    expect(dealerVal!.textContent).toContain("0");
  });

  it("appears BEFORE the margin data rows in DOM order", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={instSummary(100, 200, 300)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        windowDays={30}
      />,
    );
    const html = container.innerHTML;
    const instIdx = html.indexOf("外資");
    const marginIdx = html.indexOf("融資增減");
    expect(instIdx).toBeGreaterThan(-1);
    expect(marginIdx).toBeGreaterThan(-1);
    expect(instIdx).toBeLessThan(marginIdx);
  });

  it("does NOT render the top-level symbol+date header", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    // The deleted header rendered summary.symbol "2330" inside a <span> with
    // class font-serif text-lg. After F4 the symbol number does not appear at
    // the top of the panel any more.
    const symbolHeaders = container.querySelectorAll("span.font-serif");
    for (const el of symbolHeaders) {
      expect(el.textContent).not.toBe("2330");
    }
  });
});

describe("ChipBrokersPanel F7 — 主力 above margin rows", () => {
  it("主力 cell appears BEFORE 融資增減 row in DOM order", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const html = container.innerHTML;
    const majorIdx = html.indexOf("主力");
    const marginIdx = html.indexOf("融資增減");
    expect(majorIdx).toBeGreaterThan(-1);
    expect(marginIdx).toBeGreaterThan(-1);
    expect(majorIdx).toBeLessThan(marginIdx);
  });
});

describe("ChipBrokersPanel loading indicator (Cluster B 🟢)", () => {
  it("renders visual loading indicator + aria-busy when loading=true and summary present", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        loading
      />,
    );
    // The text caption was replaced with a 2 px scanning accent bar; the
    // contract is "user can perceive loading", asserted via the data-testid
    // and aria-busy on the panel root.
    expect(container.querySelector("[data-testid=panel-loading-indicator]")).toBeTruthy();
    expect(container.querySelector("[aria-busy=true]")).toBeTruthy();
    expect(container.textContent).not.toContain("載入中");
  });

  it("does NOT render loading indicator when loading=false", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        loading={false}
      />,
    );
    expect(container.querySelector("[data-testid=panel-loading-indicator]")).toBeFalsy();
    expect(container.querySelector("[aria-busy=true]")).toBeFalsy();
  });

  it("placeholder shows when summary is null regardless of loading", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={null}
        dayTotalLots={0}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        loading
      />,
    );
    expect(container.textContent).toContain("請搜尋股票代號");
    // The loading indicator only renders when summary exists (would be
    // redundant alongside the empty-state placeholder).
    expect(container.querySelector("[data-testid=panel-loading-indicator]")).toBeFalsy();
  });
});

describe("ChipBrokersPanel F5 — buyers + sellers in separate scrollable halves", () => {
  it("net mode has two scrollable halves (data-testids buyers-scroll + sellers-scroll)", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(container.querySelector("[data-testid=buyers-scroll]")).toBeTruthy();
    expect(container.querySelector("[data-testid=sellers-scroll]")).toBeTruthy();
  });

  it("volume mode renders ONE scrollable list (no buyers/sellers split)", () => {
    const { container, getByText } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByText("前 15 大交易量分點"));
    expect(container.querySelector("[data-testid=buyers-scroll]")).toBeFalsy();
    expect(container.querySelector("[data-testid=sellers-scroll]")).toBeFalsy();
    expect(container.querySelector("[data-testid=volume-scroll]")).toBeTruthy();
  });

  it("clicking buyer + seller checkbox each fires onToggleBroker(broker_id)", () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByLabelText("勾選 Buyer-0"));
    fireEvent.click(getByLabelText("勾選 Seller-0"));
    // Selection is keyed by broker_id, not name — that's the value the
    // SecIdAgg broker_history endpoint filters on.
    expect(onToggle).toHaveBeenCalledWith("B0");
    expect(onToggle).toHaveBeenCalledWith("S0");
  });
});

describe("ChipBrokersPanel — avg buy/sell price as independent columns", () => {
  const avgBrokers: TopBroker[] = [
    mkBroker({
      broker_id: "BUY1", name: "BuyerWithAvg",
      buy: 100, sell: 0, net: 100,
      avg_buy_price: 100.5, avg_sell_price: 0,
    }),
    mkBroker({
      broker_id: "BUY2", name: "BuyerBothSides",
      buy: 80, sell: 20, net: 60,
      avg_buy_price: 99.25, avg_sell_price: 101.4,
    }),
    mkBroker({
      broker_id: "SELL1", name: "SellerWithAvg",
      buy: 0, sell: 100, net: -100,
      avg_buy_price: 0, avg_sell_price: 102.75,
    }),
  ];

  it("net mode header has dedicated 買均 + 賣均 columns alongside 買張 + 賣張", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(avgBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector("[data-testid=buyers-scroll]");
    expect(buyers).toBeTruthy();
    // sticky header — at least one occurrence of each column name
    const header = buyers!.querySelector(".sticky");
    expect(header?.textContent).toContain("買張");
    expect(header?.textContent).toContain("買均");
    expect(header?.textContent).toContain("賣張");
    expect(header?.textContent).toContain("賣均");
  });

  it("net mode: avg price renders as plain 2-decimal number in its own column (no @ prefix)", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(avgBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector("[data-testid=buyers-scroll]");
    expect(buyers!.textContent).toContain("100.50");
    expect(buyers!.textContent).toContain("99.25");
    // The @ prefix from the previous caption layout must not leak into the
    // new column-based layout.
    expect(buyers!.textContent).not.toContain("@100.50");
  });

  it("net mode: buyer row WITH non-zero sell renders both buy + sell avg in their columns", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(avgBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector("[data-testid=buyers-scroll]");
    expect(buyers!.textContent).toContain("99.25");
    expect(buyers!.textContent).toContain("101.40");
  });

  it("net mode: seller row renders 賣均 value in its column", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(avgBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const sellers = container.querySelector("[data-testid=sellers-scroll]");
    expect(sellers!.textContent).toContain("102.75");
  });

  it("buy-only broker: 賣均 cell renders dash, not 0.00", () => {
    const onlyBuy = mkBroker({
      broker_id: "B_ONLY", name: "OnlyBuy",
      buy: 50, sell: 0, net: 50,
      avg_buy_price: 100.5, avg_sell_price: 0,
    });
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([onlyBuy])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector("[data-testid=buyers-scroll]");
    expect(buyers!.textContent).not.toContain("0.00");
    expect(buyers!.textContent).toMatch(/—/);
  });

  it("volume mode: 買均 + 賣均 are independent columns in header and rows", () => {
    const { container, getByText } = render(
      <ChipBrokersPanel
        summary={mkSummary(avgBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByText("前 15 大交易量分點"));
    const vol = container.querySelector("[data-testid=volume-scroll]");
    expect(vol).toBeTruthy();
    const header = vol!.querySelector(".sticky");
    expect(header?.textContent).toContain("買均");
    expect(header?.textContent).toContain("賣均");
    expect(vol!.textContent).toContain("99.25");
    expect(vol!.textContent).toContain("101.40");
  });
});

describe("ChipBrokersPanel — column order: 買均 賣均 買張 賣張", () => {
  // Distinct numbers per cell so textContent ordering is unambiguous.
  const sample = mkBroker({
    broker_id: "ORDER1", name: "OrderRow",
    buy: 1234, sell: 567, net: 667,
    avg_buy_price: 99.99, avg_sell_price: 88.88,
  });
  const summary = mkSummary([sample]);

  it("net mode header: 買均 appears before 賣均, both before 買張 / 賣張", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={summary}
        dayTotalLots={5000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const header = container
      .querySelector("[data-testid=buyers-scroll]")!
      .querySelector(".sticky");
    const text = header?.textContent ?? "";
    expect(text.indexOf("買均")).toBeGreaterThan(-1);
    expect(text.indexOf("賣均")).toBeGreaterThan(text.indexOf("買均"));
    expect(text.indexOf("買張")).toBeGreaterThan(text.indexOf("賣均"));
    expect(text.indexOf("賣張")).toBeGreaterThan(text.indexOf("買張"));
  });

  it("net mode data row: 99.99 → 88.88 → 1,234 → 567 (avg pair first, then vol pair)", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={summary}
        dayTotalLots={5000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const row = container.querySelector("[data-testid=buyers-scroll]");
    const txt = row?.textContent ?? "";
    expect(txt.indexOf("99.99")).toBeGreaterThan(-1);
    expect(txt.indexOf("88.88")).toBeGreaterThan(txt.indexOf("99.99"));
    expect(txt.indexOf("1,234")).toBeGreaterThan(txt.indexOf("88.88"));
    expect(txt.indexOf("567")).toBeGreaterThan(txt.indexOf("1,234"));
  });

  it("volume mode header: 買均 賣均 buy vol sell vol 當沖率 (in that order)", () => {
    const { container, getByText } = render(
      <ChipBrokersPanel
        summary={summary}
        dayTotalLots={5000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByText("前 15 大交易量分點"));
    const header = container
      .querySelector("[data-testid=volume-scroll]")!
      .querySelector(".sticky");
    const text = header?.textContent ?? "";
    expect(text.indexOf("買均")).toBeGreaterThan(-1);
    expect(text.indexOf("賣均")).toBeGreaterThan(text.indexOf("買均"));
    expect(text.indexOf("買張")).toBeGreaterThan(text.indexOf("賣均"));
    expect(text.indexOf("賣張")).toBeGreaterThan(text.indexOf("買張"));
    expect(text.indexOf("當沖率")).toBeGreaterThan(text.indexOf("賣張"));
  });
});

// B2 (C3 🔴): 選 broker 前後 chip bar 容器高度 & 位置一致(anti-CLS)。
// 未選時 placeholder「未選擇分點」佔位;選了才顯 chip tags。
describe("ChipBrokersPanel — B2 chip bar 容器常駐 (C3 🔴)", () => {
  it("未選任何 broker → chip bar 容器存在 + 顯示「未選擇分點」placeholder", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const bar = container.querySelector("[data-testid=chip-selected-bar]");
    expect(bar).toBeTruthy();
    expect((bar!.textContent ?? "").includes("未選擇分點")).toBe(true);
  });

  it("已選 1 個 broker → chip bar 顯示 tag,不顯 placeholder", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set(["B0"])}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const bar = container.querySelector("[data-testid=chip-selected-bar]");
    expect(bar).toBeTruthy();
    expect((bar!.textContent ?? "").includes("Buyer-0")).toBe(true);
    expect((bar!.textContent ?? "").includes("未選擇分點")).toBe(false);
  });

  it("已選 2+ → chip tags + 「全部清除」button", () => {
    const onClearAll = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set(["B0", "B1"])}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={onClearAll}
      />,
    );
    const bar = container.querySelector("[data-testid=chip-selected-bar]") as HTMLElement;
    expect(bar).toBeTruthy();
    expect((bar.textContent ?? "").includes("Buyer-0")).toBe(true);
    expect((bar.textContent ?? "").includes("Buyer-1")).toBe(true);
    const clearBtn = Array.from(bar.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "全部清除",
    );
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});

// SC-3 (mod/batch-ui-polish 🔴): 精簡列表 chrome — 賣超半區不重複 header
// (欄位語意由買超 header 承載)、# 序號欄整個移除(net + volume 一致)。
describe("ChipBrokersPanel — SC-3 header/序號精簡", () => {
  const renderPanel = () =>
    render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );

  it("net 模式只有買超半區有欄位 header(賣超半區無「淨買賣」標題)", () => {
    const { container } = renderPanel();
    const buyers = container.querySelector('[data-testid="buyers-scroll"]')!;
    const sellers = container.querySelector('[data-testid="sellers-scroll"]')!;
    expect((buyers.textContent ?? "").includes("淨買賣")).toBe(true);
    expect((sellers.textContent ?? "").includes("淨買賣")).toBe(false);
    // 分隔帶仍在
    expect((sellers.textContent ?? "").includes("賣超")).toBe(true);
  });

  it("買超 header 無「#」欄標題", () => {
    const { container } = renderPanel();
    const buyers = container.querySelector('[data-testid="buyers-scroll"]')!;
    const headerSpans = [...buyers.querySelectorAll(".sticky span")].map(
      (s) => s.textContent,
    );
    expect(headerSpans.includes("#")).toBe(false);
    expect(headerSpans.includes("分點")).toBe(true);
  });

  it("列不再顯示序號數字(checkbox 後第一欄即分點名)", () => {
    const { container } = renderPanel();
    const row = container.querySelector('[role="button"][aria-pressed]')!;
    // 舊版 checkbox 與名稱之間有 rank span;移除後 children[1] 直接是
    // 帶 title 的名稱欄
    const second = row.children[1] as HTMLElement;
    expect(second.getAttribute("title")).toBeTruthy();
  });

  it("volume 模式 header 無「#」且保留當沖率欄", () => {
    const { container, getByText } = renderPanel();
    fireEvent.click(getByText("前 15 大交易量分點"));
    const vol = container.querySelector('[data-testid="volume-scroll"]')!;
    const headerSpans = [...vol.querySelectorAll(".sticky span")].map(
      (s) => s.textContent,
    );
    expect(headerSpans.includes("#")).toBe(false);
    expect(headerSpans.includes("當沖率")).toBe(true);
  });
});

// B1 (C8 🟢): 整 row 可點,擴大 hit area 讓 tap target 從 checkbox 16px
// 提升到整 row 高度。同時保留 checkbox 可獨立點擊(不 double-toggle)。
describe("ChipBrokersPanel — B1 整 row 可點 (C8 🟢)", () => {
  // 用單一 buyer 讓 row selector 唯一
  const single = mkBroker({ broker_id: "B0", name: "Buyer-0", buy: 100, sell: 0, net: 100 });

  it("點 row 空白處(非 checkbox)→ onToggleBroker 呼叫一次 with broker_id", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
      />,
    );
    const row = container.querySelector('[role="button"][aria-pressed]') as HTMLElement;
    expect(row).toBeTruthy();
    // Click the row itself (empty area, not inside the checkbox <label>);
    // SC-3 後序號欄已移除,不再有 rank span 可點。
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("B0");
  });

  it("點 checkbox → onToggleBroker 只呼叫一次(row 不 double-toggle)", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
      />,
    );
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.click(input);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("Row focus 後按 Enter 鍵 → onToggleBroker called", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
      />,
    );
    const row = container.querySelector('[role="button"][aria-pressed]') as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("Row aria-pressed 反映 selected 狀態", () => {
    const { container, rerender } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    let row = container.querySelector('[role="button"][aria-pressed]') as HTMLElement;
    expect(row.getAttribute("aria-pressed")).toBe("false");
    rerender(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set(["B0"])}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    row = container.querySelector('[role="button"][aria-pressed]') as HTMLElement;
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ChipBrokersPanel — flowScroll(手機堆疊)模式", () => {
  it("flowScroll 時清單容器不設內捲、header 不 sticky,交外層頁面捲動", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        flowScroll
      />,
    );
    const root = container.querySelector('[data-testid="chip-brokers-panel"]')!;
    expect(root.className.includes("overflow-hidden")).toBe(false);
    const buyers = container.querySelector('[data-testid="buyers-scroll"]')!;
    const sellers = container.querySelector('[data-testid="sellers-scroll"]')!;
    for (const el of [buyers, sellers]) {
      expect(el.className.includes("overflow-y-auto")).toBe(false);
    }
    expect(container.querySelector(".sticky")).toBeNull();
  });

  it("預設(桌面)維持內捲 + sticky header", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector('[data-testid="buyers-scroll"]')!;
    expect(buyers.className.includes("overflow-y-auto")).toBe(true);
    expect(container.querySelector(".sticky")).toBeTruthy();
  });
});
// CH-1(mod/batch-ui-update 🟢):前 15 大列表每列「看泡泡圖」動作鈕 —
// 點擊跳泡泡圖 tab 並聚焦該分點(App 層接線),不得吃掉整列 click(白名單 2)。
describe("ChipBrokersPanel — CH-1 看泡泡圖動作鈕", () => {
  const single = mkBroker({
    broker_id: "X1", name: "單一分點", buy: 100, sell: 10, net: 90,
  });

  it("有 onShowInBubble → 每列渲染動作鈕,點擊回傳 (broker_id, name) 且不觸發整列 toggle", () => {
    const onToggle = vi.fn();
    const onShow = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
        onShowInBubble={onShow}
      />,
    );
    const btn = container.querySelector(
      "[data-testid=broker-row-bubble-btn]",
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute("aria-label")).toContain("單一分點");
    fireEvent.click(btn!);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("X1", "單一分點");
    // stopPropagation 保白名單 2:整列 toggle 不得被動作鈕觸發
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("動作鈕上按 Enter/Space → 不誤觸整列 toggle(鍵盤路徑;row keydown 只認自身)", () => {
    // 痛點:row 是 role=button + onKeyDown(Enter/Space preventDefault),
    // 巢狀鈕的 keydown 冒泡上來會被 row 搶走 —— 鍵盤使用者按 Enter 變成
    // 勾選該列,onShowInBubble 永遠不會執行(preventDefault 抑制原生 click)。
    const onToggle = vi.fn();
    const onShow = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
        onShowInBubble={onShow}
      />,
    );
    const btn = container.querySelector(
      "[data-testid=broker-row-bubble-btn]",
    ) as HTMLButtonElement;
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: " " });
    // row 的 toggle 不得被巢狀鈕的 keydown 觸發;原生 button 的 Enter/Space
    // activation(瀏覽器合成 click)不再被 preventDefault 抑制。
    expect(onToggle).not.toHaveBeenCalled();
    // row 自身的鍵盤路徑不受影響(target === currentTarget)
    const row = container.querySelector('[role="button"][aria-pressed]') as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("交易量 mode 的列也有動作鈕", () => {
    const onShow = vi.fn();
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
        onShowInBubble={onShow}
      />,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").includes("前 15 大交易量分點"),
      )!,
    );
    const btn = container.querySelector(
      "[data-testid=broker-row-bubble-btn]",
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(onShow).toHaveBeenCalledWith("X1", "單一分點");
  });

  it("未傳 onShowInBubble → 不渲染動作鈕(caller 相容)", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary([single])}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(
      container.querySelector("[data-testid=broker-row-bubble-btn]"),
    ).toBeNull();
  });
});
