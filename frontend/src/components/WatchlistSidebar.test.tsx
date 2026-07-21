/**
 * @vitest-environment jsdom
 *
 * WL-1 (mod/batch-ui-update): 自選清單 sidebar — 加入當前個股、分組建立/
 * 刪除/歸組、點擊切股、收合;localStorage 持久化(lib/watchlist 已鎖格式,
 * 這裡鎖 UI 接線)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WatchlistSidebar } from "./WatchlistSidebar";
import { WATCHLIST_STORAGE_KEY } from "../lib/watchlist";

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());

function seed(w: unknown) {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(w));
}

function stored() {
  return JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? "null");
}

describe("WatchlistSidebar — 加入當前個股", () => {
  it("有當前個股 → 加入鈕可點,點擊後項目出現 + 持久化", () => {
    const { container } = render(
      <WatchlistSidebar currentSymbol="2330" currentSymbolName="台積電" onPick={vi.fn()} />,
    );
    const addBtn = container.querySelector(
      "[data-testid=watchlist-add-current]",
    ) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.disabled).toBe(false);
    fireEvent.click(addBtn);
    const item = container.querySelector("[data-testid=watchlist-item]");
    expect(item).toBeTruthy();
    expect(item!.textContent ?? "").toContain("2330");
    expect(item!.textContent ?? "").toContain("台積電");
    expect(stored().items).toEqual([
      { symbol: "2330", name: "台積電", groupId: null },
    ]);
    // 已在清單 → 加入鈕轉 disabled(不重複加)
    expect(
      (container.querySelector("[data-testid=watchlist-add-current]") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("無當前個股 → 加入鈕 disabled", () => {
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    const addBtn = container.querySelector(
      "[data-testid=watchlist-add-current]",
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });
});

describe("WatchlistSidebar — 清單互動", () => {
  it("mount 讀 localStorage;點擊項目 → onPick(symbol, name)", () => {
    seed({
      groups: [],
      items: [{ symbol: "2412", name: "中華電", groupId: null }],
    });
    const onPick = vi.fn();
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={onPick} />,
    );
    const pickBtn = container.querySelector(
      "[data-testid=watchlist-item] [data-testid=watchlist-item-pick]",
    ) as HTMLButtonElement;
    expect(pickBtn).toBeTruthy();
    fireEvent.click(pickBtn);
    expect(onPick).toHaveBeenCalledWith("2412", "中華電");
  });

  it("移除項目 → 清單消失 + 持久化", () => {
    seed({
      groups: [],
      items: [{ symbol: "2412", name: "中華電", groupId: null }],
    });
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    fireEvent.click(
      container.querySelector("[aria-label='自清單移除 2412']") as HTMLButtonElement,
    );
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeNull();
    expect(stored().items).toEqual([]);
  });

  it("建立分組 → 歸組 → 項目列在該組下;刪組 → 項目退回未分組", () => {
    seed({
      groups: [],
      items: [{ symbol: "2330", name: "台積電", groupId: null }],
    });
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    // 建立分組
    const input = container.querySelector(
      "[data-testid=watchlist-group-input]",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "半導體" } });
    fireEvent.click(
      container.querySelector("[data-testid=watchlist-create-group]") as HTMLButtonElement,
    );
    const group = container.querySelector("[data-testid=watchlist-group]");
    expect(group).toBeTruthy();
    expect(group!.textContent ?? "").toContain("半導體");

    // 歸組(select)
    const select = container.querySelector(
      "[aria-label='設定 2330 分組']",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "g1" } });
    expect(stored().items[0].groupId).toBe("g1");
    // 項目 DOM 掛在組區塊之下
    const groupSection = container.querySelector(
      "[data-testid=watchlist-group-section]",
    ) as HTMLElement;
    expect(
      groupSection.querySelector("[data-testid=watchlist-item]"),
    ).toBeTruthy();

    // 刪組 → 項目退回未分組且仍在
    fireEvent.click(
      container.querySelector("[aria-label='刪除分組 半導體']") as HTMLButtonElement,
    );
    expect(container.querySelector("[data-testid=watchlist-group]")).toBeNull();
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeTruthy();
    expect(stored().items[0].groupId).toBeNull();
  });
});

describe("WatchlistSidebar — 收合", () => {
  it("桌面:收合鈕 → 清單隱藏、展開鈕出現;再展開恢復", () => {
    seed({
      groups: [],
      items: [{ symbol: "2330", name: "台積電", groupId: null }],
    });
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeTruthy();
    fireEvent.click(
      container.querySelector("[aria-label='收合自選清單']") as HTMLButtonElement,
    );
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeNull();
    const expandBtn = container.querySelector(
      "[aria-label='展開自選清單']",
    ) as HTMLButtonElement;
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn);
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeTruthy();
  });

  it("mobile:預設收合(摺疊區塊),點擊標題展開", () => {
    seed({
      groups: [],
      items: [{ symbol: "2330", name: "台積電", groupId: null }],
    });
    const { container } = render(
      <WatchlistSidebar
        currentSymbol=""
        currentSymbolName={null}
        onPick={vi.fn()}
        mobile
      />,
    );
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeNull();
    fireEvent.click(
      container.querySelector("[aria-label='展開自選清單']") as HTMLButtonElement,
    );
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeTruthy();
  });
});
