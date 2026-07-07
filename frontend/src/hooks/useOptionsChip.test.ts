/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsChip } from "./useOptionsChip";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

// 痛點:options-page-v2 impl-review R2 — useOptionsChip 聚合擴充 retail / ff
// 後,refreshAll 必須帶到新 hook(cascade invalidateQueries 不帶 refresh=true,
// finmind-conventions 明載),anyNoTradingDay 也要涵蓋新資料源。

function mockAllApis() {
  vi.spyOn(optionsApi, "maxPain").mockResolvedValue({ as_of_date: "2026-06-26" } as never);
  vi.spyOn(optionsApi, "oiWalls").mockResolvedValue({ as_of_date: "2026-06-26" } as never);
  vi.spyOn(optionsApi, "pcr").mockResolvedValue({ as_of_date: "2026-06-26" } as never);
  vi.spyOn(optionsApi, "institutional").mockResolvedValue({ as_of_date: "2026-06-26" } as never);
  return {
    retail: vi.spyOn(optionsApi, "retailMtx").mockResolvedValue({
      as_of_date: "2026-06-26",
    } as never),
    ff: vi.spyOn(optionsApi, "foreignFutures").mockResolvedValue({
      as_of_date: "2026-06-26",
    } as never),
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsChip 聚合擴充", () => {
  it("exposes retail + ff and refreshAll hits both with refresh=true", async () => {
    const spies = mockAllApis();
    const { result } = renderHook(
      () => useOptionsChip("TXO202607", "2026-06-26"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.retail.data).not.toBeNull());
    await waitFor(() => expect(result.current.ff.data).not.toBeNull());
    result.current.refreshAll();
    await waitFor(() => expect(spies.retail.mock.calls.at(-1)?.[1]).toBe(true));
    await waitFor(() => expect(spies.ff.mock.calls.at(-1)?.[1]).toBe(true));
  });

  it("anyNoTradingDay covers retail source", async () => {
    mockAllApis();
    vi.spyOn(optionsApi, "retailMtx").mockResolvedValue({
      as_of_date: "2026-06-27", no_trading_day: true,
    } as never);
    const { result } = renderHook(
      () => useOptionsChip("TXO202607", "2026-06-28"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.anyNoTradingDay).toBe(true));
  });
});
