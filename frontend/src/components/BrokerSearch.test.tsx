/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { BrokerSearch } from "./BrokerSearch";
import type { BrokerTrade } from "../lib/chip-data";

afterEach(() => cleanup());

const trades: BrokerTrade[] = [
  { broker: "凱基-台北", broker_id: "9201A", price: 100, buy: 200, sell: 100 },
  { broker: "凱基-板橋", broker_id: "9201B", price: 100, buy: 50, sell: 80 },
  { broker: "富邦-台北", broker_id: "9501A", price: 100, buy: 500, sell: 0 },
  { broker: "元大-中和", broker_id: "9101A", price: 100, buy: 30, sell: 10 },
];

describe("BrokerSearch", () => {
  it("shows placeholder when value is null", () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("搜尋分點...")).toBeTruthy();
  });

  // SC-7:value echo 回填也走「id 去dash名」formatter(change-spec R15)。
  it("shows formatted broker label when value is set", () => {
    render(<BrokerSearch trades={trades} value="凱基-台北" onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
    expect(input.value).toBe("9201A 凱基台北");
  });

  it("opens dropdown on focus + typing with matches(顯示統一格式)", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => {
      expect(screen.getByText(/9201A 凱基台北/)).toBeTruthy();
      expect(screen.getByText(/9201B 凱基板橋/)).toBeTruthy();
    });
  });

  it("filters case-insensitive (substring),接受原始名與 id", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "台北" } });
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      const texts = items.map((it) => it.textContent ?? "");
      expect(texts.some((t) => t.includes("凱基台北"))).toBe(true);
      expect(texts.some((t) => t.includes("富邦台北"))).toBe(true);
      expect(texts.some((t) => t.includes("凱基板橋"))).toBe(false);
    });
  });

  it("照顯示字樣(去dash)輸入命中含 dash 分點(regression lock,label 比對覆蓋)", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱基台北" } });
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      const texts = items.map((it) => it.textContent ?? "");
      expect(texts.some((t) => t.includes("凱基台北"))).toBe(true);
      expect(texts.some((t) => t.includes("凱基板橋"))).toBe(false);
    });
  });

  it("以 broker_id 搜尋也命中", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "9501" } });
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      const texts = items.map((it) => it.textContent ?? "");
      expect(texts.some((t) => t.includes("富邦台北"))).toBe(true);
      expect(texts.some((t) => t.includes("凱基台北"))).toBe(false);
    });
  });

  it("default dropdown sort by total volume desc", async () => {
    render(<BrokerSearch trades={trades} value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    // Empty query -> shows all sorted by total desc
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      expect(items.length).toBeGreaterThan(0);
      // 富邦-台北 buy+sell = 500; 凱基-台北 = 300; 凱基-板橋 = 130; 元大 = 40
      expect(items[0]!.textContent).toContain("富邦台北");
      expect(items[1]!.textContent).toContain("凱基台北");
    });
  });

  // Phase 5 review P2-1:trades identity 變動(blocklist 增減 / refetch)不得
  // 洗掉輸入中的搜尋字 — echo 重設只跟 value 變更走。
  it("輸入中 trades identity 改變 → query 不被 echo 重設", async () => {
    const { rerender } = render(
      <BrokerSearch trades={trades} value={null} onChange={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    // trades 換新 array identity(內容相同)
    rerender(<BrokerSearch trades={[...trades]} value={null} onChange={vi.fn()} />);
    expect(input.value).toBe("凱");
  });

  it("Enter selects active item", async () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱基-台北" } });
    // Wait for debounce to narrow to just the one match
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      expect(items).toHaveLength(1);
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("凱基-台北");
  });

  it("Arrow down then Enter selects second item", async () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    // Wait until debounce filters down to the 凱基-* matches only
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      expect(items).toHaveLength(2);
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    // 凱基-台北 total 300 > 凱基-板橋 130 -> index 0 is 台北, index 1 is 板橋
    expect(onChange).toHaveBeenCalledWith("凱基-板橋");
  });

  it("Escape closes dropdown without selecting", async () => {
    const onChange = vi.fn();
    render(<BrokerSearch trades={trades} value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => screen.getAllByTestId("broker-search-item"));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryAllByTestId("broker-search-item")).toHaveLength(0);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("× button clears value", () => {
    const onChange = vi.fn();
    render(
      <BrokerSearch trades={trades} value="凱基-台北" onChange={onChange} />,
    );
    const x = screen.getByLabelText("清除選擇");
    fireEvent.mouseDown(x);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
