/** @vitest-environment jsdom */
import { afterEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionState } from "./useSessionState";

afterEach(() => {
  sessionStorage.clear();
});

describe("useSessionState", () => {
  test("無既存值時回 initial", () => {
    const { result } = renderHook(() => useSessionState("t.a", 42));
    expect(result.current[0]).toBe(42);
  });

  test("set 後寫入 sessionStorage,remount 讀回", () => {
    const first = renderHook(() => useSessionState("t.b", "x"));
    act(() => first.result.current[1]("y"));
    expect(first.result.current[0]).toBe("y");
    first.unmount();

    const second = renderHook(() => useSessionState("t.b", "x"));
    expect(second.result.current[0]).toBe("y");
  });

  test("壞 JSON 靜默回 initial", () => {
    sessionStorage.setItem("t.c", "{not json");
    const { result } = renderHook(() => useSessionState("t.c", 7));
    expect(result.current[0]).toBe(7);
  });

  test("支援 functional update", () => {
    const { result } = renderHook(() => useSessionState("t.d", 1));
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
    expect(JSON.parse(sessionStorage.getItem("t.d") ?? "")).toBe(2);
  });

  test("物件值 roundtrip", () => {
    const first = renderHook(() =>
      useSessionState<{ id: string } | null>("t.e", null),
    );
    act(() => first.result.current[1]({ id: "9801" }));
    first.unmount();
    const second = renderHook(() =>
      useSessionState<{ id: string } | null>("t.e", null),
    );
    expect(second.result.current[0]).toEqual({ id: "9801" });
  });

  test("Set 值走 serialize/deserialize opts roundtrip", () => {
    const opts = {
      serialize: (v: Set<string>) => JSON.stringify([...v]),
      deserialize: (raw: string) => new Set<string>(JSON.parse(raw)),
    };
    const first = renderHook(() =>
      useSessionState("t.f", new Set<string>(), opts),
    );
    act(() => first.result.current[1](new Set(["半導體"])));
    first.unmount();
    const second = renderHook(() =>
      useSessionState("t.f", new Set<string>(), opts),
    );
    expect([...second.result.current[0]]).toEqual(["半導體"]);
  });

  test("deserialize 丟例外時回 initial", () => {
    sessionStorage.setItem("t.g", '["ok"]');
    const opts = {
      serialize: (v: Set<string>) => JSON.stringify([...v]),
      deserialize: (_raw: string): Set<string> => {
        throw new Error("boom");
      },
    };
    const { result } = renderHook(() =>
      useSessionState("t.g", new Set<string>(["init"]), opts),
    );
    expect([...result.current[0]]).toEqual(["init"]);
  });
});
