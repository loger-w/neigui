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

describe("ChipBrokersPanel F4 — symbol/date + 三大法人 removed", () => {
  it("does NOT render 三大法人 block", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(container.textContent).not.toContain("三大法人");
    expect(container.textContent).not.toContain("外資");
    expect(container.textContent).not.toContain("投信");
    expect(container.textContent).not.toContain("自營商");
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

describe("ChipBrokersPanel F7 — 主力買賣超 above 融資融券", () => {
  it("主力買賣超 row appears BEFORE 融資融券 row in DOM order", () => {
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
    const majorIdx = html.indexOf("主力買賣超");
    const marginIdx = html.indexOf("融資融券");
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

describe("ChipBrokersPanel — avg buy/sell price caption", () => {
  const captionBrokers: TopBroker[] = [
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

  it("net mode: buyer row shows @<avg_buy_price> caption with 2 decimals", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(captionBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector("[data-testid=buyers-scroll]");
    expect(buyers).toBeTruthy();
    expect(buyers!.textContent).toContain("@100.50");
    expect(buyers!.textContent).toContain("@99.25");
  });

  it("net mode: buyer row WITH non-zero sell shows BOTH @buy + @sell captions", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(captionBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const buyers = container.querySelector("[data-testid=buyers-scroll]");
    expect(buyers!.textContent).toContain("@99.25");
    expect(buyers!.textContent).toContain("@101.40");
  });

  it("net mode: seller row shows @<avg_sell_price> caption", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(captionBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    const sellers = container.querySelector("[data-testid=sellers-scroll]");
    expect(sellers!.textContent).toContain("@102.75");
  });

  it("buy-only broker: avg_sell_price=0 → caption renders as dash, not @0.00", () => {
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
    expect(buyers!.textContent).not.toContain("@0.00");
    // dash for the missing side
    expect(buyers!.textContent).toMatch(/—/);
  });

  it("volume mode: both @buy + @sell captions rendered", () => {
    const { container, getByText } = render(
      <ChipBrokersPanel
        summary={mkSummary(captionBrokers)}
        dayTotalLots={1000}
        selectedBrokerIds={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByText("前 15 大交易量分點"));
    const vol = container.querySelector("[data-testid=volume-scroll]");
    expect(vol).toBeTruthy();
    expect(vol!.textContent).toContain("@99.25");
    expect(vol!.textContent).toContain("@101.40");
  });
});
