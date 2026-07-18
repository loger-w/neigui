// 外部淨額時序 SVG 純函式(SC-4:null 日斷點不補 0;design v3 §3.4)
import { describe, expect, test } from "vitest";
import { computeNetHistoryChart } from "./warrant-flow-history-svg";
import type { WarrantFlowHistoryDay } from "./warrant-flow-data";

function day(
  date: string,
  callNet: number | null,
  putNet: number | null = null,
  status: "built" | "missing" = "built",
): WarrantFlowHistoryDay {
  return {
    date,
    status,
    call: status === "built" ? { trade_value: 1e8, external_net: callNet } : null,
    put: status === "built" ? { trade_value: 1e7, external_net: putNet } : null,
  };
}

const W = 600;
const H = 160;

describe("computeNetHistoryChart", () => {
  test("null 日切段:3 值中夾 1 null → 2 段,不補 0", () => {
    const days = [
      day("2026-06-22", 100),
      day("2026-06-23", 200),
      day("2026-06-24", null),
      day("2026-06-25", -50),
      day("2026-06-26", -80),
    ];
    const geom = computeNetHistoryChart(days, W, H);
    expect(geom).toBeTruthy();
    expect(geom!.callSegments.length).toBe(2);
    expect(geom!.callSegments[0]!.length).toBe(2);
    expect(geom!.callSegments[1]!.length).toBe(2);
  });

  test("全 null 線 → 0 段(另一線正常)", () => {
    const days = [day("2026-06-25", 100, null), day("2026-06-26", 200, null)];
    const geom = computeNetHistoryChart(days, W, H);
    expect(geom!.putSegments.length).toBe(0);
    expect(geom!.callSegments.length).toBe(1);
  });

  test("y domain 恆含 0(全正值時零軸在圖底以上)", () => {
    const days = [day("2026-06-25", 100), day("2026-06-26", 200)];
    const geom = computeNetHistoryChart(days, W, H);
    // 全正值:零軸應落在圖內(y 最大端),且所有點 y < zeroY
    expect(geom!.zeroY).toBeGreaterThan(0);
    for (const seg of geom!.callSegments) {
      for (const p of seg) expect(p.y).toBeLessThanOrEqual(geom!.zeroY);
    }
  });

  test("built < 2 → null(不畫圖)", () => {
    expect(computeNetHistoryChart([day("2026-06-26", 100)], W, H)).toBeNull();
    expect(computeNetHistoryChart([], W, H)).toBeNull();
  });

  test("missing 槽不佔 x 位(built 槽等距)", () => {
    const days = [
      day("2026-06-24", 100),
      day("2026-06-25", 0, null, "missing"),
      day("2026-06-26", 300),
    ];
    const geom = computeNetHistoryChart(days, W, H);
    // 兩個 built 點:x 距離 = 整個繪圖寬(missing 不插空位)
    const seg = geom!.callSegments[0]!;
    expect(seg.length).toBe(2);
    const xs = geom!.xTicks.map((t) => t.label);
    expect(xs).not.toContain("06-25");
  });

  test("yTicks 標籤格式:億/萬/元三分支帶號(lock)", () => {
    const days = [day("2026-06-25", -2.5e8), day("2026-06-26", 1.2e8)];
    const geom = computeNetHistoryChart(days, W, H);
    const labels = geom!.yTicks.map((t) => t.label);
    expect(labels).toContain("1.2億");
    expect(labels).toContain("-2.5億");
    const small = computeNetHistoryChart(
      [day("2026-06-25", 30_000), day("2026-06-26", -500)],
      W,
      H,
    );
    const smallLabels = small!.yTicks.map((t) => t.label);
    expect(smallLabels).toContain("3萬");
    expect(smallLabels).toContain("-500");
  });

  test("單點段回報為孤點(圓點 marker 由元件畫)", () => {
    const days = [
      day("2026-06-23", 100),
      day("2026-06-24", null),
      day("2026-06-25", 200),
      day("2026-06-26", null),
    ];
    const geom = computeNetHistoryChart(days, W, H);
    // 兩個孤點 → 2 段、各 1 點
    expect(geom!.callSegments.length).toBe(2);
    expect(geom!.callSegments.every((s) => s.length === 1)).toBe(true);
  });
});
