/**
 * @vitest-environment jsdom
 *
 * SC-4(mod/kline-date-bubble-days-ux):多日泡泡圖每欄的每日開 / 收標示。
 * 幾何全在純函式 layoutDayMarks,render 層只負責把 slot 畫出來 —— 座標判定
 * 不靠 querySelector 取屬性反推。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CHIP } from "./chip-theme";
import type { DailyCandle } from "./chip-data";
import {
  DayMarksLayer, formatDayMarkLabel, layoutDayMarks, type DayMarksLayerProps,
} from "./chip-bubble-daymarks-svg";

afterEach(() => cleanup());

const mkCandle = (
  date: string, open: number, close: number,
): DailyCandle => ({
  date, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000,
});

// yLow 90 / yHigh 110 / paddingTop 10 / chartHeight 200
//   → y(price) = 10 + ((110 - price) / 20) * 200 = 10 + (110 - price) * 10
const base = {
  yLow: 90,
  yHigh: 110,
  paddingLeft: 56,
  paddingTop: 10,
  chartWidth: 500,
  chartHeight: 200,
};
const yOf = (price: number): number => 10 + (110 - price) * 10;

const dates5 = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"];
const full5: DailyCandle[] = [
  mkCandle("2026-06-22", 100, 105),
  mkCandle("2026-06-23", 105, 101),
  mkCandle("2026-06-24", 101, 101),
  mkCandle("2026-06-25", 101, 103),
  mkCandle("2026-06-26", 103, 99),
];

describe("layoutDayMarks — 槽位幾何", () => {
  it("N 個 trading_dates → N 欄,x 為欄中心、slotW = chartWidth / N", () => {
    const slots = layoutDayMarks({ ...base, dates: dates5, candles: full5 });
    expect(slots).toHaveLength(5);
    for (const [i, s] of slots.entries()) {
      expect(s.slotW).toBe(100);
      expect(s.x).toBe(56 + 100 * i + 50);
      expect(s.date).toBe(dates5[i]);
    }
  });

  it("開 / 收 y 用與泡泡同一條 price scale", () => {
    const slots = layoutDayMarks({ ...base, dates: dates5, candles: full5 });
    expect(slots[0]!.openY).toBeCloseTo(yOf(100), 6);
    expect(slots[0]!.closeY).toBeCloseTo(yOf(105), 6);
    expect(slots[0]!.oob).toBe(false);
  });

  it("5 日僅 4 日有 candle → 仍 5 欄,缺的那欄 candle=null 且其餘欄 x 不變(edge 1)", () => {
    const missing = full5.filter((c) => c.date !== "2026-06-24");
    const withAll = layoutDayMarks({ ...base, dates: dates5, candles: full5 });
    const slots = layoutDayMarks({ ...base, dates: dates5, candles: missing });
    expect(slots).toHaveLength(5);
    expect(slots[2]!.candle).toBeNull();
    expect(slots[2]!.openY).toBeNull();
    expect(slots[2]!.closeY).toBeNull();
    expect(slots[2]!.dir).toBeNull();
    // 缺 candle ≠ 越界:oob 專指開 / 收落在 yLow..yHigh 外
    expect(slots[2]!.oob).toBe(false);
    // 日期仍要標
    expect(slots[2]!.showDate).toBe(true);
    expect(slots[2]!.label).toBe("6/24");
    expect(slots.map((s) => s.x)).toEqual(withAll.map((s) => s.x));
  });

  it("開或收越界(yLow..yHigh 外)→ oob=true 且 openY / closeY / dir 皆 null(edge 4)", () => {
    const slots = layoutDayMarks({
      ...base,
      dates: ["2026-06-22", "2026-06-23", "2026-06-24"],
      candles: [
        mkCandle("2026-06-22", 100, 200), // 收越上界
        mkCandle("2026-06-23", 50, 100),  // 開越下界
        mkCandle("2026-06-24", 100, 102), // 界內
      ],
    });
    expect(slots[0]!.oob).toBe(true);
    expect(slots[0]!.openY).toBeNull();
    expect(slots[0]!.closeY).toBeNull();
    expect(slots[0]!.dir).toBeNull();
    expect(slots[1]!.oob).toBe(true);
    expect(slots[1]!.openY).toBeNull();
    expect(slots[2]!.oob).toBe(false);
    expect(slots[2]!.openY).not.toBeNull();
  });

  it("dir:收>開 up、收<開 down、相等 flat(edge 3)", () => {
    const slots = layoutDayMarks({ ...base, dates: dates5, candles: full5 });
    expect(slots[0]!.dir).toBe("up");
    expect(slots[1]!.dir).toBe("down");
    expect(slots[2]!.dir).toBe("flat");
  });

  it("dates 為空 → 空陣列", () => {
    expect(layoutDayMarks({ ...base, dates: [], candles: full5 })).toEqual([]);
  });
});

describe("layoutDayMarks — 標籤分級(SC-4 三態)", () => {
  const tierAt = (slotW: number, n: number = 1): string => {
    const slots = layoutDayMarks({
      ...base,
      chartWidth: slotW * n,
      dates: dates5.slice(0, n),
      candles: full5,
    });
    return slots[0]!.labelMode;
  };

  it("欄寬 120(≥96)→ beside(開 / 收貼在各自 y 兩側)", () => {
    expect(tierAt(120)).toBe("beside");
  });

  it("欄寬 60(50–96)→ stacked(堆疊在底部日期上方)", () => {
    expect(tierAt(60)).toBe("stacked");
  });

  it("欄寬 30(<50)→ none(只畫 K 身 + 稀疏日期,edge 2)", () => {
    expect(tierAt(30)).toBe("none");
  });

  it("邊界:96 → beside、95.9 → stacked、50 → stacked、49.9 → none", () => {
    expect(tierAt(96)).toBe("beside");
    expect(tierAt(95.9)).toBe("stacked");
    expect(tierAt(50)).toBe("stacked");
    expect(tierAt(49.9)).toBe("none");
  });
});

describe("layoutDayMarks — showDate 稀疏步長", () => {
  const dates10 = Array.from({ length: 10 }, (_, i) => `2026-06-${String(i + 10)}`);

  it("欄寬 ≥ 50 → 每欄都標日期(k=1)", () => {
    const slots = layoutDayMarks({
      ...base, chartWidth: 600, dates: dates10, candles: [],
    });
    expect(slots.every((s) => s.showDate)).toBe(true);
  });

  it("欄寬 30 → k = ceil(50/30) = 2,標 index 0,2,4…", () => {
    const slots = layoutDayMarks({
      ...base, chartWidth: 300, dates: dates10, candles: [],
    });
    expect(slots.map((s) => s.showDate)).toEqual([
      true, false, true, false, true, false, true, false, true, false,
    ]);
  });

  it("欄寬 12 → k = ceil(50/12) = 5,首欄必標", () => {
    const slots = layoutDayMarks({
      ...base, chartWidth: 120, dates: dates10, candles: [],
    });
    expect(slots[0]!.showDate).toBe(true);
    expect(slots.filter((s) => s.showDate)).toHaveLength(2);
  });
});

describe("formatDayMarkLabel", () => {
  it("YYYY-MM-DD → M/D(去前導零)", () => {
    expect(formatDayMarkLabel("2026-06-26")).toBe("6/26");
    expect(formatDayMarkLabel("2026-01-05")).toBe("1/5");
    expect(formatDayMarkLabel("2026-12-31")).toBe("12/31");
  });
});

describe("DayMarksLayer — render", () => {
  const renderLayer = (
    over: Partial<DayMarksLayerProps> = {},
  ) =>
    render(
      <svg>
        <DayMarksLayer
          dates={dates5}
          candles={full5}
          height={300}
          paddingBottom={32}
          {...base}
          {...over}
        />
      </svg>,
    );

  it("外層 group 帶 testid 與 pointer-events none(背景層不擋 hit test)", () => {
    const { container } = renderLayer();
    const g = container.querySelector('[data-testid="bubble-day-marks"]');
    expect(g).not.toBeNull();
    expect(g!.getAttribute("pointer-events")).toBe("none");
  });

  it("每欄一個 <g data-date>,並帶 data-oob 標記", () => {
    const { container } = renderLayer();
    const groups = container.querySelectorAll("[data-date]");
    expect(groups).toHaveLength(5);
    expect(Array.from(groups).map((g) => g.getAttribute("data-date"))).toEqual(dates5);
    expect(Array.from(groups).every((g) => g.getAttribute("data-oob") === "false")).toBe(true);
  });

  it("越界欄:data-oob=true、只有日期文字,無 K 身 rect 也無價格標籤", () => {
    const { container } = renderLayer({
      dates: ["2026-06-22"],
      candles: [mkCandle("2026-06-22", 100, 200)],
      chartWidth: 500,
    });
    const g = container.querySelector("[data-date]")!;
    expect(g.getAttribute("data-oob")).toBe("true");
    expect(g.querySelectorAll("rect")).toHaveLength(0);
    expect(g.querySelectorAll("line")).toHaveLength(0);
    const texts = Array.from(g.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toEqual(["6/22"]);
  });

  it("缺 candle 的欄:只有日期文字,不畫 K 身", () => {
    const { container } = renderLayer({
      dates: ["2026-06-22"], candles: [], chartWidth: 500,
    });
    const g = container.querySelector("[data-date]")!;
    expect(g.getAttribute("data-oob")).toBe("false");
    expect(g.querySelectorAll("rect")).toHaveLength(0);
    expect(Array.from(g.querySelectorAll("text")).map((t) => t.textContent)).toEqual(["6/22"]);
  });

  it("日期文字置底(y = height − paddingBottom − 4)、置中、ink-dim", () => {
    const { container } = renderLayer({ dates: ["2026-06-22"], chartWidth: 500 });
    const t = Array.from(container.querySelectorAll("[data-date] text"))
      .find((el) => /^\d+\/\d+$/.test(el.textContent ?? ""))!;
    expect(t.getAttribute("y")).toBe(String(300 - 32 - 4));
    expect(t.getAttribute("x")).toBe("306"); // 56 + 500/2
    expect(t.getAttribute("text-anchor")).toBe("middle");
    expect(t.getAttribute("fill")).toBe(CHIP.inkDim);
    expect(t.getAttribute("font-size")).toBe("0.6875rem");
  });

  it("漲 / 跌 / 平 K 身色:bull 紅 / bear 綠 / ink-dim,opacity 0.6", () => {
    const { container } = renderLayer({
      dates: ["2026-06-22", "2026-06-23", "2026-06-24"],
      chartWidth: 300,
    });
    const rects = container.querySelectorAll("[data-date] rect");
    expect(rects).toHaveLength(3);
    expect(rects[0]!.getAttribute("fill")).toBe(CHIP.bull);
    expect(rects[1]!.getAttribute("fill")).toBe(CHIP.bear);
    expect(rects[2]!.getAttribute("fill")).toBe(CHIP.inkDim);
    expect(rects[0]!.getAttribute("opacity")).toBe("0.6");
  });

  it("K 身涵蓋 open→close,寬度 ≤ 10px;平盤退化為 1px", () => {
    const { container } = renderLayer({
      dates: ["2026-06-22", "2026-06-24"], chartWidth: 300,
    });
    const rects = container.querySelectorAll("[data-date] rect");
    // 6/22:open 100 (y=110) → close 105 (y=60)
    expect(Number(rects[0]!.getAttribute("y"))).toBeCloseTo(60, 6);
    expect(Number(rects[0]!.getAttribute("height"))).toBeCloseTo(50, 6);
    expect(Number(rects[0]!.getAttribute("width"))).toBeLessThanOrEqual(10);
    // 6/24:open == close → 1px 橫線
    expect(Number(rects[1]!.getAttribute("height"))).toBe(1);
  });

  it("beside 分級:開標籤靠右對齊在左、收標籤靠左對齊在右", () => {
    const { container } = renderLayer({
      dates: ["2026-06-22"], chartWidth: 500,
    });
    const texts = Array.from(container.querySelectorAll("[data-date] text"));
    const open = texts.find((t) => (t.textContent ?? "").startsWith("開"))!;
    const close = texts.find((t) => (t.textContent ?? "").startsWith("收"))!;
    // 價格格式沿用 K 線 fmtPrice 規則(≥100 取整、≥10 一位、其餘兩位)
    expect(open.textContent).toBe("開 100");
    expect(close.textContent).toBe("收 105");
    expect(open.getAttribute("text-anchor")).toBe("end");
    expect(close.getAttribute("text-anchor")).toBe("start");
    expect(Number(open.getAttribute("x"))).toBeLessThan(306);
    expect(Number(close.getAttribute("x"))).toBeGreaterThan(306);
    expect(Number(open.getAttribute("y"))).toBeCloseTo(yOf(100) + 3, 6);
    expect(Number(close.getAttribute("y"))).toBeCloseTo(yOf(105) + 3, 6);
    expect(open.getAttribute("fill")).toBe(CHIP.inkMuted);
  });

  it("stacked 分級:兩個價格標籤置中堆在底部日期上方", () => {
    const { container } = renderLayer({
      dates: ["2026-06-22"], chartWidth: 60,
    });
    const texts = Array.from(container.querySelectorAll("[data-date] text"));
    const open = texts.find((t) => (t.textContent ?? "").startsWith("開"))!;
    const close = texts.find((t) => (t.textContent ?? "").startsWith("收"))!;
    const dateY = 300 - 32 - 4;
    expect(close.getAttribute("y")).toBe(String(dateY - 14));
    expect(open.getAttribute("y")).toBe(String(dateY - 26));
    expect(open.getAttribute("text-anchor")).toBe("middle");
    expect(close.getAttribute("text-anchor")).toBe("middle");
  });

  it("none 分級:只有 K 身 + 稀疏日期,無價格標籤(edge 2)", () => {
    const { container } = renderLayer({
      dates: dates5, chartWidth: 150, // slotW 30 → none + k=2
    });
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts.some((t) => t.startsWith("開") || t.startsWith("收"))).toBe(false);
    expect(texts).toEqual(["6/22", "6/24", "6/26"]);
    expect(container.querySelectorAll("[data-date] rect")).toHaveLength(5);
  });
});
