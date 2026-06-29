/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarketSnapshot } from "./market-api";

afterEach(() => vi.restoreAllMocks());

describe("fetchMarketSnapshot", () => {
  it("hits /api/market/snapshot without refresh param when refresh=false", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ stub: 1 }), { status: 200 }),
    );
    await fetchMarketSnapshot(false);
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/market/snapshot");
    expect(url).not.toContain("refresh=true");
  });

  it("adds refresh=true to URL when refresh=true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ stub: 1 }), { status: 200 }),
    );
    await fetchMarketSnapshot(true);
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("refresh=true");
  });

  it("throws with detail.error message on 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { error: "finmind_unreachable" } }),
        { status: 502 },
      ),
    );
    await expect(fetchMarketSnapshot(false)).rejects.toThrow("finmind_unreachable");
  });

  it("throws with generic HTTP message when body has no detail.error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("oops", { status: 500 }),
    );
    await expect(fetchMarketSnapshot(false)).rejects.toThrow(/HTTP 500/);
  });
});
