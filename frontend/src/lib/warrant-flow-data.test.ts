// warrant-flow-data 純函式(design §3.1;bar 比例與金額格式)
import { describe, expect, it } from "vitest";
import { barRatio, formatValue } from "./warrant-flow-data";

describe("barRatio", () => {
  it("max <= 0 回 0(除零防禦)", () => {
    expect(barRatio(100, 0)).toBe(0);
    expect(barRatio(100, -5)).toBe(0);
  });

  it("負值取絕對值(賣超欄同一把尺)", () => {
    expect(barRatio(-50, 100)).toBe(0.5);
  });

  it("clamp 到 1", () => {
    expect(barRatio(150, 100)).toBe(1);
  });
});

describe("formatValue", () => {
  it("億級兩位小數", () => {
    expect(formatValue(234_560_000)).toBe("2.35 億");
  });

  it("萬級整數", () => {
    expect(formatValue(5_046_000)).toBe("504 萬");
  });

  it("零", () => {
    expect(formatValue(0)).toBe("0 元");
  });

  it("負值以 abs 縮寫(impl-R1:方向由色彩表達,不出現 -X,XXX 元)", () => {
    expect(formatValue(-234_560_000)).toBe("2.35 億");
    expect(formatValue(-5_046_000)).toBe("504 萬");
  });
});
