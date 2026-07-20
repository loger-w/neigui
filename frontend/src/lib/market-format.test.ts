import { describe, it, expect } from "vitest";
import { lotsToWan, pctText, signedPctPoints } from "./market-format";

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
