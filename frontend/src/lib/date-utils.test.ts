import { describe, expect, it } from "vitest";
import { addDays } from "./date-utils";

describe("addDays", () => {
  it("shifts forward within a month", () => {
    expect(addDays("2026-06-10", 5)).toBe("2026-06-15");
  });

  it("shifts backward across month boundary", () => {
    expect(addDays("2026-06-22", -22)).toBe("2026-05-31");
  });

  it("shifts backward across year boundary", () => {
    expect(addDays("2026-01-05", -10)).toBe("2025-12-26");
  });

  it("handles leap day (2024-02-29 exists)", () => {
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2023-03-01", -1)).toBe("2023-02-28");
  });

  it("matches the ladder anchors used by useChipData", () => {
    // 主力線階梯的覆蓋左界:anchor 2026-06-22 回推 150/300/540 日曆日
    expect(addDays("2026-06-22", -150)).toBe("2026-01-23");
    expect(addDays("2026-06-22", -300)).toBe("2025-08-26");
    expect(addDays("2026-06-22", -540)).toBe("2024-12-29");
  });

  it("n=0 is identity", () => {
    expect(addDays("2026-06-22", 0)).toBe("2026-06-22");
  });
});
