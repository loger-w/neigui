/**
 * @vitest-environment jsdom
 *
 * C10 (🟢 Item 2): BrokerFilterPopover — Excel 式全分點清單。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BrokerFilterPopover } from "./BrokerFilterPopover";
import type { TopBroker } from "../lib/chip-data";

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

const brokers: TopBroker[] = [
  mkBroker({ broker_id: "A1", name: "Alpha", buy: 200, sell: 20, net: 180 }),
  mkBroker({ broker_id: "B1", name: "Bravo", buy: 20, sell: 300, net: -280 }),
  mkBroker({ broker_id: "C1", name: "Charlie", buy: 40, sell: 40, net: 0 }),
];

describe("BrokerFilterPopover — trigger 與 count", () => {
  it("trigger 存在,aria-label 有 count", () => {
    const { container } = render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set(["A1", "B1"])}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const trigger = container.querySelector(
      "[data-testid=broker-filter-trigger]",
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("aria-label")).toContain("2");
  });

  it("N=0 → count badge 不顯示", () => {
    const { container } = render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set()}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    expect(
      container.querySelector("[data-testid=broker-filter-count]"),
    ).toBeNull();
  });

  it("N>=1 → count badge 顯示對應數字", () => {
    const { container } = render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set(["A1", "B1", "C1"])}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const badge = container.querySelector(
      "[data-testid=broker-filter-count]",
    ) as HTMLElement | null;
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("3");
  });
});

// Radix Popover uses Portal → jsdom 可以 render 到 document.body,click trigger
// 開啟後在 document 內找 popover content。
describe("BrokerFilterPopover — 開啟後互動", () => {
  it("點 trigger 開 popover,list 顯示所有 broker(|net| DESC)", () => {
    render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set()}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    const trigger = document.querySelector(
      "[data-testid=broker-filter-trigger]",
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    const list = document.querySelector(
      "[data-testid=broker-filter-list]",
    ) as HTMLElement | null;
    expect(list).toBeTruthy();
    // |net| DESC: Bravo(280) → Alpha(180) → Charlie(0)
    const items = Array.from(list!.querySelectorAll("[data-testid=broker-filter-row]"));
    expect(items.length).toBe(3);
    expect(items[0]!.textContent).toContain("Bravo");
    expect(items[1]!.textContent).toContain("Alpha");
    expect(items[2]!.textContent).toContain("Charlie");
    // mod/broker-label-search-only-id:popover 清單非搜尋框 → 只顯名稱
    expect(items[0]!.textContent).not.toContain("B1 Bravo");
  });

  it("搜尋框過濾:輸入 'alp' 只留 Alpha", () => {
    render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set()}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={vi.fn()}
      />,
    );
    fireEvent.click(
      document.querySelector(
        "[data-testid=broker-filter-trigger]",
      ) as HTMLButtonElement,
    );
    const searchInput = document.querySelector(
      "[data-testid=broker-filter-popover] input[type=text]",
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "alp" } });
    const items = Array.from(
      document.querySelectorAll("[data-testid=broker-filter-list] [data-testid=broker-filter-row]"),
    );
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain("Alpha");
  });

  it("點 checkbox → onToggleBroker(broker_id)", () => {
    const onToggle = vi.fn();
    render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set()}
        onToggleBroker={onToggle}
        onClearAllBrokers={vi.fn()}
      />,
    );
    fireEvent.click(
      document.querySelector(
        "[data-testid=broker-filter-trigger]",
      ) as HTMLButtonElement,
    );
    const firstRow = document.querySelector(
      "[data-testid=broker-filter-list] [data-testid=broker-filter-row]",
    ) as HTMLElement;
    // Bravo (|net|=280) 排第一;點 row 也會觸發 toggle(整 row 可點)
    fireEvent.click(firstRow);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]![0]).toBe("B1");
  });

  it("全部清除 button:N>0 才顯示,點擊呼叫 onClearAllBrokers", () => {
    const onClear = vi.fn();
    render(
      <BrokerFilterPopover
        brokers={brokers}
        selectedBrokerIds={new Set(["A1"])}
        onToggleBroker={vi.fn()}
        onClearAllBrokers={onClear}
      />,
    );
    fireEvent.click(
      document.querySelector(
        "[data-testid=broker-filter-trigger]",
      ) as HTMLButtonElement,
    );
    const clearBtn = document.querySelector(
      "[data-testid=broker-filter-clear-all]",
    ) as HTMLButtonElement | null;
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
