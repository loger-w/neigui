import { describe, it, expect } from "vitest";
import {
  sliceWindow,
  valueDomain,
  buildSegments,
  zeroLineY,
  polylinePoints,
} from "./breadth-svg";
import type { BreadthPoint } from "./market-types";

function point(date: string, value: number | null): BreadthPoint {
  return { date, value };
}

describe("buildSegments", () => {
  it("null 斷線分 2 段 — [null,5,7,null,3] → 2 segments,長度 [2,1],x 用全序列 index(CR1-4)", () => {
    const series: BreadthPoint[] = [
      point("d0", null),
      point("d1", 5),
      point("d2", 7),
      point("d3", null),
      point("d4", 3),
    ];
    const segments = buildSegments(series, 100, 50);
    expect(segments.length).toBe(2);
    expect(segments[0]!.pts.length).toBe(2);
    expect(segments[1]!.pts.length).toBe(1);
    // pad=4(預設),w=100,len=5 → step=(100-2*4)/4=23。x 必須用「全序列 index」
    // 映射(d1→i=1、d2→i=2、d4→i=4),不能斷線後每段從 x=pad 重新計數,
    // 否則斷線後的段會視覺塌縮到左邊。
    expect(segments[0]!.pts[0]!.x).toBe(4 + 1 * 23); // d1, i=1 → 27
    expect(segments[0]!.pts[1]!.x).toBe(4 + 2 * 23); // d2, i=2 → 50
    expect(segments[1]!.pts[0]!.x).toBe(4 + 4 * 23); // d4, i=4 → 96 (= w-pad)
  });

  it("全 null → []", () => {
    const series: BreadthPoint[] = [point("d0", null), point("d1", null)];
    expect(buildSegments(series, 100, 50)).toEqual([]);
  });

  it("暖機序列:前 38 null 的 128 筆 slice(60) 後全非 null,1 段", () => {
    const series: BreadthPoint[] = [];
    for (let i = 0; i < 128; i++) {
      series.push(point(`d${i}`, i < 38 ? null : i));
    }
    const sliced = sliceWindow(series, 60);
    const segments = buildSegments(sliced, 100, 50);
    expect(segments.length).toBe(1);
    expect(segments[0]!.pts.length).toBe(60);
  });

  it("y 座標反轉映射:max 值 y=pad、min 值 y=h-pad", () => {
    const series: BreadthPoint[] = [point("d0", 0), point("d1", 10)];
    const segments = buildSegments(series, 100, 50, { pad: 4 });
    // d1(=max=10) → y=pad=4; d0(=min=0) → y=h-pad=46
    expect(segments[0]!.pts[0]!.y).toBe(46);
    expect(segments[0]!.pts[1]!.y).toBe(4);
  });

  it("退化 domain(max===min)→ y = h/2", () => {
    const series: BreadthPoint[] = [point("d0", 5), point("d1", 5)];
    const segments = buildSegments(series, 100, 50);
    expect(segments[0]!.pts[0]!.y).toBe(25);
    expect(segments[0]!.pts[1]!.y).toBe(25);
  });

  it("len===1 → x = w/2", () => {
    const series: BreadthPoint[] = [point("d0", 5)];
    const segments = buildSegments(series, 100, 50);
    expect(segments[0]!.pts[0]!.x).toBe(50);
  });
});

describe("sliceWindow", () => {
  it("取尾端 60 筆(n 預設 60)", () => {
    const series = Array.from({ length: 100 }, (_, i) => i);
    const sliced = sliceWindow(series, 60);
    expect(sliced.length).toBe(60);
    expect(sliced[0]).toBe(40);
    expect(sliced[59]).toBe(99);
  });

  it("len < n → 原樣", () => {
    const series = [1, 2, 3];
    expect(sliceWindow(series, 60)).toEqual([1, 2, 3]);
  });
});

describe("valueDomain", () => {
  it("全 null → null", () => {
    const series: BreadthPoint[] = [point("d0", null), point("d1", null)];
    expect(valueDomain(series, false)).toBeNull();
  });

  it("includeZero=false 不強制 0 入域", () => {
    const series: BreadthPoint[] = [point("d0", 5), point("d1", -3)];
    expect(valueDomain(series, false)).toEqual({ min: -3, max: 5 });
  });

  it("includeZero=true 強制 0 入域", () => {
    const series: BreadthPoint[] = [point("d0", 5), point("d1", 8)];
    expect(valueDomain(series, true)).toEqual({ min: 0, max: 8 });
  });
});

describe("zeroLineY", () => {
  it("與 buildSegments(includeZero:true) 同 domain 一致 — pinned 46", () => {
    const series: BreadthPoint[] = [point("d0", 10)];
    expect(zeroLineY(series, 50)).toBe(46);
  });

  it("全 null → null", () => {
    const series: BreadthPoint[] = [point("d0", null)];
    expect(zeroLineY(series, 50)).toBeNull();
  });
});

describe("polylinePoints", () => {
  it("格式化為 SVG points 字串", () => {
    expect(
      polylinePoints({
        pts: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      }),
    ).toBe("1,2 3,4");
  });
});
