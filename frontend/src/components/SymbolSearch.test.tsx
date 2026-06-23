/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act, cleanup } from "@testing-library/react";
import { SymbolSearch } from "./SymbolSearch";
import { api } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers();
});

type Sym = { symbol: string; name: string };

describe("SymbolSearch", () => {
  it("ignores a stale response that resolves AFTER a newer query's response", async () => {
    // Two controllable promises — we choose resolve order
    let resolve23!: (v: Sym[]) => void;
    let resolve2330!: (v: Sym[]) => void;
    const p23 = new Promise<Sym[]>((r) => { resolve23 = r; });
    const p2330 = new Promise<Sym[]>((r) => { resolve2330 = r; });

    const spy = vi.spyOn(api, "symbols").mockImplementation((q: string) => {
      if (q === "23") return p23;
      if (q === "2330") return p2330;
      return Promise.resolve([]);
    });

    render(<SymbolSearch onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);

    // Type "23" -> fire debounce -> request for "23" goes out
    fireEvent.change(input, { target: { value: "23" } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(spy).toHaveBeenCalledWith("23");

    // Type "2330" -> fire debounce -> request for "2330" goes out
    fireEvent.change(input, { target: { value: "2330" } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(spy).toHaveBeenCalledWith("2330");

    // The newer request ("2330") resolves FIRST with a single hit
    await act(async () => {
      resolve2330([{ symbol: "2330", name: "台積電" }]);
      await Promise.resolve();
    });
    expect(screen.getByText("台積電")).toBeTruthy();

    // Then the OLDER stale request ("23") resolves with a 23xx list.
    // It must NOT overwrite the newer result.
    await act(async () => {
      resolve23([
        { symbol: "2301", name: "東元" },
        { symbol: "2308", name: "台達電" },
        { symbol: "2330", name: "台積電" },
      ]);
      await Promise.resolve();
    });

    // The dropdown should still reflect the LATEST query "2330" only.
    // 東元 / 台達電 only exist in the stale response, so seeing them = bug.
    expect(screen.queryByText("東元")).toBeNull();
    expect(screen.queryByText("台達電")).toBeNull();
    expect(screen.getByText("台積電")).toBeTruthy();
  });

  it("debounces fast typing so only the final query is sent", async () => {
    const spy = vi.spyOn(api, "symbols").mockResolvedValue([]);

    render(<SymbolSearch onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);

    fireEvent.change(input, { target: { value: "2" } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(input, { target: { value: "23" } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(input, { target: { value: "233" } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(input, { target: { value: "2330" } });
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("2330");
  });

  it("closes dropdown and clears results when query is emptied", async () => {
    vi.spyOn(api, "symbols").mockResolvedValue([
      { symbol: "2330", name: "台積電" },
    ]);

    render(<SymbolSearch onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);

    fireEvent.change(input, { target: { value: "2330" } });
    await act(async () => { vi.advanceTimersByTime(200); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("台積電")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("台積電")).toBeNull();
  });
});
