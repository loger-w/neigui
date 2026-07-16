// 權證 IV 歷史圖純計算測試(warrant-iv-redesign change-spec §6)。
// 缺值斷線 / HV20 口徑(21 個連續有效收盤)/ Theil-Sen 截距 / 雙 panel x 對齊。

import { describe, expect, it } from "vitest";
import type { WarrantIvPoint } from "./warrant-data";
import {
  computeHv20,
  computeIvHistoryChart,
  computeIvPercentile,
  trendLine,
} from "./warrant-iv-svg";

function pt(
  date: string,
  iv_bid: number | null,
  iv_ask: number | null,
  underlying_close: number | null,
): WarrantIvPoint {
  return { date, iv_bid, iv_ask, underlying_close };
}

/** n 點序列產生器:date 遞增,iv/close 由 callback 決定。 */
function mkSeries(
  n: number,
  fn: (i: number) => { b?: number | null; a?: number | null; s?: number | null },
): WarrantIvPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const { b = 0.4, a = 0.45, s = 100 } = fn(i);
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
    return pt(`2026-${month}-${day}`, b, a, s);
  });
}

describe("computeHv20", () => {
  it("21 個連續有效收盤才出第一個點(20 個 log return)", () => {
    const series = mkSeries(21, () => ({ s: 100 }));
    const hv = computeHv20(series);
    expect(hv[19]).toBeNull();
    expect(hv[20]).toBe(0); // 常數收盤 → 報酬全 0 → HV 0
  });

  it("已知數值手算對照:十個 0 報酬 + 十個 0.02 報酬", () => {
    // 11 個 100,再 10 個每日 ×e^0.02:20 個 return = 十個 0、十個 0.02
    // sample std = sqrt(20*0.01^2/19) = 0.0102598,×√252 = 0.16287
    const series = mkSeries(21, (i) => ({
      s: i <= 10 ? 100 : 100 * Math.exp(0.02 * (i - 10)),
    }));
    const hv = computeHv20(series);
    expect(hv[20]).toBeCloseTo(0.16287, 4);
  });

  it("斷檔重積:null 收盤打斷 run,之後要再累 21 個", () => {
    const series = mkSeries(26, (i) => ({ s: i === 4 ? null : 100 }));
    const hv = computeHv20(series);
    expect(hv[4]).toBeNull();
    expect(hv[24]).toBeNull(); // 5..24 只有 20 個收盤(19 個 return)
    expect(hv[25]).toBe(0); // 5..25 = 21 個收盤
  });
});

describe("computeIvPercentile", () => {
  it("最新非 null iv_bid 在全窗非 null 值的分位(<= 口徑,對齊 backend)", () => {
    const series = [
      pt("2026-07-07", 0.43, 0.47, 100),
      pt("2026-07-08", 0.42, 0.46, 100),
      pt("2026-07-09", 0.41, 0.45, 100),
    ];
    expect(computeIvPercentile(series)).toBeCloseTo(33.333, 2); // 最低值 → 1/3
  });

  it("尾端 null 跳過取最新非 null", () => {
    const series = [
      pt("2026-07-07", 0.41, 0.45, 100),
      pt("2026-07-08", 0.43, 0.47, 100),
      pt("2026-07-09", null, null, 100),
    ];
    expect(computeIvPercentile(series)).toBe(100); // 0.43 是最大值
  });

  it("全 null → null", () => {
    expect(computeIvPercentile([pt("2026-07-09", null, null, 100)])).toBeNull();
  });
});

describe("trendLine", () => {
  it("截距 = median(y − slope·x):完美線性殘差恆等", () => {
    const series = mkSeries(5, (i) => ({ b: 0.5 - 0.001 * i }));
    const t = trendLine(series, -0.001);
    expect(t).not.toBeNull();
    expect(t!.intercept).toBeCloseTo(0.5, 10);
    expect(t!.i0).toBe(0);
    expect(t!.i1).toBe(4);
  });

  it("含洞 x 語意:x = series index(不壓縮)", () => {
    const series = [
      pt("2026-07-01", 0.5, 0.55, 100),
      pt("2026-07-02", null, null, 100),
      pt("2026-07-03", 0.48, 0.53, 100), // index 2 → 0.5 - 0.01*2 = 0.48
    ];
    const t = trendLine(series, -0.01);
    expect(t).not.toBeNull();
    expect(t!.intercept).toBeCloseTo(0.5, 10);
    expect(t!.i1).toBe(2);
  });

  it("bid 有效點 <2 → null", () => {
    expect(trendLine([pt("2026-07-09", 0.4, 0.45, 100)], -0.001)).toBeNull();
  });
});

describe("computeIvHistoryChart", () => {
  const W = 800;

  it("空序列 / IV 全 null → null", () => {
    expect(computeIvHistoryChart([], W, null)).toBeNull();
    expect(
      computeIvHistoryChart([pt("2026-07-09", null, null, 100)], W, null),
    ).toBeNull();
  });

  it("雙 panel 同 index 的 x 座標相等(SC-3 垂直對齊)", () => {
    const series = mkSeries(10, () => ({}));
    const geom = computeIvHistoryChart(series, W, null);
    expect(geom).not.toBeNull();
    const bidX = geom!.ivPanel.bidPath.match(/^M([\d.]+),/)![1];
    const priceX = geom!.pricePanel.pricePath.match(/^M([\d.]+),/)![1];
    expect(bidX).toBe(priceX);
  });

  it("y ticks 高值在上(y 座標遞增 = 標籤由高到低);x ticks 取首/中/末日期", () => {
    const series = mkSeries(10, (i) => ({ b: 0.4 + 0.01 * i }));
    const geom = computeIvHistoryChart(series, W, null)!;
    const ys = geom.ivPanel.yTicks.map((t) => t.y);
    expect(ys[0]!).toBeLessThan(ys[1]!);
    expect(ys[1]!).toBeLessThan(ys[2]!);
    expect(geom.xTicks.map((t) => t.label)).toEqual(
      [series[0]!, series[4]!, series[9]!].map((p) => p.date.slice(5)),
    );
  });

  it("缺值日斷線:null 之後 M 重起,不插值", () => {
    const series = mkSeries(5, (i) => ({ b: i === 2 ? null : 0.4 }));
    const geom = computeIvHistoryChart(series, W, null);
    const segments = geom!.ivPanel.bidPath.match(/M/g);
    expect(segments!.length).toBe(2);
  });

  it("trendSlope null → 無 trendPath;非 null → 單段直線", () => {
    const series = mkSeries(5, (i) => ({ b: 0.5 - 0.001 * i }));
    expect(computeIvHistoryChart(series, W, null)!.ivPanel.trendPath).toBe("");
    const withTrend = computeIvHistoryChart(series, W, -0.001)!;
    expect(withTrend.ivPanel.trendPath).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
  });

  it("價格全 null → pricePath 空、price yTicks 空(IV panel 照常)", () => {
    const series = mkSeries(5, () => ({ s: null }));
    const geom = computeIvHistoryChart(series, W, null)!;
    expect(geom.pricePanel.pricePath).toBe("");
    expect(geom.pricePanel.yTicks).toEqual([]);
    expect(geom.ivPanel.bidPath).toMatch(/^M/);
  });

  it("寬度驅動幾何:xTicks 末點隨 width 變", () => {
    const series = mkSeries(10, () => ({}));
    const g1 = computeIvHistoryChart(series, 600, null)!;
    const g2 = computeIvHistoryChart(series, 1200, null)!;
    expect(g2.xTicks[g2.xTicks.length - 1]!.x).toBeGreaterThan(
      g1.xTicks[g1.xTicks.length - 1]!.x,
    );
    expect(g1.width).toBe(600);
  });

  it("HV 線納入 IV panel 值域(HV 遠低於 IV 時不被裁掉)", () => {
    // 26 點:IV 0.5 上下、常數收盤 → HV 0;值域需涵蓋 0
    const series = mkSeries(26, () => ({ b: 0.5, a: 0.55, s: 100 }));
    const geom = computeIvHistoryChart(series, W, null)!;
    expect(geom.ivPanel.hvPath).toMatch(/^M/);
    const lows = geom.ivPanel.yTicks.map((t) => t.label);
    expect(lows).toContain("0%"); // lo tick 被 HV 0 拉下來
  });
});
