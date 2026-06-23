/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useContainerSize } from "./useContainerSize";

// Minimal ResizeObserver mock: we capture the callback per instance and let
// tests trigger it with synthesized rects. jsdom doesn't ship one.
type ROCallback = (entries: ResizeObserverEntry[]) => void;
const observers: { cb: ROCallback; target: Element | null }[] = [];

beforeEach(() => {
  observers.length = 0;
  // @ts-expect-error jsdom shim
  globalThis.ResizeObserver = class {
    cb: ROCallback;
    target: Element | null = null;
    constructor(cb: ROCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe(el: Element) {
      this.target = el;
    }
    disconnect() {
      const i = observers.indexOf(this);
      if (i >= 0) observers.splice(i, 1);
    }
    unobserve() {}
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function triggerResize(width: number, height: number) {
  for (const ob of observers) {
    if (!ob.target) continue;
    // Force getBoundingClientRect to return the new dims, then fire the
    // observer callback (the hook reads via getBoundingClientRect, not via
    // the entry contentRect).
    vi.spyOn(ob.target, "getBoundingClientRect").mockReturnValue({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    } as DOMRect);
    ob.cb([] as unknown as ResizeObserverEntry[]);
  }
}

function setup() {
  return renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(null);
    // Attach a synthetic element so the observer can observe something.
    if (!ref.current) {
      ref.current = document.createElement("div");
    }
    const size = useContainerSize(ref);
    return { size, ref };
  });
}

describe("useContainerSize", () => {
  it("updates when ResizeObserver fires with non-zero dimensions", async () => {
    const { result } = setup();
    await act(async () => {
      triggerResize(800, 600);
      // useContainerSize batches measurements through rAF
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(result.current.size).toEqual({ width: 800, height: 600 });
  });

  it("holds the previous size when ResizeObserver fires with 0×0 — covers tab going to display:none", async () => {
    const { result } = setup();

    // Establish a real size first.
    await act(async () => {
      triggerResize(1200, 800);
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(result.current.size).toEqual({ width: 1200, height: 800 });

    // Now the element collapses (display:none on a parent). The hook MUST
    // NOT overwrite state with zeros — otherwise the re-show would flash a
    // fallback size for a frame or two.
    await act(async () => {
      triggerResize(0, 0);
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(result.current.size).toEqual({ width: 1200, height: 800 });

    // Re-show emits the real size again — no-op, state already correct.
    await act(async () => {
      triggerResize(1200, 800);
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(result.current.size).toEqual({ width: 1200, height: 800 });
  });

  it("allows initial 0×0 → real-size transition when no prior good size exists", async () => {
    // Brand-new mount: prev is {0,0} and a 0×0 measurement (before layout)
    // followed by a real measurement should still arrive at the real size.
    const { result } = setup();
    await act(async () => {
      triggerResize(0, 0);
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(result.current.size).toEqual({ width: 0, height: 0 });

    await act(async () => {
      triggerResize(640, 480);
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(result.current.size).toEqual({ width: 640, height: 480 });
  });
});
