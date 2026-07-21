// formatAmountZh — 千/萬/億中文縮寫(design R1:market-format.formatAmount
// 是百萬 M 口徑,不重用;金額是雙表主排序欄,口徑錯直接影響 SC-4)
import { describe, expect, it } from "vitest";
import { formatAmountZh } from "./broker-flows-data";

describe("formatAmountZh", () => {
  it("億級:兩位小數", () => {
    expect(formatAmountZh(400_500_000)).toBe("4.01億");
    expect(formatAmountZh(-933_240_000)).toBe("-9.33億");
  });

  it("萬級:≥100萬 取整,<100萬 一位小數", () => {
    expect(formatAmountZh(10_000_000)).toBe("1000萬");
    expect(formatAmountZh(123_456)).toBe("12.3萬");
  });

  it("千元以下:千分位原值", () => {
    expect(formatAmountZh(5000)).toBe("5,000");
  });

  it("0 與負萬級", () => {
    expect(formatAmountZh(0)).toBe("0");
    expect(formatAmountZh(-123_456)).toBe("-12.3萬");
  });
});
