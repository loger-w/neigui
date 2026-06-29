/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TradingDayStepper } from "./TradingDayStepper";

afterEach(cleanup);

describe("TradingDayStepper", () => {
  it("renders prev direction with the correct aria-label", () => {
    render(<TradingDayStepper direction="prev" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "前一交易日" });
    expect(btn).toBeTruthy();
  });

  it("renders next direction with the correct aria-label", () => {
    render(<TradingDayStepper direction="next" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "後一交易日" });
    expect(btn).toBeTruthy();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<TradingDayStepper direction="prev" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "前一交易日" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(<TradingDayStepper direction="next" onClick={onClick} disabled />);
    const btn = screen.getByRole("button", { name: "後一交易日" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
