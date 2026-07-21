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

  // SC-1c/d(mod/batch-ui-polish):建立/刪除分組集中在「管理分組」面板;
  // 歸組改為每項可見的分組選單鈕(取代 hover 才浮現的 w-4 select)。
  it("管理分組面板建立 → 選單鈕歸組 → 項目列在該組下;刪組 → 項目退回未分組", () => {
    seed({
      groups: [],
      items: [{ symbol: "2330", name: "台積電", groupId: null }],
    });
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    // 開管理分組面板
    fireEvent.click(
      container.querySelector("[aria-label='管理分組']") as HTMLButtonElement,
    );
    // 建立分組(testid 沿用)
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

    // 歸組:點項目的分組選單鈕 → 選「半導體」
    fireEvent.click(
      container.querySelector("[aria-label='設定 2330 分組']") as HTMLButtonElement,
    );
    const menu = container.querySelector("[data-testid=watchlist-assign-menu]");
    expect(menu).toBeTruthy();
    const opt = Array.from(menu!.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("半導體"),
    ) as HTMLButtonElement;
    fireEvent.click(opt);
    expect(stored().items[0].groupId).toBe("g1");
    // 項目 DOM 掛在組區塊之下;選單關閉
    const groupSection = container.querySelector(
      "[data-testid=watchlist-group-section]",
    ) as HTMLElement;
    expect(
      groupSection.querySelector("[data-testid=watchlist-item]"),
    ).toBeTruthy();
    expect(container.querySelector("[data-testid=watchlist-assign-menu]")).toBeNull();

    // 刪組(管理面板內)→ 項目退回未分組且仍在
    fireEvent.click(
      container.querySelector("[aria-label='刪除分組 半導體']") as HTMLButtonElement,
    );
    expect(container.querySelector("[data-testid=watchlist-group]")).toBeNull();
    expect(container.querySelector("[data-testid=watchlist-item]")).toBeTruthy();
    expect(stored().items[0].groupId).toBeNull();
  });

  // SC-1e:股票數量自標頭移除。
  it("桌面/mobile 標頭不再顯示股票數量", () => {
    seed({
      groups: [],
      items: [
        { symbol: "2330", name: "台積電", groupId: null },
        { symbol: "2412", name: "中華電", groupId: null },
      ],
    });
    const desktop = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    const header = desktop.container.querySelector(
      "[data-testid=watchlist-sidebar] > div",
    ) as HTMLElement;
    expect(/\d/.test(header.textContent ?? "")).toBe(false);
    desktop.unmount();

    const mob = render(
      <WatchlistSidebar
        currentSymbol=""
        currentSymbolName={null}
        onPick={vi.fn()}
        mobile
      />,
    );
    const toggle = mob.container.querySelector(
      "[aria-label='展開自選清單']",
    ) as HTMLElement;
    expect(/\d/.test(toggle.textContent ?? "")).toBe(false);
  });
});

// SC-1a/b(mod/batch-ui-polish 🟢):桌面拖曳調寬(clamp 180-320 + localStorage
// 持久化)與「加入到分組」群組快選(addStock 第 4 參數一步入組)。
describe("WatchlistSidebar — 調寬與群組快選", () => {
  it("拖曳把手調寬:clamp 於 180-320,持久化 neigui.watchlist.width", () => {
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    const handle = container.querySelector(
      "[data-testid=watchlist-resize-handle]",
    ) as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 380 });
    fireEvent.mouseUp(document);
    const aside = container.querySelector(
      "[data-testid=watchlist-sidebar]",
    ) as HTMLElement;
    // 210 + 80 = 290
    expect(aside.style.width).toBe("290px");
    expect(localStorage.getItem("neigui.watchlist.width")).toBe("290");
    // 超出上限 clamp 到 320
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 900 });
    fireEvent.mouseUp(document);
    expect(aside.style.width).toBe("320px");
  });

  it("鍵盤左右鍵調寬(a11y),clamp 於下限 180", () => {
    localStorage.setItem("neigui.watchlist.width", "190");
    const { container } = render(
      <WatchlistSidebar currentSymbol="" currentSymbolName={null} onPick={vi.fn()} />,
    );
    const handle = container.querySelector(
      "[data-testid=watchlist-resize-handle]",
    ) as HTMLElement;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    const aside = container.querySelector(
      "[data-testid=watchlist-sidebar]",
    ) as HTMLElement;
    expect(aside.style.width).toBe("180px");
  });

  it("有分組時「加入到分組」快選:一步加入指定分組", () => {
    seed({ groups: [{ id: "g1", name: "半導體" }], items: [] });
    const { container } = render(
      <WatchlistSidebar currentSymbol="2330" currentSymbolName="台積電" onPick={vi.fn()} />,
    );
    fireEvent.click(
      container.querySelector("[data-testid=watchlist-add-to-group]") as HTMLButtonElement,
    );
    const menu = container.querySelector("[data-testid=watchlist-add-menu]")!;
    const opt = Array.from(menu.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("半導體"),
    ) as HTMLButtonElement;
    fireEvent.click(opt);
    expect(stored().items).toEqual([
      { symbol: "2330", name: "台積電", groupId: "g1" },
    ]);
  });

  it("無分組時不顯示快選鈕", () => {
    const { container } = render(
      <WatchlistSidebar currentSymbol="2330" currentSymbolName="台積電" onPick={vi.fn()} />,
    );
    expect(
      container.querySelector("[data-testid=watchlist-add-to-group]"),
    ).toBeNull();
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
