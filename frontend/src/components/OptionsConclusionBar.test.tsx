/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsConclusionBar } from "./OptionsConclusionBar";

afterEach(() => cleanup());

// 痛點:SC-6 今日結論列 — 句子由 buildConclusion 生成;資料不足要有明確
// fallback 而不是空白列;禁方向性文案鐵則擴及此元件(design v3 §0)。

describe("OptionsConclusionBar", () => {
  it("renders position + max pain sentences", () => {
    render(
      <OptionsConclusionBar
        spot={22800} putWall={21000} callWall={23000} maxPain={22700}
      />,
    );
    const bar = screen.getByTestId("options-conclusion");
    expect(bar.textContent).toContain("偏上緣");
    expect(bar.textContent).toContain("Max Pain");
  });

  it("falls back when all inputs missing", () => {
    render(
      <OptionsConclusionBar spot={null} putWall={null} callWall={null} maxPain={null} />,
    );
    expect(screen.getByText("結論生成資料不足")).toBeTruthy();
  });

  it("never renders directional copy", () => {
    render(
      <OptionsConclusionBar
        spot={23100} putWall={21000} callWall={23000} maxPain={20000}
      />,
    );
    expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull();
  });
});
