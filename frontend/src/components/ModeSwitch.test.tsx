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
  // NAV-1(mod/batch-ui-update):分點反查自 equity tab 升格為 mode,排在券差旁。
  it("renders five modes with 分點反查 next to 券差", () => {
    render(<ModeSwitch value="equity" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "個股" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "選擇權" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "大盤" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "券差" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "分點反查" })).toBeTruthy();
    // 順序:券差之後緊接分點反查
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.indexOf("分點反查")).toBe(labels.indexOf("券差") + 1);
  });

  it("marks 分點反查 as active when value is 'flows'", () => {
    render(<ModeSwitch value="flows" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "分點反查" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("calls onChange('flows') when 分點反查 clicked from equity", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "分點反查" }));
    expect(spy).toHaveBeenCalledWith("flows");
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

  it("marks 券差 as active when value is 'borrow'", () => {
    render(<ModeSwitch value="borrow" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "券差" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("calls onChange('borrow') when 券差 clicked from equity", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "券差" }));
    expect(spy).toHaveBeenCalledWith("borrow");
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
