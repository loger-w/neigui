/**
 * @vitest-environment jsdom
 *
 * useTraderSearch — 分點目錄搜尋 hook(enabled gate / error 終態 / refresh,
 * review P2SUM-3 補鎖)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import { useTraderSearch } from "./useTraderSearch";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const HITS = { hits: [{ broker_id: "9600", broker_name: "富邦" }], total: 1 };

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useTraderSearch", () => {
  it("q 空字串 → 不 fetch", () => {
    const spy = vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    renderHook(() => useTraderSearch(""), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("q 非空 → 抓一次並暴露 data", async () => {
    const spy = vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    const { result } = renderHook(() => useTraderSearch("富邦"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.data?.[0]?.broker_id).toBe("9600");
  });

  it("API 失敗 → error 終態", async () => {
    vi.spyOn(api, "brokerTraders").mockRejectedValue(new Error("broker_directory_unavailable"));
    const { result } = renderHook(() => useTraderSearch("富邦"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toBe("broker_directory_unavailable");
  });

  it("refresh() 觸發第二次 fetch(R11 契約)", async () => {
    const spy = vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    const { result } = renderHook(() => useTraderSearch("富邦"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    result.current.refresh();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
