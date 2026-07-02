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

function mockFetch(data: unknown) {
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
    entry!.ts -= CACHE_TTL + 1;

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
    expect(cached!.data).toEqual(MOCK_HISTORY);
  });

  it("chipIntraday URL contains date + refresh", async () => {
    const fetchMock = mockFetch({
      symbol: "2330", date: "2026-06-26", fetched_at: "", points: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.chipIntraday("2330", "2026-06-26", true);
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("/api/chip/2330/intraday");
    expect(url).toContain("date=2026-06-26");
    expect(url).toContain("refresh=true");
  });

  it("chipIntraday URL omits refresh when not given", async () => {
    const fetchMock = mockFetch({
      symbol: "2330", date: "2026-06-26", fetched_at: "", points: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.chipIntraday("2330", "2026-06-26");
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("/api/chip/2330/intraday");
    expect(url).toContain("date=2026-06-26");
    expect(url).not.toContain("refresh=");
  });

  it("chipBrokerHistory builds URL with comma-joined ids and refresh", async () => {
    const fetchMock = mockFetch({
      symbol: "2330", fetched_at: "", last_date: "", brokers: {},
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.chipBrokerHistory("2330", ["A", "B"], true);
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("/api/chip/2330/broker_history");
    expect(url).toContain("ids=A%2CB");
    expect(url).toContain("refresh=true");
  });

  it("chipHistory 帶 days 時 URL 含 ?days=60;不帶時不含 days", async () => {
    const fetchMock = mockFetch(MOCK_HISTORY);
    vi.stubGlobal("fetch", fetchMock);

    await api.chipHistory("2330", 60);
    let url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("days=60");

    clearApiCache();
    await api.chipHistory("2454");
    url = (fetchMock.mock.calls[1]![0] as URL).toString();
    expect(url).not.toContain("days=");
  });

  it("chipHistory(symbol, days, true) 三參形式 URL 同時帶 days + refresh", async () => {
    const fetchMock = mockFetch(MOCK_HISTORY);
    vi.stubGlobal("fetch", fetchMock);

    await api.chipHistory("2330", 180, true);
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("days=180");
    expect(url).toContain("refresh=true");
  });

  it("chipBrokerHistory 帶 days 時 URL 含 ?days=20", async () => {
    const fetchMock = mockFetch({
      symbol: "2330", fetched_at: "", last_date: "", brokers: {},
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.chipBrokerHistory("2330", ["A"], 20);
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("days=20");
    expect(url).toContain("ids=A");
  });

  it("different symbols have different cache keys", async () => {
    const fetchMock = mockFetch(MOCK_HISTORY);
    vi.stubGlobal("fetch", fetchMock);

    await api.chipHistory("2330");
    await api.chipHistory("2454");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__testCache.size).toBe(2);
  });

  it("chipBrokersWindow URL contains date + days + refresh", async () => {
    const fetchMock = mockFetch({
      symbol: "2330", date: "2026-06-19", window_days: 30,
      trading_dates: [], actual_days: 0, fetched_at: "",
      top_brokers: [], margin: {}, institutional: {}, total_traded_lots: 0,
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.chipBrokersWindow("2330", "2026-06-19", 30, true);
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("/api/chip/2330/brokers_window");
    expect(url).toContain("date=2026-06-19");
    expect(url).toContain("days=30");
    expect(url).toContain("refresh=true");
  });

  it("chipBrokersWindow URL omits refresh when not given", async () => {
    const fetchMock = mockFetch({
      symbol: "2330", date: "2026-06-19", window_days: 10,
      trading_dates: [], actual_days: 0, fetched_at: "",
      top_brokers: [], margin: {}, institutional: {}, total_traded_lots: 0,
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.chipBrokersWindow("2330", "2026-06-19", 10);
    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain("days=10");
    expect(url).not.toContain("refresh=");
  });

  it("clearApiCache empties the cache", async () => {
    const fetchMock = mockFetch(MOCK_HISTORY);
    vi.stubGlobal("fetch", fetchMock);

    await api.chipHistory("2330");
    expect(__testCache.size).toBe(1);

    clearApiCache();
    expect(__testCache.size).toBe(0);
  });

  // Signal forwarding — S1 perf gate。TanStack Query queryFn({ signal }) 傳導
  // 到 fetch,切股票/切 mode 時舊 request 立刻 abort;否則舊 24s cold
  // history/major 會跑完佔 rate slot 阻塞新 symbol。
  it("forwards options.signal to fetch", async () => {
    const fetchMock = mockFetch(MOCK_HISTORY);
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await api.chipHistoryMajor("2330", 540, false, { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const initArg = fetchMock.mock.calls[0]![1];
    expect(initArg).toEqual(expect.objectContaining({ signal: controller.signal }));
  });

  it("aborted signal rejects with AbortError before response", async () => {
    // fetch 收到 aborted signal 應 throw DOMException("AbortError"),不寫 cache。
    // 用 mock 模擬 fetch 對 abort signal 的反應。
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const promise = api.chipHistoryMajor("2330", 540, false, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(/aborted/i);
    // Cache 不應被 aborted response 汙染
    expect(__testCache.size).toBe(0);
  });
});
