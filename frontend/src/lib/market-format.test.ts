import { describe, it, expect } from "vitest";
import {
  changeColorClass,
  formatAmount,
  formatRatio,
  lotsToWan,
  pctText,
  signedPctPoints,
  signedPercent,
} from "./market-format";

describe("lotsToWan", () => {
  it("converts lots to 萬張 with 1 decimal", () => {
    expect(lotsToWan(409858)).toBe("41.0");
  });

  it("handles zero boundary", () => {
    expect(lotsToWan(0)).toBe("0.0");
  });
});

describe("pctText", () => {
  it("formats with 0 decimals", () => {
    expect(pctText(0.8, 0)).toBe("80%");
  });

  it("formats with 1 decimal", () => {
    expect(pctText(0.40561, 1)).toBe("40.6%");
  });
});

describe("signedPctPoints", () => {
  it("prefixes + for positive value", () => {
    expect(signedPctPoints(0.0015567)).toBe("+0.16");
  });

  it("keeps - sign for negative value", () => {
    expect(signedPctPoints(-0.0059)).toBe("-0.59");
  });

  it("shows 0.00 without + prefix for zero", () => {
    expect(signedPctPoints(0)).toBe("0.00");
  });

  it("returns em-dash for null", () => {
    expect(signedPctPoints(null)).toBe("—");
  });
});

describe("signedPercent (R7 單位契約:輸入已是百分比數值,不 ×100)", () => {
  it("prefixes + for positive change_rate", () => {
    expect(signedPercent(1.2)).toBe("+1.20%");
  });

  it("keeps - sign for negative change_rate", () => {
    expect(signedPercent(-2.11)).toBe("-2.11%");
  });

  it("shows 0.00% without + prefix for zero", () => {
    expect(signedPercent(0)).toBe("0.00%");
  });

  it("returns em-dash for null (SC-1 spread 缺席)", () => {
    expect(signedPercent(null)).toBe("—");
  });
});

describe("formatRatio", () => {
  it("formats with x suffix", () => {
    expect(formatRatio(1.314)).toBe("1.31x");
  });

  it("returns em-dash for null (SC-3 分母 0 降級)", () => {
    expect(formatRatio(null)).toBe("—");
  });
});

describe("formatAmount", () => {
  it("converts TWD to million with 1 decimal", () => {
    expect(formatAmount(123_456_789)).toBe("123.5M");
  });

  it("returns em-dash for null", () => {
    expect(formatAmount(null)).toBe("—");
  });
});

describe("changeColorClass", () => {
  it("returns text-bull for positive", () => {
    expect(changeColorClass(1.2)).toBe("text-bull");
  });

  it("returns text-bear for negative", () => {
    expect(changeColorClass(-2.11)).toBe("text-bear");
  });

  it("returns neutral for zero", () => {
    expect(changeColorClass(0)).toBe("text-ink-dim");
  });

  it("returns neutral for null", () => {
    expect(changeColorClass(null)).toBe("text-ink-dim");
  });
});
