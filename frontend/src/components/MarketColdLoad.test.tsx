/** @vitest-environment jsdom */
// CR1-10 / CR1-11 regression 原鎖在 MarketBreadthPanel / MarketSectorBreadthHeatmap
// — 兩者隨 market-today-only change-spec.md §4(舊 EOD 四格退役)整檔刪除,
// import 已失效,先降到最小合法狀態(不留 import 已刪元件的死案例)。
//
// Commit 2(🟢 今日三卡實作)紅線(spec R11 — P0,不准最終遺漏):若新三卡
// (MarketIndexStrength / MarketCapTiers / MarketSectorRotation)中有任一張用
// useContainerSize + SVG,同型 cold-load regression(loading → data 後量到真實
// 寬度,ref 不得只掛在資料態分支)必須移植回這份檔案;若三卡最終皆純 DOM 無
// useContainerSize,Commit 2 要在檔頭記明理由,並改寫本檔為「loading → data
// 切換不 crash」的等價 regression(不可以空殼收尾)。
import { describe, expect, it } from "vitest";

describe("cold-load 量測 regression (CR1-10 / CR1-11) — 移植至 Commit 2", () => {
  it("placeholder:待 Commit 2 補回今日三卡的 cold-load regression", () => {
    expect(true).toBe(true);
  });
});
