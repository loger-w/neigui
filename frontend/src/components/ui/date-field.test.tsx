/**
 * @vitest-environment jsdom
 *
 * Cluster E 🟢 — project-themed DateField wrapping native <input type="date">.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DateField } from "./date-field";

afterEach(() => cleanup());

describe("DateField", () => {
  it("renders an input with type=date", () => {
    const { container } = render(<DateField value="2026-06-22" />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("date");
  });

  it("forwards onChange with event.target.value", () => {
    let captured: string | undefined;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      // Capture eagerly — React's controlled-input rerender will revert the
      // DOM value back to the value prop, so reading lazily later sees the old
      // value rather than what fireEvent set.
      captured = e.target.value;
    });
    const { container } = render(
      <DateField value="2026-06-22" onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-21" } });
    expect(onChange).toHaveBeenCalled();
    expect(captured).toBe("2026-06-21");
  });

  it("value prop reflects in DOM", () => {
    const { container, rerender } = render(<DateField value="2026-06-22" />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("2026-06-22");
    rerender(<DateField value="2026-06-21" />);
    expect(input.value).toBe("2026-06-21");
  });

  it("aria-label is exposed", () => {
    const { getByLabelText } = render(
      <DateField value="2026-06-22" aria-label="選擇日期" />,
    );
    expect(getByLabelText("選擇日期")).toBeTruthy();
  });

  it("disabled prevents value change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateField value="2026-06-22" disabled onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("applies project-theme classes for picker indicator targeting", () => {
    const { container } = render(<DateField value="2026-06-22" />);
    const input = container.querySelector("input") as HTMLInputElement;
    // Must carry the marker class so the index.css ::-webkit rule applies.
    expect(input.className).toContain("date-field-input");
  });
});
