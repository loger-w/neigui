/**
 * @vitest-environment jsdom
 *
 * NumberField — 篩選列數字輸入(隱藏原生 spinner + −/+ stepper;
 * mod warrant-ux-feedback item 4)。uncontrolled(defaultValue)配合
 * WarrantSelector 的 epoch remount 中間態機制。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NumberField } from "./number-field";

afterEach(() => cleanup());

describe("NumberField", () => {
  it("input 帶 aria-label / name / defaultValue,原生 spinner 以 appearance:textfield 隱藏", () => {
    render(
      <NumberField ariaLabel="剩餘天數下限" name="minDaysLeft" defaultValue="45" onValueChange={vi.fn()} />,
    );
    const input = screen.getByLabelText("剩餘天數下限") as HTMLInputElement;
    expect(input.value).toBe("45");
    expect(input.name).toBe("minDaysLeft");
    expect(input.className).toContain("appearance:textfield");
  });

  it("打字 → onValueChange 收到原始字串(空字串 = 未啟用)", () => {
    const spy = vi.fn();
    render(<NumberField ariaLabel="剩餘天數下限" onValueChange={spy} />);
    const input = screen.getByLabelText("剩餘天數下限");
    fireEvent.change(input, { target: { value: "30" } });
    expect(spy).toHaveBeenLastCalledWith("30");
    fireEvent.change(input, { target: { value: "" } });
    expect(spy).toHaveBeenLastCalledWith("");
  });

  it("+/− stepper:空值視為 0 起步,寫回 input 並觸發 onValueChange", () => {
    const spy = vi.fn();
    render(<NumberField ariaLabel="剩餘天數下限" step={1} onValueChange={spy} />);
    const input = screen.getByLabelText("剩餘天數下限") as HTMLInputElement;
    fireEvent.click(screen.getByLabelText("剩餘天數下限 增加"));
    expect(input.value).toBe("1");
    expect(spy).toHaveBeenLastCalledWith("1");
    fireEvent.click(screen.getByLabelText("剩餘天數下限 減少"));
    fireEvent.click(screen.getByLabelText("剩餘天數下限 減少"));
    expect(input.value).toBe("-1");
    expect(spy).toHaveBeenLastCalledWith("-1");
  });

  it("小數 step 不留浮點尾巴", () => {
    const spy = vi.fn();
    render(<NumberField ariaLabel="差槓比上限" step={0.1} defaultValue="0.2" onValueChange={spy} />);
    fireEvent.click(screen.getByLabelText("差槓比上限 增加"));
    expect((screen.getByLabelText("差槓比上限") as HTMLInputElement).value).toBe("0.3");
    expect(spy).toHaveBeenLastCalledWith("0.3");
  });
});
