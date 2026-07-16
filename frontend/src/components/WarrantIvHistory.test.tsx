/**
 * @vitest-environment jsdom
 *
 * WarrantIvHistory — 展開列 IV 歷史重設計(warrant-iv-redesign)。
 * Mock 走 vi.spyOn(api),不 mock hooks(frontend-testing 慣例)。
 * useContainerSize 走真 hook + RO polyfill + rect stub(MarketColdLoad 樣板),
 * 響應式 regression 直接鎖 svg width。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantIvHistoryPayload, WarrantIvPoint } from "../lib/warrant-data";
import { WarrantIvHistory } from "./WarrantIvHistory";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantIvHistoryPayload>): WarrantIvHistoryPayload => ({
  warrant_id: "030012",
  terms_approx_dates: [],
  series: [
    { date: "2026-07-07", iv_bid: 0.43, iv_ask: 0.47, underlying_close: 995.0 },
    { date: "2026-07-08", iv_bid: 0.42, iv_ask: 0.46, underlying_close: 1000.0 },
    { date: "2026-07-09", iv_bid: 0.41, iv_ask: 0.45, underlying_close: 1010.0 },
  ],
  drift: { label: "declining", slope_bid: -0.002, slope_ask: -0.001, n_valid: 25 },
  ...over,
});

/** 25 點常數收盤序列:HV20 可算(=0),用於 vs HV20 摘要項。 */
const longSeries = (): WarrantIvPoint[] =>
  Array.from({ length: 25 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    iv_bid: 0.41,
    iv_ask: 0.45,
    underlying_close: 1000.0,
  }));

let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
  rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  } as DOMRect);
});

afterEach(() => {
  rectSpy.mockRestore();
  cleanup();
});

describe("WarrantIvHistory", () => {
  it("loading 狀態(繁中)", () => {
    vi.spyOn(api, "warrantIvHistory").mockReturnValue(new Promise(() => {}));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    expect(screen.getByText("載入引波歷史...")).toBeTruthy();
  });

  it("error 狀態顯示訊息", async () => {
    vi.spyOn(api, "warrantIvHistory").mockRejectedValue(new Error("上游資料源異常"));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByText("上游資料源異常")).toBeTruthy(), {
      timeout: 5000,
    });
  });

  it("空序列 → 無歷史引波資料", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(
      mk({ series: [], drift: { label: "insufficient", slope_bid: null, slope_ask: null, n_valid: 0 } }),
    );
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByText("無歷史引波資料")).toBeTruthy());
  });

  it("正常渲染:雙 panel path + 圖例 + svg 寬跟容器(響應式 regression)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    const svg = screen.getByTestId("warrant-iv-chart");
    // 冷載入路徑:loading 態先 mount(恆存 wrapper 掛 ref),資料到位後量測已生效
    expect(svg.getAttribute("width")).toBe("800");
    const sides = svg.querySelectorAll("path[data-side]");
    expect(sides.length).toBe(2);
    for (const p of sides) expect(p.getAttribute("d")).toMatch(/^M/);
    const price = svg.querySelector('path[data-series="price"]');
    expect(price).toBeTruthy();
    expect(price!.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+L/);
    expect(screen.getByText("買價IV")).toBeTruthy();
    expect(screen.getByText("賣價IV")).toBeTruthy();
    expect(screen.getByText("HV20(標的)")).toBeTruthy();
    expect(screen.getByText("標的收盤")).toBeTruthy();
  });

  it("摘要列:最新買價IV / 自身位階 / 同標的位階(prop)/ drift 統計", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" ivPercentile={62} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(screen.getByText("41.0%")).toBeTruthy(); // 最新非 null iv_bid
    expect(screen.getByText("P33")).toBeTruthy(); // 0.41 是 3 值最低 → 33.3
    expect(screen.getByText("P62")).toBeTruthy(); // 表格傳入的同標的位階
    expect(screen.getByText(/長期遞減/)).toBeTruthy();
    expect(screen.getByText(/-0\.20 pp\/日/)).toBeTruthy(); // slope_bid −0.002 → −0.20
    expect(screen.getByText(/25 日/)).toBeTruthy();
  });

  it("ivPercentile 未傳 → 同標的位階顯示 —;HV 不足窗 → 不顯示 vs HV20 項", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(screen.getByText("同標的位階").nextElementSibling?.textContent).toBe("—");
    expect(screen.queryByText(/vs HV20/)).toBeNull(); // 3 點序列 HV 全 null
  });

  it("HV 可算時顯示 vs HV20 差距(pp)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk({ series: longSeries() }));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    // 常數收盤 HV20 = 0,最新 BIV 41% → +41.0 pp
    expect(screen.getByText(/vs HV20/)).toBeTruthy();
    expect(screen.getByText("+41.0 pp")).toBeTruthy();
  });

  it("declining 畫趨勢線;stable(slope null)不畫且文案無斜率", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    const { unmount } = render(<WarrantIvHistory warrantId="030012" />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(
      screen.getByTestId("warrant-iv-chart").querySelector('path[data-series="trend"]'),
    ).toBeTruthy();
    unmount();

    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(
      mk({ drift: { label: "stable", slope_bid: null, slope_ask: null, n_valid: 25 } }),
    );
    render(<WarrantIvHistory warrantId="030013" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(
      screen.getByTestId("warrant-iv-chart").querySelector('path[data-series="trend"]'),
    ).toBeNull();
    expect(screen.getByText(/平穩/)).toBeTruthy();
    expect(screen.queryByText(/pp\/日/)).toBeNull();
  });

  it("中性鐵則:無方向性/指控性文案,線不用 accent/bull/bear(SC-5)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" ivPercentile={88} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(screen.queryByText(/做多|做空|賣選|滿倉|惡意|坑殺/)).toBeNull();
    const paths = screen.getByTestId("warrant-iv-chart").querySelectorAll("path");
    for (const p of paths) {
      expect(p.getAttribute("class") ?? "").not.toMatch(/accent|bull|bear/);
    }
  });

  it("近似註記:terms_approx_dates 非空才顯示(edge 4)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk({ terms_approx_dates: ["2026-07-07"] }));
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() =>
      expect(screen.getByText("歷史 IV 以現行條款近似")).toBeTruthy(),
    );
  });

  it("無近似日不顯示註記", async () => {
    vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    render(<WarrantIvHistory warrantId="030012" />, { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(screen.getByTestId("warrant-iv-chart")).toBeTruthy());
    expect(screen.queryByText("歷史 IV 以現行條款近似")).toBeNull();
  });
});
