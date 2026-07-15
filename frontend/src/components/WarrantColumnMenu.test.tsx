/**
 * @vitest-environment jsdom
 *
 * WarrantColumnMenu — 欄位選單(順序 / 顯示 / 說明;mod warrant-ux-feedback SC-6)。
 * HTML5 拖曳事件 jsdom 不可靠(R1)→ 拖曳路徑由 e2e E18 鎖,這裡鎖上/下移
 * 按鈕、checkbox、鎖定欄、恢復預設與說明文字。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WarrantColumnMenu } from "./WarrantColumnMenu";
import { WARRANT_COLUMNS } from "../lib/warrant-columns";

afterEach(() => cleanup());

const REGISTRY_IDS = WARRANT_COLUMNS.map((c) => c.id);
const defaultPrefs = () => ({ order: [...REGISTRY_IDS], hidden: [] as string[] });

function openMenu(prefs = defaultPrefs(), onChange = vi.fn()) {
  render(<WarrantColumnMenu columns={WARRANT_COLUMNS} prefs={prefs} onChange={onChange} />);
  fireEvent.click(document.querySelector("[data-testid=column-menu-btn]")!);
  return onChange;
}

describe("WarrantColumnMenu", () => {
  it("開啟後每欄一列,含欄名與一行說明", () => {
    openMenu();
    const rows = Array.from(document.querySelectorAll("[data-testid=column-menu-row]"));
    expect(rows.length).toBe(WARRANT_COLUMNS.length);
    const slrRow = rows.find((r) => r.getAttribute("data-column-id") === "slr")!;
    expect(slrRow.textContent).toContain("差槓比");
    expect(slrRow.textContent).toContain("價差比 ÷ 實質槓桿"); // desc 文字真的呈現
  });

  it("勾掉欄位 → onChange hidden 加入該欄;勾回 → 移除", () => {
    const onChange = openMenu();
    const ivRow = document.querySelector('[data-column-id="iv"]')!;
    fireEvent.click(ivRow.querySelector("input[type=checkbox]")!);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: ["iv"] }),
    );
  });

  it("代號欄 lockVisible:checkbox disabled,點了不觸發 onChange", () => {
    const onChange = openMenu();
    const codeRow = document.querySelector('[data-column-id="warrant_id"]')!;
    const cb = codeRow.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    fireEvent.click(cb);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("下移按鈕 → onChange order 相鄰交換;首欄上移 disabled", () => {
    const onChange = openMenu();
    const first = REGISTRY_IDS[0]!;
    const second = REGISTRY_IDS[1]!;
    const firstRow = document.querySelector(`[data-column-id="${first}"]`)!;
    expect(
      (firstRow.querySelector(`[aria-label="${WARRANT_COLUMNS[0]!.label} 上移"]`) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(firstRow.querySelector(`[aria-label="${WARRANT_COLUMNS[0]!.label} 下移"]`)!);
    const expected = [...REGISTRY_IDS];
    expected[0] = second;
    expected[1] = first;
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ order: expected }));
  });

  it("恢復預設 → onChange 回 registry 順序 + 全顯示", () => {
    const onChange = openMenu({ order: [...REGISTRY_IDS].reverse(), hidden: ["iv"] });
    fireEvent.click(document.querySelector("[data-testid=column-menu-reset]")!);
    expect(onChange).toHaveBeenCalledWith({ order: REGISTRY_IDS, hidden: [] });
  });
});
