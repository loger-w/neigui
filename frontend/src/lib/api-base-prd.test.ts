/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://neigui.vercel.app/"}
 *
 * 重現 prd bug 條件:在 prd 域名下,api client 若仍打同源,請求會進
 * Vercel rewrite — rewrite 不轉發 client abort,backend fan-out 變殭屍
 * 燒完配額(current-state.md P2/P3 probe 實證)。此檔鎖「prd 域名下
 * 兩個 URL 組裝點都直連 Railway」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, clearApiCache } from "./api";
import { fetchMarketSnapshot } from "./market-api";
import { RAILWAY_ORIGIN } from "./api-base";

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

describe("prd 域名下 API 直連 Railway", () => {
  it("api.get 系列以 Railway 為 origin", async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await api.symbols("2330");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(new URL(url).origin).toBe(RAILWAY_ORIGIN);
    expect(new URL(url).pathname).toBe("/api/symbols");
  });

  it("fetchMarketSnapshot 以 Railway 為 origin", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    await fetchMarketSnapshot(false);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(new URL(url).origin).toBe(RAILWAY_ORIGIN);
    expect(new URL(url).pathname).toBe("/api/market/snapshot");
  });
});
