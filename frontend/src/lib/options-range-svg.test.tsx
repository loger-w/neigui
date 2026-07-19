/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RangeMapSvg } from "./options-range-svg";
import type { OptionsStrikeVolume } from "./options-types";

afterEach(() => cleanup());

// 痛點:RangeMap 是 options-page-v2 SC-7 主視覺 — 牆一律吃後端 oi_walls
// 權威值(props),不得沿用 StrikeLadder 的前端 maxOIStrike 自算(雙源
// drift);且基底 StrikeLadder 的牆色是反轉遺留(design v3 R7),本檔以
// 正向 assertion 鎖 call=bear 綠 / put=bull 紅。

const data: OptionsStrikeVolume = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [
    { strike: 53000, volume: 520, oi: 4100, oi_change: 310 },
    { strike: 53500, volume: 1200, oi: 8410, oi_change: 680 },  // max call OI
    { strike: 54000, volume: 980, oi: 7820, oi_change: 320 },
  ],
  put: [
    { strike: 53000, volume: 96, oi: 2410, oi_change: -22 },
    { strike: 52500, volume: 145, oi: 3520, oi_change: -88 },   // max put OI
  ],
};

function renderMap(over: Partial<Parameters<typeof RangeMapSvg>[0]> = {}) {
  return render(
    <RangeMapSvg
      data={data} metric="oi" spot={53420}
      callWall={54000} putWall={52500} maxPain={53000}
      {...over}
    />,
  );
}

describe("RangeMapSvg 基本渲染(自 StrikeLadder 遷移)", () => {
  it("renders union rows sorted high→low + spot anchor row", () => {
    const { container } = renderMap();
    const strikes = Array.from(
      container.querySelectorAll("[data-testid='rangemap-strike']"),
    ).map((el) => el.textContent);
    expect(strikes[0]).toContain("54,000");
    expect(container.querySelector("[data-testid='rangemap-spot']")?.textContent)
      .toContain("53,420");
  });

  it("spot 高於最高 strike → spot 列排最上(characterization,unshift 分支)", () => {
    const { container } = renderMap({ spot: 54500 });
    const rows = container.querySelectorAll("[data-testid='rangemap-row']");
    expect(rows[0]!.querySelector("[data-testid='rangemap-spot']")).toBeTruthy();
  });

  it("omits spot row when spot is null", () => {
    const { container } = renderMap({ spot: null });
    expect(container.querySelector("[data-testid='rangemap-spot']")).toBeNull();
  });

  it("renders empty state when both sides are empty", () => {
    const { container } = render(
      <RangeMapSvg
        data={{ ...data, call: [], put: [] }} metric="oi" spot={53420}
        callWall={null} putWall={null} maxPain={null}
      />,
    );
    expect(container.querySelector("[data-testid='rangemap-empty']")).toBeTruthy();
  });
});

describe("RangeMapSvg 牆標記 = 後端權威值(雙源收斂)", () => {
  it("marks the PROP wall strike, not the frontend max-OI strike", () => {
    // 後端 callWall=54000(OTM 規則下的權威值);前端 max call OI 在 53500 —
    // 若 renderer 偷自算會標錯行。
    const { container } = renderMap();
    const callWallRow = container.querySelector("[data-wall='call']");
    expect(callWallRow?.querySelector("[data-testid='rangemap-strike']")?.textContent)
      .toContain("54,000");
    const putWallRow = container.querySelector("[data-wall='put']");
    expect(putWallRow?.querySelector("[data-testid='rangemap-strike']")?.textContent)
      .toContain("52,500");
  });

  it("renders no wall markers when walls are null", () => {
    const { container } = renderMap({ callWall: null, putWall: null });
    expect(container.querySelectorAll("[data-wall]").length).toBe(0);
  });

  it("wall strike missing from data still renders a synthetic row (R4 防禦)", () => {
    const { container } = renderMap({ callWall: 55000 });
    const row = container.querySelector("[data-wall='call']");
    expect(row?.querySelector("[data-testid='rangemap-strike']")?.textContent)
      .toContain("55,000");
  });

  it("call wall = 壓力 = bear 色 / put wall = 支撐 = bull 色(R7 正向鎖)", () => {
    const { container } = renderMap();
    const callCell = container.querySelector("[data-testid='rangemap-wall-call']");
    const putCell = container.querySelector("[data-testid='rangemap-wall-put']");
    expect(callCell?.className).toContain("text-bear");
    expect(putCell?.className).toContain("text-bull");
  });

  it("call side bars use bear color, put side bars use bull color(R7)", () => {
    const { container } = renderMap();
    const callBar = container.querySelector("[data-testid='rangemap-bar-call']");
    const putBar = container.querySelector("[data-testid='rangemap-bar-put']");
    expect(callBar?.className).toContain("bg-bear");
    expect(putBar?.className).toContain("bg-bull");
  });
});

describe("RangeMapSvg Max Pain 標記", () => {
  it("marks the max pain strike row", () => {
    const { container } = renderMap();
    const mpRow = container.querySelector("[data-testid='rangemap-maxpain']");
    expect(mpRow).toBeTruthy();
    expect(mpRow?.closest("tr")?.querySelector("[data-testid='rangemap-strike']")?.textContent)
      .toContain("53,000");
  });

  it("no marker when maxPain null", () => {
    const { container } = renderMap({ maxPain: null });
    expect(container.querySelector("[data-testid='rangemap-maxpain']")).toBeNull();
  });
});

describe("RangeMapSvg metric toggle + 視窗", () => {
  it("metric='volume' sizes bars by volume instead of oi", () => {
    const oi = renderMap({ metric: "oi" });
    const oiWidth = (oi.container.querySelector(
      "[data-testid='rangemap-bar-call']",
    ) as HTMLElement).style.width;
    cleanup();
    const vol = renderMap({ metric: "volume" });
    const volWidth = (vol.container.querySelector(
      "[data-testid='rangemap-bar-call']",
    ) as HTMLElement).style.width;
    // call 53000: oi=4100/max8410 vs volume=520/max1200 — 比例不同
    expect(oiWidth).not.toBe(volWidth);
  });

  it("clips to spot ±20 檔 while force-including walls(R12 視窗)", () => {
    const manyStrikes: OptionsStrikeVolume = {
      ...data,
      call: Array.from({ length: 60 }, (_, i) => ({
        strike: 50000 + i * 100, volume: 10, oi: 100 + i, oi_change: 0,
      })),
      put: [],
    };
    const { container } = render(
      <RangeMapSvg
        data={manyStrikes} metric="oi" spot={53000}
        callWall={55900} putWall={null} maxPain={null}
      />,
    );
    const strikes = Array.from(
      container.querySelectorAll("[data-testid='rangemap-strike']"),
    ).map((el) => el.textContent ?? "");
    // spot ±20 → 41 檔上下,加上強制納入的 callWall 55900(窗外)
    expect(strikes.some((s) => s.includes("55,900"))).toBe(true);
    // 最遠端(50,000,距 spot 30 檔)應被截尾
    expect(strikes.some((s) => s.includes("50,000"))).toBe(false);
  });
});
