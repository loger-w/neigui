import { useCallback, useEffect, useState } from "react";

export interface ContainerSize {
  width: number;
  height: number;
}

export function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  const measure = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    setSize((prev) => {
      if (prev.width === w && prev.height === h) return prev;
      return { width: w, height: h };
    });
  }, [ref]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, measure]);

  return size;
}
