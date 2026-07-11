/**
 * warrant-iv-svg — 純 SVG 計算(SC-7;無 React 依賴,對齊 chip-svg 慣例)。
 */
import { describe, expect, it } from "vitest";
import { computeIvChart } from "./warrant-iv-svg";
import type { WarrantIvPoint } from "./warrant-data";

const pt = (date: string, bid: number | null, ask: number | null): WarrantIvPoint => ({
  date,
  iv_bid: bid,
  iv_ask: ask,
});

describe("computeIvChart", () => {
  it("兩線 path:連續有效點 M 起手 + L 連線", () => {
    const geom = computeIvChart(
      [pt("2026-07-07", 0.43, 0.47), pt("2026-07-08", 0.42, 0.46), pt("2026-07-09", 0.41, 0.45)],
      300,
      120,
    );
    expect(geom).not.toBeNull();
    expect(geom!.bidPath.startsWith("M")).toBe(true);
    expect(geom!.bidPath.match(/L/g)).toHaveLength(2);
    expect(geom!.askPath.match(/M/g)).toHaveLength(1);
  });

  it("中段缺值日斷線:path 兩段 M,不插值(R24 渲染語意)", () => {
    const geom = computeIvChart(
      [
        pt("2026-07-05", 0.44, 0.48),
        pt("2026-07-06", 0.43, 0.47),
        pt("2026-07-07", null, null),
        pt("2026-07-08", 0.42, 0.46),
        pt("2026-07-09", 0.41, 0.45),
      ],
      300,
      120,
    );
    expect(geom!.bidPath.match(/M/g)).toHaveLength(2);
    expect(geom!.askPath.match(/M/g)).toHaveLength(2);
  });

  it("雙側全 null → null(元件顯示空狀態)", () => {
    expect(computeIvChart([pt("2026-07-09", null, null)], 300, 120)).toBeNull();
    expect(computeIvChart([], 300, 120)).toBeNull();
  });

  it("y 軸刻度單調遞增(座標)且標籤為百分比", () => {
    const geom = computeIvChart(
      [pt("2026-07-08", 0.40, 0.50), pt("2026-07-09", 0.30, 0.60)],
      300,
      120,
    );
    const ys = geom!.yTicks.map((t) => t.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const t of geom!.yTicks) expect(t.label).toMatch(/%$/);
  });

  it("x 軸刻度含首尾日期", () => {
    const geom = computeIvChart(
      [pt("2026-07-07", 0.43, null), pt("2026-07-08", 0.42, null), pt("2026-07-09", 0.41, null)],
      300,
      120,
    );
    const labels = geom!.xTicks.map((t) => t.label);
    expect(labels[0]).toContain("07-07");
    expect(labels[labels.length - 1]).toContain("07-09");
  });
});
