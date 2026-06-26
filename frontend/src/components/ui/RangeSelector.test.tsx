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

describe("RangeSelector", () => {
  it("renders 5 preset buttons (1/10/20/30/60) + a spinbutton value badge", () => {
    render(<RangeSelector value={30} onChange={() => {}} />);
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-label")).toBe("N 日加總視窗");
    const presets = screen.getAllByRole("button");
    expect(presets).toHaveLength(5);
    expect(presets.map((b) => b.textContent)).toEqual(["1", "10", "20", "30", "60"]);
    const spin = screen.getByRole("spinbutton");
    expect(spin.getAttribute("aria-valuemin")).toBe("1");
    expect(spin.getAttribute("aria-valuemax")).toBe("60");
    expect(spin.getAttribute("aria-valuenow")).toBe("30");
    expect(spin.textContent).toBe("30 日");
  });

  it("click preset 20 → onChange(20)", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "設為 20 日" }));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it("active preset has aria-pressed=true; others false", () => {
    render(<RangeSelector value={20} onChange={() => {}} />);
    const presets = screen.getAllByRole("button");
    // [1, 10, 20, 30, 60] — index 2 = 20
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

  it("when value not in preset (e.g. 37), no preset is active but badge shows 37", () => {
    render(<RangeSelector value={37} onChange={() => {}} />);
    const presets = screen.getAllByRole("button");
    for (const b of presets) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.getByRole("spinbutton").getAttribute("aria-valuenow")).toBe("37");
    expect(screen.getByRole("spinbutton").textContent).toBe("37 日");
  });

  it("disabled blocks click + onChange", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "設為 10 日" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled removes spinbutton from tab order", () => {
    render(<RangeSelector value={30} onChange={() => {}} disabled />);
    const spin = screen.getByRole("spinbutton");
    expect(spin.getAttribute("tabindex")).toBe("-1");
  });

  it("wheel down → onChange(value - 1) clamped to ≥10", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    const group = screen.getByRole("group");
    fireEvent.wheel(group, { deltaY: 100 });
    expect(onChange).toHaveBeenCalledWith(29);
  });

  it("wheel up → onChange(value + 1) clamped to ≤60", () => {
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

  it("ArrowLeft / ArrowDown → -1", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(29);

    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(29);
  });

  it("ArrowRight / ArrowUp → +1", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(31);

    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(31);
  });

  it("Home → 1, End → 60", () => {
    const onChange = vi.fn();
    render(<RangeSelector value={30} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(60);
  });

  it("constants exposed for App.tsx whitelist parse + backward-compat alias", () => {
    expect(WINDOW_DAYS_PRESETS).toEqual([1, 10, 20, 30, 60]);
    expect(WINDOW_DAYS_MIN).toBe(1);
    expect(WINDOW_DAYS_MAX).toBe(60);
    expect(RANGE_DAYS_OPTIONS).toEqual([1, 10, 20, 30, 60]);
  });

  it("value < 1 displays clamped to 1", () => {
    render(<RangeSelector value={0} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton").textContent).toBe("1 日");
  });

  it("value > 60 displays clamped to 60", () => {
    render(<RangeSelector value={180} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton").textContent).toBe("60 日");
  });
});
