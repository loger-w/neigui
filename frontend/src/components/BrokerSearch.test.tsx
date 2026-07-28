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

const noneSelected: ReadonlySet<string> = new Set();

// bubble-multi-broker:BrokerSearch 改「搜尋即加選」多選契約 —
// props = { trades, selectedIds, onPick(id, name) }。原 value echo /
// input × 清除鈕測試為事前標記之該變 assertion(清除職責移至 chips)。
describe("BrokerSearch", () => {
  it("shows placeholder;不 echo 選中分點(純搜尋框)", () => {
    render(
      <BrokerSearch
        trades={trades}
        selectedIds={new Set(["9201A"])}
        onPick={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
    expect(input.value).toBe("");
    // × 清除鈕已移除(該變:清除職責在 chips)
    expect(screen.queryByLabelText("清除選擇")).toBeNull();
  });

  it("opens dropdown on focus + typing with matches(顯示統一格式)", async () => {
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => {
      expect(screen.getByText(/9201A 凱基台北/)).toBeTruthy();
      expect(screen.getByText(/9201B 凱基板橋/)).toBeTruthy();
    });
  });

  it("filters case-insensitive (substring),接受原始名與 id", async () => {
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
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
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
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
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
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
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      expect(items.length).toBeGreaterThan(0);
      // 富邦-台北 buy+sell = 500; 凱基-台北 = 300; 凱基-板橋 = 130; 元大 = 40
      expect(items[0]!.textContent).toContain("富邦台北");
      expect(items[1]!.textContent).toContain("凱基台北");
    });
  });

  // 聚合改以 broker_id 為 key(收割 next-time.md deferred 項):同名不同 id
  // 是兩個分點,各自一列、各自可選。
  it("同名不同 broker_id → 兩列分開列出,pick 回傳各自 id", async () => {
    const collide: BrokerTrade[] = [
      { broker: "凱基-台北", broker_id: "9800", price: 100, buy: 50, sell: 0 },
      { broker: "凱基-台北", broker_id: "9801", price: 101, buy: 30, sell: 0 },
    ];
    const onPick = vi.fn();
    render(<BrokerSearch trades={collide} selectedIds={noneSelected} onPick={onPick} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    await waitFor(() => {
      expect(screen.getAllByTestId("broker-search-item")).toHaveLength(2);
    });
    const items = screen.getAllByTestId("broker-search-item");
    fireEvent.mouseDown(items[1]!);
    expect(onPick).toHaveBeenCalledWith("9801", "凱基-台北");
  });

  // Phase 5 review P2-1:trades identity 變動(blocklist 增減 / refetch)不得
  // 洗掉輸入中的搜尋字。
  it("輸入中 trades identity 改變 → query 不被重設", async () => {
    const { rerender } = render(
      <BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    rerender(
      <BrokerSearch trades={[...trades]} selectedIds={noneSelected} onPick={vi.fn()} />,
    );
    expect(input.value).toBe("凱");
  });

  it("Enter picks active item(id + name)", async () => {
    const onPick = vi.fn();
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={onPick} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱基-台北" } });
    await waitFor(() => {
      expect(screen.getAllByTestId("broker-search-item")).toHaveLength(1);
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("9201A", "凱基-台北");
  });

  it("Arrow down then Enter picks second item", async () => {
    const onPick = vi.fn();
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={onPick} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => {
      expect(screen.getAllByTestId("broker-search-item")).toHaveLength(2);
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("9201B", "凱基-板橋");
  });

  it("Escape closes dropdown without picking", async () => {
    const onPick = vi.fn();
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={onPick} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => screen.getAllByTestId("broker-search-item"));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryAllByTestId("broker-search-item")).toHaveLength(0);
    });
    expect(onPick).not.toHaveBeenCalled();
  });

  // R1(design v2 §4):pick 後下拉保持開啟、query 不清 — 連續加選 UX 核心。
  // item onMouseDown 必須 preventDefault 保 input focus(否則 blur closeTimer
  // 會在真瀏覽器關掉下拉;此處鎖 defaultPrevented 契約)。
  it("pick 後下拉保持開啟、query 不清,item mousedown 有 preventDefault", async () => {
    const onPick = vi.fn();
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={onPick} />);
    const input = screen.getByPlaceholderText("搜尋分點...") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱" } });
    await waitFor(() => {
      expect(screen.getAllByTestId("broker-search-item")).toHaveLength(2);
    });
    const first = screen.getAllByTestId("broker-search-item")[0]!;
    const prevented = !fireEvent.mouseDown(first); // fireEvent 回傳 !defaultPrevented
    expect(prevented).toBe(true);
    expect(onPick).toHaveBeenCalledWith("9201A", "凱基-台北");
    // 下拉仍開啟、query 保留
    expect(screen.getAllByTestId("broker-search-item").length).toBeGreaterThan(0);
    expect(input.value).toBe("凱");
  });

  // next-time 收割(mod/broker-label-search-only-id 遺留):query 含 dash 經
  // raw name 命中,但 dropdown label 是去dash字串 → 高亮 indexOf 對不上。
  // highlight 須 normalizeBrokerQuery 雙邊對齊再回推原始 index。
  it("dash query 命中時 label 高亮著色去dash區段", async () => {
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "凱基-台" } });
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      expect(items).toHaveLength(1);
      const marks = items[0]!.querySelectorAll<HTMLElement>(
        "[data-testid=broker-search-highlight]",
      );
      expect(marks).toHaveLength(1);
      expect(marks[0]!.textContent).toBe("凱基台");
    });
  });

  it("純 dash query 不高亮也不 crash", async () => {
    render(<BrokerSearch trades={trades} selectedIds={noneSelected} onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-" } });
    await waitFor(() => {
      const items = screen.getAllByTestId("broker-search-item");
      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(
          it.querySelector("[data-testid=broker-search-highlight]"),
        ).toBeNull();
      }
    });
  });

  // R6(impl spec):下拉 = listbox/option 結構,已選列 aria-selected + ✓。
  it("已選分點列標 aria-selected 與 ✓ 前綴;再點 = toggle(onPick 照樣回傳)", async () => {
    const onPick = vi.fn();
    render(
      <BrokerSearch
        trades={trades}
        selectedIds={new Set(["9201A"])}
        onPick={onPick}
      />,
    );
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    await waitFor(() => {
      expect(screen.getAllByTestId("broker-search-item").length).toBeGreaterThan(0);
    });
    const options = screen.getAllByRole("option");
    const selectedOpt = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selectedOpt).toBeTruthy();
    expect(selectedOpt!.textContent).toContain("凱基台北");
    expect(selectedOpt!.textContent).toContain("✓");
    fireEvent.mouseDown(selectedOpt!);
    expect(onPick).toHaveBeenCalledWith("9201A", "凱基-台北");
  });
});

// mod/bubble-dropdown-dismiss-guard:下拉可見狀態回報 — ChipBubbleView 的
// dismiss-click guard 靠它判斷「點圖表該不該吞」。
describe("BrokerSearch — onOpenChange", () => {
  it("focus 開下拉(有結果)回報 true;Escape 關閉回報 false", async () => {
    const onOpen = vi.fn();
    render(
      <BrokerSearch
        trades={trades}
        selectedIds={noneSelected}
        onPick={vi.fn()}
        onOpenChange={onOpen}
      />,
    );
    const input = screen.getByPlaceholderText("搜尋分點...");
    fireEvent.focus(input);
    await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith(true));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith(false));
  });
});
