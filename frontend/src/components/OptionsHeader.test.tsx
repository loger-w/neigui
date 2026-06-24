/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OptionsHeader } from "./OptionsHeader";
import type { OptionsSpot } from "../lib/options-types";

afterEach(() => cleanup());

describe("OptionsHeader", () => {
  it("renders contract options sorted by settlement (weekly_wed + weekly_fri + monthly)", () => {
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
    // post-Friday-weekly: 3 monthlies + several Wed/Fri weeklies in horizon
    expect(select.options.length).toBeGreaterThanOrEqual(7);
    const labels = Array.from(select.options).map((o) => o.text);
    expect(labels.some((l) => l.includes("週三選"))).toBe(true);
    expect(labels.some((l) => l.includes("週五選"))).toBe(true);
    expect(labels.some((l) => l.includes("月選"))).toBe(true);
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
    fireEvent.change(select, { target: { value: select.options[1]!.value } });
    expect(spy).toHaveBeenCalledWith(select.options[1]!.value);
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

const mkSpot = (overrides?: Partial<OptionsSpot>): OptionsSpot => ({
  date: "2026-06-23", fetched_at: "x", as_of_date: "2026-06-23",
  spot: 53420, prev_close: 53300, change: 120, change_pct: 0.225,
  ...overrides,
});

describe("OptionsHeader spot display", () => {
  it("shows spot price + change when spot prop present", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
        spot={mkSpot()}
      />,
    );
    expect(screen.getByText(/53,420/)).toBeTruthy();
    expect(screen.getByText(/\+120/)).toBeTruthy();
  });

  it("omits spot section when spot is null", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
        spot={null}
      />,
    );
    expect(screen.queryByText(/台指期/)).toBeNull();
  });

  it("renders negative change in green", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
        spot={mkSpot({ change: -50, change_pct: -0.094 })}
      />,
    );
    const chg = screen.getByText(/−50/);
    // The wrapping <span> should carry the down-color class
    expect(chg.className).toContain("color-down");
  });
});
