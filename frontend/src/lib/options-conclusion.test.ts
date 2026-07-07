import { describe, expect, it } from "vitest";
import { buildConclusion } from "./options-conclusion";

// 痛點:結論列是 options-page-v2 SC-6 的核心翻譯層 — 模板句必須覆蓋全部落區
// 分支與資料缺漏 fallback,且嚴禁方向性文案(design v3 §0 鐵則)。

describe("buildConclusion 位置句", () => {
  it("雙牆之間偏上緣", () => {
    const out = buildConclusion({ spot: 22800, putWall: 21000, callWall: 23000, maxPain: null });
    expect(out.join("")).toContain("偏上緣");
    expect(out.join("")).toContain("21,000");
    expect(out.join("")).toContain("23,000");
  });

  it("雙牆之間中段", () => {
    const out = buildConclusion({ spot: 22000, putWall: 21000, callWall: 23000, maxPain: null });
    expect(out.join("")).toContain("中段");
  });

  it("雙牆之間偏下緣", () => {
    const out = buildConclusion({ spot: 21200, putWall: 21000, callWall: 23000, maxPain: null });
    expect(out.join("")).toContain("偏下緣");
  });

  it("嚴格大於壓力才算越過", () => {
    const out = buildConclusion({ spot: 23100, putWall: 21000, callWall: 23000, maxPain: null });
    expect(out.join("")).toContain("越過壓力");
  });

  it("spot 恰等於壓力算區間內(edge 2)", () => {
    const out = buildConclusion({ spot: 23000, putWall: 21000, callWall: 23000, maxPain: null });
    expect(out.join("")).not.toContain("越過");
    expect(out.join("")).toContain("偏上緣");
  });

  it("跌破支撐", () => {
    const out = buildConclusion({ spot: 20900, putWall: 21000, callWall: 23000, maxPain: null });
    expect(out.join("")).toContain("跌破支撐");
  });

  it("單側無 call 牆(edge 1)", () => {
    const out = buildConclusion({ spot: 22000, putWall: 21000, callWall: null, maxPain: null });
    expect(out.join("")).toContain("上方無明顯 OI 牆");
    expect(out.join("")).toContain("21,000");
  });

  it("單側無 put 牆", () => {
    const out = buildConclusion({ spot: 22000, putWall: null, callWall: 23000, maxPain: null });
    expect(out.join("")).toContain("下方無明顯 OI 牆");
  });

  it("雙牆皆缺", () => {
    const out = buildConclusion({ spot: 22000, putWall: null, callWall: null, maxPain: null });
    expect(out.join("")).toContain("皆無明顯 OI 牆");
  });

  it("spot 缺 → 省略位置句(edge 5)", () => {
    const out = buildConclusion({ spot: null, putWall: 21000, callWall: 23000, maxPain: 22000 });
    expect(out.join("")).not.toContain("位於");
    expect(out.join("")).not.toContain("支撐");
  });
});

describe("buildConclusion Max Pain 句", () => {
  it("在現價下方 x.x%", () => {
    const out = buildConclusion({ spot: 23000, putWall: null, callWall: null, maxPain: 22700 });
    expect(out.join("")).toContain("Max Pain");
    expect(out.join("")).toContain("下方 1.3%");
  });

  it("在現價上方", () => {
    const out = buildConclusion({ spot: 22000, putWall: null, callWall: null, maxPain: 22400 });
    expect(out.join("")).toContain("上方 1.8%");
  });

  it("幾乎重合(|x| < 0.05%)", () => {
    const out = buildConclusion({ spot: 23000, putWall: null, callWall: null, maxPain: 23005 });
    expect(out.join("")).toContain("幾乎重合");
  });

  it("maxPain 缺 → 省句", () => {
    const out = buildConclusion({ spot: 23000, putWall: 21000, callWall: 23500, maxPain: null });
    expect(out.join("")).not.toContain("Max Pain");
  });

  it("全缺 → 空陣列", () => {
    expect(buildConclusion({ spot: null, putWall: null, callWall: null, maxPain: null })).toEqual([]);
  });
});

describe("buildConclusion 反身性鐵則", () => {
  it("任何輸入組合都不得出現方向性文案", () => {
    const inputs = [
      { spot: 22800, putWall: 21000, callWall: 23000, maxPain: 22000 },
      { spot: 23100, putWall: 21000, callWall: 23000, maxPain: 23100 },
      { spot: 20900, putWall: 21000, callWall: 23000, maxPain: 20000 },
      { spot: 22000, putWall: null, callWall: null, maxPain: null },
    ];
    for (const input of inputs) {
      const text = buildConclusion(input).join("");
      expect(text).not.toMatch(/做多|做空|賣選|滿倉|買進|賣出|進場|出場/);
    }
  });
});
