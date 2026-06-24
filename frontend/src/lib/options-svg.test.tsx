/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MiniBar, Sparkline, StrikeLadder } from "./options-svg";
import type { OptionsStrikeVolume } from "./options-types";

afterEach(() => cleanup());

describe("MiniBar", () => {
  it("positive value renders red bar of correct width", () => {
    const { container } = render(<MiniBar value={50} maxAbs={100} width={200} height={6} />);
    const rect = container.querySelector("[data-testid='minibar-fill']") as SVGRectElement;
    expect(rect).toBeTruthy();
    expect(rect.getAttribute("width")).toBe("100");  // 50/100 * 200
    expect(rect.getAttribute("data-sign")).toBe("pos");
  });

  it("negative value renders green bar", () => {
    const { container } = render(<MiniBar value={-30} maxAbs={100} width={200} height={6} />);
    const rect = container.querySelector("[data-testid='minibar-fill']") as SVGRectElement;
    expect(rect.getAttribute("data-sign")).toBe("neg");
    expect(rect.getAttribute("width")).toBe("60");
  });

  it("zero value renders empty bar", () => {
    const { container } = render(<MiniBar value={0} maxAbs={100} width={200} height={6} />);
    const rect = container.querySelector("[data-testid='minibar-fill']");
    expect(rect?.getAttribute("width")).toBe("0");
  });
});

describe("Sparkline", () => {
  it("renders one polyline + one polygon (area) + one circle (last dot)", () => {
    const { container } = render(<Sparkline series={[1, 3, 2, 4, 3, 5]} width={90} height={30} />);
    expect(container.querySelectorAll("polyline").length).toBe(1);
    expect(container.querySelectorAll("polygon").length).toBe(1);
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  it("empty series renders an svg with no polyline", () => {
    const { container } = render(<Sparkline series={[]} width={90} height={30} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll("polyline").length).toBe(0);
  });
});

describe("StrikeLadder", () => {
  const data: OptionsStrikeVolume = {
    contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
    call: [
      { strike: 53000, volume: 520, oi: 4100, oi_change:  310 },
      { strike: 53500, volume: 1200, oi: 8410, oi_change: 680 },
      { strike: 54000, volume:  980, oi: 7820, oi_change: 320 },
    ],
    put: [
      { strike: 53000, volume:   96, oi: 2410, oi_change:  -22 },
      { strike: 52500, volume:  145, oi: 3520, oi_change:  -88 },
    ],
  };

  it("renders rows for the union of call/put strikes, sorted high→low", () => {
    const { container } = render(<StrikeLadder data={data} spot={53420} />);
    const rows = container.querySelectorAll("[data-testid='ladder-row']");
    expect(rows.length).toBe(5);  // 54000, 53500, 53000, 52500 + 1 spot row
    const strikeLabels = Array.from(rows).map(r =>
      r.querySelector("[data-testid='ladder-strike']")?.textContent
    );
    // first row should be the highest strike (54,000)
    expect(strikeLabels[0]).toBe("54,000");
  });

  it("inserts a spot anchor row when spot is between strikes", () => {
    const { container } = render(<StrikeLadder data={data} spot={53420} />);
    const spotRow = container.querySelector("[data-testid='ladder-spot']");
    expect(spotRow).toBeTruthy();
    expect(spotRow?.textContent).toContain("53,420");
  });

  it("omits spot row when spot is null", () => {
    const { container } = render(<StrikeLadder data={data} spot={null} />);
    expect(container.querySelector("[data-testid='ladder-spot']")).toBeNull();
  });

  it("renders empty state when both sides are empty", () => {
    const empty: OptionsStrikeVolume = { ...data, call: [], put: [] };
    const { container } = render(<StrikeLadder data={empty} spot={53420} />);
    expect(container.querySelector("[data-testid='ladder-empty']")).toBeTruthy();
  });
});
