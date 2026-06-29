/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RangeSelector,
  WINDOW_DAYS_PRESETS,
  WINDOW_DAYS_MIN,
  WINDOW_DAYS_MAX,
  RANGE_DAYS_OPTIONS,
} from "./RangeSelector";

afterEach(cleanup);

describe("RangeSelector — Pattern A (chip + number input)", () => {
  it("renders 5 preset buttons (1/10/20/30/60) + a number input value display", () => {
    render(<RangeSelector value={30} onChange={() => {}} />);
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-label")).toBe("N 日加總視窗");
    const presets = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label")?.startsWith("設為"));
    expect(presets).toHaveLength(5);
    expect(presets.map((b) => b.textContent)).toEqual(["1", "10", "20", "30", "60"]);
    // input native role = spinbutton(type=number)
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("30");
    expect(input.getAttribute("aria-valuemin")).toBe("1");
    expect(input.getAttribute("aria-valuemax")).toBe("60");
    expect(input.getAttribute("aria-valuenow")).toBe("30");
    expect(input.getAttribute("aria-label")).toBe("自訂 N 日");
  });

  it("click preset 20 → onChange(20)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "設為 20 日" }));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it("active preset has aria-pressed=true; others false", () => {
    render(<RangeSelector value={20} onChange={() => {}} />);
    const presets = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label")?.startsWith("設為"));
    expect(presets[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(presets[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(presets[1]!.getAttribute("aria-pressed")).toBe("false");
    expect(presets[3]!.getAttribute("aria-pressed")).toBe("false");
    expect(presets[4]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("preset 1 day acts as 'today snapshot' single-day mode", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "設為 1 日" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("when value not in preset (e.g. 37), no preset active but input shows 37", () => {
    render(<RangeSelector value={37} onChange={() => {}} />);
    const presets = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label")?.startsWith("設為"));
    for (const b of presets) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("37");
    expect(input.getAttribute("aria-valuenow")).toBe("37");
  });

  it("disabled blocks preset click + onChange", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "設為 10 日" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled sets input disabled (DOM standard removes from tab order)", () => {
    render(<RangeSelector value={30} onChange={() => {}} disabled />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("wheel down on group → onChange(value - 1) clamped", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("group"), { deltaY: 100 });
    expect(onChange).toHaveBeenCalledWith(29);
  });

  it("wheel up on group → onChange(value + 1) clamped", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("group"), { deltaY: -100 });
    expect(onChange).toHaveBeenCalledWith(31);
  });

  it("wheel down at min stays at 1", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={1} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("group"), { deltaY: 100 });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("wheel up at max stays at 60", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={60} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("group"), { deltaY: -100 });
    expect(onChange).toHaveBeenCalledWith(60);
  });

  it("disabled blocks wheel", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} disabled />);
    fireEvent.wheel(screen.getByRole("group"), { deltaY: 100 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Home on input → 1, End → 60", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.keyDown(input, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(input, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(60);
  });

  it("constants exposed (backward compat)", () => {
    expect(WINDOW_DAYS_PRESETS).toEqual([1, 10, 20, 30, 60]);
    expect(WINDOW_DAYS_MIN).toBe(1);
    expect(WINDOW_DAYS_MAX).toBe(60);
    expect(RANGE_DAYS_OPTIONS).toEqual([1, 10, 20, 30, 60]);
  });

  it("value < 1 displays clamped to 1", () => {
    render(<RangeSelector value={0} onChange={() => {}} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("1");
  });

  it("value > 60 displays clamped to 60", () => {
    render(<RangeSelector value={180} onChange={() => {}} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("60");
  });

  // --- chip-controls-v2 new behavior: number input with commit-on-blur ---

  it("typing into input does NOT immediately fire onChange (commit on blur/Enter)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "45" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("45");
  });

  it("blur commits typed value with clamp (70 → 60)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(60);
    expect(input.value).toBe("60");
  });

  it("blur commits typed value with clamp (0 → 1)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("Enter commits typed value", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("blur with non-numeric input reverts to current value (no onChange)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("30");
  });

  it("blur with same-value typing does not fire onChange (idempotent)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("external value change syncs to input when input is NOT focused", () => {
    const { rerender } = render(<RangeSelector value={30} onChange={() => {}} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("30");
    // simulate parent updating value (e.g., preset click via another path)
    rerender(<RangeSelector value={45} onChange={() => {}} />);
    expect(input.value).toBe("45");
  });

  it("external value change does NOT clobber input when input IS focused (typing-in-progress)", () => {
    const { rerender } = render(<RangeSelector value={30} onChange={() => {}} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "7" } });
    expect(input.value).toBe("7");
    // parent re-renders with value=30 (e.g., stale prop) — should NOT clobber localStr
    rerender(<RangeSelector value={30} onChange={() => {}} />);
    expect(input.value).toBe("7");
  });
});
