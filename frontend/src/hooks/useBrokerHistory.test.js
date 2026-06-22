/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrokerHistory } from "./useBrokerHistory";
import { api } from "../lib/api";
beforeEach(() => {
    vi.restoreAllMocks();
});
const mkPayload = (brokers) => ({
    symbol: "2330", fetched_at: "", last_date: "2026-06-22", brokers,
});
describe("useBrokerHistory", () => {
    it("does not fetch when brokerIds is empty", async () => {
        const spy = vi.spyOn(api, "chipBrokerHistory");
        const { result } = renderHook(() => useBrokerHistory("2330", new Set()));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(spy).not.toHaveBeenCalled();
        expect(result.current.series.size).toBe(0);
    });
    it("fetches on first selection", async () => {
        vi.spyOn(api, "chipBrokerHistory").mockResolvedValueOnce(mkPayload({ A: [{ date: "2026-06-20", buy: 5, sell: 0, net: 5 }] }));
        const { result, rerender } = renderHook(({ ids }) => useBrokerHistory("2330", ids), { initialProps: { ids: new Set() } });
        rerender({ ids: new Set(["A"]) });
        await waitFor(() => expect(result.current.series.has("A")).toBe(true));
        expect(result.current.series.get("A")?.[0].net).toBe(5);
    });
    it("does not re-fetch already cached ids", async () => {
        const spy = vi.spyOn(api, "chipBrokerHistory").mockResolvedValue(mkPayload({ A: [{ date: "2026-06-20", buy: 5, sell: 0, net: 5 }] }));
        const { result, rerender } = renderHook(({ ids }) => useBrokerHistory("2330", ids), { initialProps: { ids: new Set(["A"]) } });
        await waitFor(() => expect(result.current.series.has("A")).toBe(true));
        rerender({ ids: new Set(["A"]) });
        rerender({ ids: new Set(["A"]) });
        expect(spy).toHaveBeenCalledTimes(1);
    });
    it("batches missing ids into a single request", async () => {
        const spy = vi.spyOn(api, "chipBrokerHistory").mockResolvedValue(mkPayload({
            A: [{ date: "d", buy: 1, sell: 0, net: 1 }],
            B: [{ date: "d", buy: 2, sell: 0, net: 2 }],
        }));
        const { result, rerender } = renderHook(({ ids }) => useBrokerHistory("2330", ids), { initialProps: { ids: new Set() } });
        rerender({ ids: new Set(["A", "B"]) });
        await waitFor(() => expect(result.current.series.has("A") && result.current.series.has("B")).toBe(true));
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1].slice().sort()).toEqual(["A", "B"]);
    });
    it("clears cache when symbol changes", async () => {
        vi.spyOn(api, "chipBrokerHistory")
            .mockResolvedValueOnce(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }))
            .mockResolvedValueOnce(mkPayload({ A: [{ date: "d", buy: 9, sell: 0, net: 9 }] }));
        const { result, rerender } = renderHook(({ symbol, ids }) => useBrokerHistory(symbol, ids), { initialProps: { symbol: "2330", ids: new Set(["A"]) } });
        await waitFor(() => expect(result.current.series.get("A")?.[0].net).toBe(1));
        rerender({ symbol: "2454", ids: new Set(["A"]) });
        await waitFor(() => expect(result.current.series.get("A")?.[0].net).toBe(9));
    });
    it("sets error state on API failure and preserves cache", async () => {
        vi.spyOn(api, "chipBrokerHistory")
            .mockResolvedValueOnce(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }))
            .mockRejectedValueOnce(new Error("network"));
        const { result, rerender } = renderHook(({ ids }) => useBrokerHistory("2330", ids), { initialProps: { ids: new Set(["A"]) } });
        await waitFor(() => expect(result.current.series.has("A")).toBe(true));
        rerender({ ids: new Set(["A", "B"]) });
        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.series.has("A")).toBe(true);
    });
    it("refresh re-fetches with refresh=true", async () => {
        const spy = vi.spyOn(api, "chipBrokerHistory").mockResolvedValue(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }));
        const { result } = renderHook(() => useBrokerHistory("2330", new Set(["A"])));
        await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        act(() => result.current.refresh());
        await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
        expect(spy.mock.calls[1][2]).toBe(true);
    });
    it("ignores stale responses via seqRef", async () => {
        let resolveFirst;
        const firstPromise = new Promise((r) => { resolveFirst = r; });
        vi.spyOn(api, "chipBrokerHistory")
            .mockImplementationOnce(() => firstPromise)
            .mockResolvedValueOnce(mkPayload({ B: [{ date: "d", buy: 9, sell: 0, net: 9 }] }));
        const { result, rerender } = renderHook(({ ids }) => useBrokerHistory("2330", ids), { initialProps: { ids: new Set(["A"]) } });
        rerender({ ids: new Set(["B"]) });
        await waitFor(() => expect(result.current.series.has("B")).toBe(true));
        resolveFirst(mkPayload({ A: [{ date: "d", buy: 1, sell: 0, net: 1 }] }));
        await new Promise((r) => setTimeout(r, 30));
        expect(result.current.series.has("A")).toBe(false);
        expect(result.current.series.get("B")?.[0].net).toBe(9);
    });
});
