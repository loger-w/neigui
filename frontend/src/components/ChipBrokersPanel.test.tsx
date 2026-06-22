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
        selectedBrokerNames={new Set()}
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
        selectedBrokerNames={new Set()}
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
        selectedBrokerNames={new Set()}
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

describe("ChipBrokersPanel F5 — buyers + sellers in separate scrollable halves", () => {
  it("net mode has two scrollable halves (data-testids buyers-scroll + sellers-scroll)", () => {
    const { container } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerNames={new Set()}
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
        selectedBrokerNames={new Set()}
        onToggleBroker={noop}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByText("前 15 大交易量分點"));
    expect(container.querySelector("[data-testid=buyers-scroll]")).toBeFalsy();
    expect(container.querySelector("[data-testid=sellers-scroll]")).toBeFalsy();
    expect(container.querySelector("[data-testid=volume-scroll]")).toBeTruthy();
  });

  it("clicking buyer + seller checkbox each fires onToggleBroker(name)", () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(
      <ChipBrokersPanel
        summary={mkSummary(topBrokers)}
        dayTotalLots={1000}
        selectedBrokerNames={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={noop}
      />,
    );
    fireEvent.click(getByLabelText("勾選 Buyer-0"));
    fireEvent.click(getByLabelText("勾選 Seller-0"));
    expect(onToggle).toHaveBeenCalledWith("Buyer-0");
    expect(onToggle).toHaveBeenCalledWith("Seller-0");
  });
});
