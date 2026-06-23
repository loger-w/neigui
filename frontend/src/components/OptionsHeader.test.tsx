/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OptionsHeader } from "./OptionsHeader";

afterEach(() => cleanup());

describe("OptionsHeader", () => {
  it("renders 7 contract options in the dropdown", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
      />,
    );
    const select = screen.getByLabelText("選擇合約") as HTMLSelectElement;
    expect(select.options.length).toBe(7);
  });

  it("fires onContractChange when a different option is picked", () => {
    const spy = vi.fn();
    render(
      <OptionsHeader
        contractId=""
        onContractChange={spy}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
      />,
    );
    const select = screen.getByLabelText("選擇合約") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[1].value } });
    expect(spy).toHaveBeenCalledWith(select.options[1].value);
  });

  it("disables the refresh button while loading", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={true}
        onRefresh={() => {}}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /重新整理/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
