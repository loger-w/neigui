/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, __testCache, clearApiCache, CACHE_TTL, CACHE_MAX_ENTRIES } from "./api";
const MOCK_HISTORY = {
    symbol: "2330",
    fetched_at: "2026-06-19T20:15:00",
    last_date: "2026-06-19",
    candles: [],
    institutional: [],
    margin: [],
    major: [],
};
function mockFetch(data) {
    return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
    });
}
beforeEach(() => {
    clearApiCache();
});
afterEach(() => {
    vi.restoreAllMocks();
});
describe("api cache", () => {
    it("returns cached data on second call", async () => {
        const fetchMock = mockFetch(MOCK_HISTORY);
        vi.stubGlobal("fetch", fetchMock);
        const r1 = await api.chipHistory("2330");
        const r2 = await api.chipHistory("2330");
        expect(r1).toEqual(MOCK_HISTORY);
        expect(r2).toEqual(MOCK_HISTORY);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("bypasses cache when refresh=true", async () => {
        const fetchMock = mockFetch(MOCK_HISTORY);
        vi.stubGlobal("fetch", fetchMock);
        await api.chipHistory("2330");
        await api.chipHistory("2330", true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("refetches after TTL expires", async () => {
        const fetchMock = mockFetch(MOCK_HISTORY);
        vi.stubGlobal("fetch", fetchMock);
        await api.chipHistory("2330");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const entry = __testCache.get("/api/chip/2330/history");
        expect(entry).toBeDefined();
        entry.ts -= CACHE_TTL + 1;
        await api.chipHistory("2330");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("evicts oldest entry when exceeding max entries", async () => {
        const fetchMock = mockFetch({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        for (let i = 0; i <= CACHE_MAX_ENTRIES; i++) {
            await api.symbols(`search${i}`);
        }
        expect(__testCache.size).toBe(CACHE_MAX_ENTRIES);
    });
    it("cache key excludes refresh parameter", async () => {
        const fetchMock = mockFetch(MOCK_HISTORY);
        vi.stubGlobal("fetch", fetchMock);
        await api.chipHistory("2330", true);
        const cached = __testCache.get("/api/chip/2330/history");
        expect(cached).toBeDefined();
        expect(cached.data).toEqual(MOCK_HISTORY);
    });
    it("chipBrokerHistory builds URL with comma-joined ids and refresh", async () => {
        const fetchMock = mockFetch({
            symbol: "2330", fetched_at: "", last_date: "", brokers: {},
        });
        vi.stubGlobal("fetch", fetchMock);
        await api.chipBrokerHistory("2330", ["A", "B"], true);
        const url = fetchMock.mock.calls[0][0].toString();
        expect(url).toContain("/api/chip/2330/broker_history");
        expect(url).toContain("ids=A%2CB");
        expect(url).toContain("refresh=true");
    });
    it("different symbols have different cache keys", async () => {
        const fetchMock = mockFetch(MOCK_HISTORY);
        vi.stubGlobal("fetch", fetchMock);
        await api.chipHistory("2330");
        await api.chipHistory("2454");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(__testCache.size).toBe(2);
    });
    it("clearApiCache empties the cache", async () => {
        const fetchMock = mockFetch(MOCK_HISTORY);
        vi.stubGlobal("fetch", fetchMock);
        await api.chipHistory("2330");
        expect(__testCache.size).toBe(1);
        clearApiCache();
        expect(__testCache.size).toBe(0);
    });
});
