/**
 * @vitest-environment jsdom
 *
 * useWarrantIvHistory — row 展開才抓(SC-7 lazy 單發,樣板 useWarrantBrokers)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantIvHistoryPayload } from "../lib/warrant-data";
import { useWarrantIvHistory } from "./useWarrantIvHistory";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantIvHistoryPayload>): WarrantIvHistoryPayload => ({
  warrant_id: "030012",
  terms_approx_dates: [],
  series: [
    { date: "2026-07-08", iv_bid: 0.42, iv_ask: 0.46 },
    { date: "2026-07-09", iv_bid: 0.41, iv_ask: 0.45 },
  ],
  drift: { label: "declining", slope_bid: -0.002, slope_ask: -0.001, n_valid: 55 },
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useWarrantIvHistory", () => {
  it("warrantId=null 不 fetch(未展開)", () => {
    const spy = vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    renderHook(() => useWarrantIvHistory(null), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("展開後單發抓 + 暴露 payload", async () => {
    const spy = vi.spyOn(api, "warrantIvHistory").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantIvHistory("030012"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.data?.drift.label).toBe("declining");
    expect(result.current.data?.series).toHaveLength(2);
  });

  it("API 失敗 → error 終態(繁中訊息由 api 層轉譯)", async () => {
    vi.spyOn(api, "warrantIvHistory").mockRejectedValue(new Error("上游資料源異常"));
    const { result } = renderHook(() => useWarrantIvHistory("030012"), {
      wrapper: makeQueryWrapper(),
    });
    // TanStack v5 retry backoff:waitFor 需放寬 timeout(frontend-testing)
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toBe("上游資料源異常");
    expect(result.current.loading).toBe(false);
  });
});
