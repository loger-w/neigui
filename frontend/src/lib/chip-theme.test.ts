import { describe, expect, test } from "vitest";
import { svgLabelFont, svgLegendFont } from "./chip-theme";

// SC-2:桌面 overlay 字級縮小(22px→16px / 20px→14px 等值),mobile 檔位不動。
describe("svg font scale", () => {
  test("svgLabelFont 桌面檔位 1rem", () => {
    expect(svgLabelFont(900)).toBe("1rem");
    expect(svgLabelFont(500)).toBe("1rem");
  });

  test("svgLabelFont 窄容器檔位維持 0.8125rem", () => {
    expect(svgLabelFont(499)).toBe("0.8125rem");
    expect(svgLabelFont(375)).toBe("0.8125rem");
  });

  test("svgLegendFont 桌面檔位 0.875rem", () => {
    expect(svgLegendFont(900)).toBe("0.875rem");
  });

  test("svgLegendFont 窄容器檔位維持 0.75rem", () => {
    expect(svgLegendFont(499)).toBe("0.75rem");
  });
});
