/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VersionBadge } from "./VersionBadge";
import { CURRENT_VERSION } from "../lib/changelog";

afterEach(() => {
  cleanup();
});

describe("VersionBadge — SC-1", () => {
  it("render trigger button 含 aria-label『版本資訊』", () => {
    render(<VersionBadge />);
    const btn = screen.getByRole("button", { name: /版本資訊/ });
    expect(btn).toBeTruthy();
  });

  it("trigger button 文字為 v${CURRENT_VERSION}", () => {
    render(<VersionBadge />);
    const btn = screen.getByRole("button", { name: /版本資訊/ });
    expect(btn.textContent).toBe(`v${CURRENT_VERSION}`);
  });
});

describe("VersionBadge — SC-2", () => {
  it("初始未開:popover h2 標題不在 DOM", () => {
    render(<VersionBadge />);
    expect(screen.queryByRole("heading", { name: "版本資訊" })).toBeNull();
  });

  it("點擊 trigger 後 popover 開,顯示『資料來源: FinMind』", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    expect(screen.getByText("資料來源: FinMind")).toBeTruthy();
  });

  it("popover 內含『版本資訊面板』seed 條目", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    expect(screen.getByText(/版本資訊面板/)).toBeTruthy();
  });

  it("popover 顯示 scope 標籤(個股 / 選擇權 / 全局)", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    expect(screen.getAllByText("全局").length).toBeGreaterThan(0);
    expect(screen.getAllByText("個股").length).toBeGreaterThan(0);
    expect(screen.getAllByText("選擇權").length).toBeGreaterThan(0);
  });
});
