/**
 * @vitest-environment jsdom
 *
 * Cluster E 🟢 — project-themed Checkbox component.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Checkbox } from "./checkbox";

afterEach(() => cleanup());

describe("Checkbox", () => {
  it("renders unchecked by default", () => {
    const { getByLabelText } = render(<Checkbox aria-label="勾選 凱基" />);
    const input = getByLabelText("勾選 凱基") as HTMLInputElement;
    expect(input.checked).toBe(false);
  });

  it("clicking toggles + fires onCheckedChange with new value", () => {
    const onChange = vi.fn();
    const { getByLabelText, rerender } = render(
      <Checkbox aria-label="勾選 凱基" checked={false} onCheckedChange={onChange} />,
    );
    fireEvent.click(getByLabelText("勾選 凱基"));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Checkbox aria-label="勾選 凱基" checked={true} onCheckedChange={onChange} />);
    fireEvent.click(getByLabelText("勾選 凱基"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("forwards onChange event when provided alongside onCheckedChange", () => {
    const onChange = vi.fn();
    const onCheckedChange = vi.fn();
    const { getByLabelText } = render(
      <Checkbox
        aria-label="勾選 凱基"
        checked={false}
        onChange={onChange}
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(getByLabelText("勾選 凱基"));
    expect(onChange).toHaveBeenCalled();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("disabled prevents toggle", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <Checkbox aria-label="勾選 凱基" disabled checked={false} onCheckedChange={onChange} />,
    );
    fireEvent.click(getByLabelText("勾選 凱基"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aria-label surfaces via getByLabelText", () => {
    const { getByLabelText } = render(<Checkbox aria-label="勾選 富邦台北" />);
    expect(getByLabelText("勾選 富邦台北")).toBeTruthy();
  });
});
