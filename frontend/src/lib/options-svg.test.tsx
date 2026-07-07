/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MiniBar, Sparkline } from "./options-svg";

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
