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

  it("single-point series renders empty svg without NaN attributes", () => {
    const { container } = render(<Sparkline series={[100]} width={90} height={30} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // No NaN-producing geometry — a 1-point polyline used to render invisible.
    expect(container.querySelectorAll("polyline").length).toBe(0);
    expect(container.querySelectorAll("polygon").length).toBe(0);
    expect(container.querySelectorAll("circle").length).toBe(0);
  });

  it("series containing nulls or NaN is filtered out", () => {
    const { container } = render(
      // @ts-expect-error — testing defensive runtime behaviour
      <Sparkline series={[1, null, NaN, 3, 4, 5]} width={90} height={30} />,
    );
    // After filtering, 4 valid points → renders normally.
    expect(container.querySelectorAll("polyline").length).toBe(1);
    expect(container.querySelectorAll("polygon").length).toBe(1);
    expect(container.querySelectorAll("circle").length).toBe(1);
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

  // ---------------------------------------------------------------------
  // Call Wall / Put Wall: the strike row carrying the largest call-side
  // OI (resp. put-side OI) is the most-watched pin / resistance / support
  // anchor in TXO chip pages (wantgoo, optree convention; SpotGamma calls
  // these "Call Wall" / "Put Wall"). The ladder must surface them so
  // readers can place them in 30 seconds.
  // ---------------------------------------------------------------------

  it("marks the highest-OI call strike with data-wall='call'", () => {
    // call: 53000 oi=4100, 53500 oi=8410 (max), 54000 oi=7820
    const { container } = render(<StrikeLadder data={data} spot={null} />);
    const wallRows = container.querySelectorAll("[data-wall='call']");
    expect(wallRows.length).toBe(1);
    const strike = wallRows[0]!.querySelector("[data-testid='ladder-strike']")?.textContent;
    expect(strike).toBe("53,500");
  });

  it("marks the highest-OI put strike with data-wall='put'", () => {
    // put: 53000 oi=2410, 52500 oi=3520 (max)
    const { container } = render(<StrikeLadder data={data} spot={null} />);
    const wallRows = container.querySelectorAll("[data-wall='put']");
    expect(wallRows.length).toBe(1);
    const strike = wallRows[0]!.querySelector("[data-testid='ladder-strike']")?.textContent;
    expect(strike).toBe("52,500");
  });

  it("when same strike holds both walls, the row carries both attrs (data-wall-call & data-wall-put)", () => {
    const both: OptionsStrikeVolume = {
      ...data,
      call: [
        { strike: 53000, volume: 100, oi: 9000, oi_change: 0 },
        { strike: 53500, volume: 100, oi: 1000, oi_change: 0 },
      ],
      put: [
        { strike: 53000, volume: 100, oi: 5000, oi_change: 0 },
        { strike: 52500, volume: 100, oi: 1000, oi_change: 0 },
      ],
    };
    const { container } = render(<StrikeLadder data={both} spot={null} />);
    // Use composite attrs so the styling can light up both sides on the
    // same row instead of forcing a single `data-wall` value.
    const row = container.querySelector(
      "[data-wall-call='true'][data-wall-put='true']",
    );
    expect(row).toBeTruthy();
    expect(row?.querySelector("[data-testid='ladder-strike']")?.textContent).toBe("53,000");
  });

  it("omits wall markers when a side has no OI at all", () => {
    const callOnly: OptionsStrikeVolume = {
      ...data,
      put: [],  // no put OI → no put wall
    };
    const { container } = render(<StrikeLadder data={callOnly} spot={null} />);
    expect(container.querySelectorAll("[data-wall='call']").length).toBe(1);
    expect(container.querySelectorAll("[data-wall='put']").length).toBe(0);
  });

  it("ignores strikes whose OI is zero (a 0-OI strike must not become a wall)", () => {
    const zeroOI: OptionsStrikeVolume = {
      contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
      // call OI all zero → no Call Wall
      call: [
        { strike: 53000, volume: 520, oi: 0, oi_change: 0 },
        { strike: 53500, volume: 1200, oi: 0, oi_change: 0 },
      ],
      put: [
        { strike: 52500, volume: 145, oi: 3520, oi_change: 0 },
      ],
    };
    const { container } = render(<StrikeLadder data={zeroOI} spot={null} />);
    expect(container.querySelectorAll("[data-wall='call']").length).toBe(0);
    expect(container.querySelectorAll("[data-wall='put']").length).toBe(1);
  });
});
