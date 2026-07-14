/**
 * @vitest-environment jsdom
 *
 * useIssuerRank — 面板展開才抓(SC-5 enabled gate);排行為全市場資料,
 * queryKey 不含 stockId。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { IssuerRankPayload } from "../lib/warrant-data";
import { useIssuerRank } from "./useIssuerRank";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<IssuerRankPayload>): IssuerRankPayload => ({
  as_of_date: "2026-07-10",
  built_from_days: 10,
  n_strata_total: 9,
  issuers: [
    {
      issuer_id: "9800",
      issuer_name: "元大",
      n_warrants: 120,
      n_scored: 95,
      iv_std_median: 0.008,
      spread_median: 0.021,
      declining_share: 0.05,
      iv_score: 0.25,
      spread_score: 0.31,
      declining_score: 0.42,
      n_strata: 8,
      composite: 0.12,
      rank: 1,
      tier: "front",
    },
  ],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useIssuerRank", () => {
  it("enabled=false 不 fetch(面板收合不發請求)", () => {
    const spy = vi.spyOn(api, "issuerRank").mockResolvedValue(mk());
    renderHook(() => useIssuerRank(false), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("enabled 轉 true 才 fetch,並暴露 data", async () => {
    const spy = vi.spyOn(api, "issuerRank").mockResolvedValue(mk());
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useIssuerRank(enabled),
      { wrapper: makeQueryWrapper(), initialProps: { enabled: false } },
    );
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.data?.issuers[0]?.issuer_name).toBe("元大");
  });

  it("refresh() 帶 force=true 重抓", async () => {
    const spy = vi.spyOn(api, "issuerRank").mockResolvedValue(mk());
    const { result } = renderHook(() => useIssuerRank(true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    result.current.refresh();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[0]).toBe(true);
  });

  it("error 終態暴露 message(TanStack retry backoff → waitFor 5s)", async () => {
    vi.spyOn(api, "issuerRank").mockRejectedValue(new Error("伺服器暫時無法回應"));
    const { result } = renderHook(() => useIssuerRank(true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toBe("伺服器暫時無法回應");
    expect(result.current.loading).toBe(false);
  });
});
