/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  IntradayLineLayer, pointsToPolyline, parseMinute,
  SESSION_START_MIN, SESSION_RANGE_MIN,
} from "./intraday-line-svg";
import type { IntradayPoint } from "./chip-data";

afterEach(() => cleanup());

describe("parseMinute", () => {
  it("HH:MM → minutes from midnight", () => {
    expect(parseMinute("09:00")).toBe(540);
    expect(parseMinute("13:30")).toBe(810);
    expect(parseMinute("11:15")).toBe(675);
  });

  it("HH:MM:SS form takes first 5 chars", () => {
    expect(parseMinute("09:00:00")).toBe(540);
    expect(parseMinute("13:30:00")).toBe(810);
  });

  it("invalid returns NaN", () => {
    expect(Number.isNaN(parseMinute("bad"))).toBe(true);
    expect(Number.isNaN(parseMinute(""))).toBe(true);
  });
});

describe("pointsToPolyline", () => {
  const padL = 56, padT = 12, cW = 400, cH = 256;

  it("session range constants match 09:00 → 13:30", () => {
    expect(SESSION_START_MIN).toBe(540);
    expect(SESSION_RANGE_MIN).toBe(270);
  });

  it("empty points returns empty string", () => {
    expect(pointsToPolyline([], 100, 200, padL, padT, cW, cH)).toBe("");
  });

  it("equal yLow/yHigh returns empty string (no scale)", () => {
    const pts: IntradayPoint[] = [{ t: "09:00", price: 100 }];
    expect(pointsToPolyline(pts, 100, 100, padL, padT, cW, cH)).toBe("");
  });

  it("first point at 09:00 lands at paddingLeft (X=56)", () => {
    const pts: IntradayPoint[] = [{ t: "09:00", price: 150 }];
    const d = pointsToPolyline(pts, 100, 200, padL, padT, cW, cH);
    expect(d.startsWith("56.0,")).toBe(true);
  });

  it("last point at 13:30 lands at paddingLeft + chartWidth (X=456)", () => {
    const pts: IntradayPoint[] = [{ t: "13:30", price: 150 }];
    const d = pointsToPolyline(pts, 100, 200, padL, padT, cW, cH);
    expect(d.startsWith("456.0,")).toBe(true);
  });

  it("midpoint price lands at vertical center", () => {
    const pts: IntradayPoint[] = [{ t: "09:00", price: 150 }];
    const d = pointsToPolyline(pts, 100, 200, padL, padT, cW, cH);
    // yHigh=200, yLow=100, yRange=100; price=150 (midpoint)
    // y = padT + ((200-150)/100) * cH = 12 + 0.5 * 256 = 12 + 128 = 140
    expect(d).toBe("56.0,140.0");
  });

  it("multiple points join with spaces", () => {
    const pts: IntradayPoint[] = [
      { t: "09:00", price: 100 },
      { t: "13:30", price: 200 },
    ];
    const d = pointsToPolyline(pts, 100, 200, padL, padT, cW, cH);
    expect(d.split(" ").length).toBe(2);
  });

  it("rows with invalid minute are skipped", () => {
    const pts: IntradayPoint[] = [
      { t: "09:00", price: 150 },
      { t: "bad", price: 160 },
      { t: "13:30", price: 170 },
    ];
    const d = pointsToPolyline(pts, 100, 200, padL, padT, cW, cH);
    expect(d.split(" ").length).toBe(2);
  });
});

describe("IntradayLineLayer rendering", () => {
  it("empty points → renders nothing", () => {
    const { container } = render(
      <svg>
        <IntradayLineLayer
          points={[]} yLow={100} yHigh={200}
          paddingLeft={56} paddingTop={12} chartWidth={400} chartHeight={256}
        />
      </svg>,
    );
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("equal yLow/yHigh → renders nothing", () => {
    const { container } = render(
      <svg>
        <IntradayLineLayer
          points={[{ t: "09:00", price: 100 }]} yLow={100} yHigh={100}
          paddingLeft={56} paddingTop={12} chartWidth={400} chartHeight={256}
        />
      </svg>,
    );
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("valid points → renders polyline with stroke #7c6f55 + strokeWidth 1", () => {
    const { container } = render(
      <svg>
        <IntradayLineLayer
          points={[
            { t: "09:00", price: 120 },
            { t: "13:30", price: 180 },
          ]}
          yLow={100} yHigh={200}
          paddingLeft={56} paddingTop={12} chartWidth={400} chartHeight={256}
        />
      </svg>,
    );
    const line = container.querySelector("polyline");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("stroke")).toBe("#7c6f55");
    expect(line!.getAttribute("stroke-width")).toBe("1");
    expect(line!.getAttribute("fill")).toBe("none");
    expect(line!.getAttribute("pointer-events")).toBe("none");
  });

  it("has data-testid for downstream assertions", () => {
    const { container } = render(
      <svg>
        <IntradayLineLayer
          points={[{ t: "09:00", price: 150 }]}
          yLow={100} yHigh={200}
          paddingLeft={56} paddingTop={12} chartWidth={400} chartHeight={256}
        />
      </svg>,
    );
    expect(container.querySelector('[data-testid="intraday-line"]')).not.toBeNull();
  });
});
