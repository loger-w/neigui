/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VersionBadge } from "./VersionBadge";
import { CHANGELOG, CURRENT_VERSION } from "../lib/changelog";

afterEach(() => {
  cleanup();
});

describe("VersionBadge — SC-1", () => {
  it("render trigger button 含 aria-label『版本資訊』", () => {
    render(<VersionBadge />);
    const btn = screen.getByRole("button", { name: /版本資訊/ });
    expect(btn).toBeTruthy();
  });

  it(`trigger button 文字為 v${CURRENT_VERSION}`, () => {
    render(<VersionBadge />);
    const btn = screen.getByRole("button", { name: /版本資訊/ });
    // trim 因為 button 內含 aria-hidden 的 accent dot span(無 text),
    // JSX 換行可能在 dot 與版本字串間留下 whitespace。
    expect(btn.textContent?.trim()).toBe(`v${CURRENT_VERSION}`);
  });
});

describe("VersionBadge — SC-2", () => {
  it("初始未開:popover h2 標題不在 DOM", () => {
    render(<VersionBadge />);
    expect(screen.queryByRole("heading", { name: "版本資訊" })).toBeNull();
  });

  it("點擊 trigger 後 popover 開,footer 顯示資料來源『FinMind』", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    // Direction B:資料來源在 footer 單純顯示 `FinMind`(無『資料來源:』前綴)
    expect(screen.getByText("FinMind")).toBeTruthy();
  });

  it("popover footer 顯示版本計數與 update 總數", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    const totalUpdates = CHANGELOG.reduce((s, v) => s + v.changes.length, 0);
    expect(
      screen.getByText(`${CHANGELOG.length} 版本 · ${totalUpdates} updates`),
    ).toBeTruthy();
  });

  it("popover 內含『新增版本資訊面板』seed 條目", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    // 用 `新增版本資訊面板` 精確命中 change 條目;`版本資訊面板` 子字串會
    // 同時 match highlights `<p>` 與 changes 兩個元素。
    expect(screen.getByText(/新增版本資訊面板/)).toBeTruthy();
  });

  it("popover 顯示 scope 標籤(個股 / 選擇權 / 全局)", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    expect(screen.getAllByText("全局").length).toBeGreaterThan(0);
    expect(screen.getAllByText("個股").length).toBeGreaterThan(0);
    expect(screen.getAllByText("選擇權").length).toBeGreaterThan(0);
  });
});
