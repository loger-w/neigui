/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act, cleanup, waitFor } from "@testing-library/react";
import { SymbolSearch } from "./SymbolSearch";
import { api } from "@/lib/api";
import { makeQueryWrapper } from "@/test-utils/query-wrapper";

type Sym = { symbol: string; name: string };

const ALL: Sym[] = [
  { symbol: "2330", name: "台積電" },
  { symbol: "2317", name: "鴻海" },
  { symbol: "2308", name: "台達電" },
  { symbol: "2301", name: "光寶科" },
  { symbol: "2454", name: "聯發科" },
  { symbol: "00735L", name: "華頓越南正2" },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderWithQuery = (ui: React.ReactElement) =>
  render(ui, { wrapper: makeQueryWrapper() });

async function flushLoad() {
  // Resolve the useEffect-scheduled load() promise and let setState commit.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SymbolSearch", () => {
  it("filters by symbol prefix after the symbol list loads", async () => {
    vi.spyOn(api, "symbolsAll").mockResolvedValue(ALL);
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);
    await flushLoad();

    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);
    fireEvent.change(input, { target: { value: "23" } });

    expect(screen.getByText("台積電")).toBeTruthy();
    expect(screen.getByText("鴻海")).toBeTruthy();
    expect(screen.getByText("台達電")).toBeTruthy();
    expect(screen.getByText("光寶科")).toBeTruthy();
    expect(screen.queryByText("聯發科")).toBeNull();
  });

  it("filters by name substring case-insensitively", async () => {
    vi.spyOn(api, "symbolsAll").mockResolvedValue(ALL);
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);
    await flushLoad();

    fireEvent.change(screen.getByPlaceholderText(/搜尋代號或名稱/), {
      target: { value: "台" },
    });
    expect(screen.getByText("台積電")).toBeTruthy();
    expect(screen.getByText("台達電")).toBeTruthy();
    expect(screen.queryByText("聯發科")).toBeNull();
  });

  it("narrows results as the query gets longer (no stale flicker)", async () => {
    vi.spyOn(api, "symbolsAll").mockResolvedValue(ALL);
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);
    await flushLoad();

    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);
    fireEvent.change(input, { target: { value: "23" } });
    expect(screen.getByText("光寶科")).toBeTruthy();

    fireEvent.change(input, { target: { value: "2330" } });
    expect(screen.getByText("台積電")).toBeTruthy();
    expect(screen.queryByText("光寶科")).toBeNull();
    expect(screen.queryByText("鴻海")).toBeNull();
  });

  it("hits the API at most once across many keystrokes", async () => {
    const spy = vi.spyOn(api, "symbolsAll").mockResolvedValue(ALL);
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);
    await flushLoad();

    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);
    for (const v of ["2", "23", "233", "2330", "233", "23", "2"]) {
      fireEvent.change(input, { target: { value: v } });
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("shows 載入中 placeholder while the list is still loading", async () => {
    let resolveAll!: (v: Sym[]) => void;
    vi.spyOn(api, "symbolsAll").mockReturnValue(
      new Promise<Sym[]>((r) => { resolveAll = r; }),
    );
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/搜尋代號或名稱/), {
      target: { value: "2330" },
    });
    expect(screen.getByText("載入中...")).toBeTruthy();

    await act(async () => {
      resolveAll(ALL);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText("載入中...")).toBeNull();
      expect(screen.getByText("台積電")).toBeTruthy();
    });
  });

  it("caps the dropdown at 20 results even when many symbols match", async () => {
    const many: Sym[] = Array.from({ length: 50 }, (_, i) => ({
      symbol: `2${String(i).padStart(3, "0")}`,
      name: `S${i}`,
    }));
    vi.spyOn(api, "symbolsAll").mockResolvedValue(many);
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);
    await flushLoad();

    fireEvent.change(screen.getByPlaceholderText(/搜尋代號或名稱/), {
      target: { value: "2" },
    });
    const items = document.querySelectorAll("button");
    expect(items.length).toBe(20);
  });

  it("closes dropdown and clears results when query is emptied", async () => {
    vi.spyOn(api, "symbolsAll").mockResolvedValue(ALL);
    renderWithQuery(<SymbolSearch onPick={vi.fn()} />);
    await flushLoad();

    const input = screen.getByPlaceholderText(/搜尋代號或名稱/);
    fireEvent.change(input, { target: { value: "2330" } });
    expect(screen.getByText("台積電")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("台積電")).toBeNull();
  });

  it("invokes onPick with symbol + name when an item is selected", async () => {
    vi.spyOn(api, "symbolsAll").mockResolvedValue(ALL);
    const onPick = vi.fn();
    renderWithQuery(<SymbolSearch onPick={onPick} />);
    await flushLoad();

    fireEvent.change(screen.getByPlaceholderText(/搜尋代號或名稱/), {
      target: { value: "2330" },
    });
    fireEvent.mouseDown(screen.getByText("2330"));
    expect(onPick).toHaveBeenCalledWith("2330", "台積電");
  });
});
