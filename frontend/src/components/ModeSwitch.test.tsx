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
  it("renders both modes", () => {
    render(<ModeSwitch value="equity" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "個股" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "選擇權" })).toBeTruthy();
  });

  it("marks the active mode with aria-current=page", () => {
    render(<ModeSwitch value="options" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "選擇權" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("calls onChange when the other mode is clicked", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "選擇權" }));
    expect(spy).toHaveBeenCalledWith("options");
  });

  it("does not call onChange when clicking the active mode", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "個股" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
