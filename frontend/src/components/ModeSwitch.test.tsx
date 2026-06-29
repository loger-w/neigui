/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModeSwitch } from "./ModeSwitch";

afterEach(() => {
  cleanup();
});

describe("ModeSwitch", () => {
  it("renders three modes", () => {
    render(<ModeSwitch value="equity" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "個股" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "選擇權" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "大盤" })).toBeTruthy();
  });

  it("marks the active mode with aria-current=page", () => {
    render(<ModeSwitch value="options" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "選擇權" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
    ).toBeNull();
    // v3 C4 — 鎖 active=options 時大盤 button 必須非 active
    expect(
      screen.getByRole("button", { name: "大盤" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks 大盤 as active when value is 'market'", () => {
    render(<ModeSwitch value="market" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "大盤" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "選擇權" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("calls onChange when the other mode is clicked", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "選擇權" }));
    expect(spy).toHaveBeenCalledWith("options");
  });

  it("calls onChange('market') when 大盤 clicked from equity", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "大盤" }));
    expect(spy).toHaveBeenCalledWith("market");
  });

  it("does not call onChange when clicking the active mode", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "個股" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
