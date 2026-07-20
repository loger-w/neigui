/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarketSnapshot, fetchSectorMembers } from "./market-api";

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

describe("fetchSectorMembers", () => {
  it("hits /api/market/sector_members with industry param only when sub_industry omitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ industry: "半導體業", sub_industry: null, members: [] }), {
        status: 200,
      }),
    );
    await fetchSectorMembers("半導體業", null);
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/market/sector_members");
    expect(url).toContain("industry=");
    expect(url).not.toContain("sub_industry=");
  });

  it("adds sub_industry param when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ industry: "半導體業", sub_industry: "IC設計", members: [] }), {
        status: 200,
      }),
    );
    await fetchSectorMembers("半導體業", "IC設計");
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("sub_industry=");
  });

  it("throws with detail.error message on 404 unknown_sector", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: { error: "unknown_sector" } }), { status: 404 }),
    );
    await expect(fetchSectorMembers("不存在", null)).rejects.toThrow("unknown_sector");
  });

  it("throws with generic HTTP message when body has no detail.error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 500 }));
    await expect(fetchSectorMembers("半導體業", null)).rejects.toThrow(/HTTP 500/);
  });
});
