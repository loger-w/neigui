import { useSyncExternalStore } from "react";

/** 響應式 JS 分支用(換容器類版面切換;純樣式降級直接用 Tailwind 斷點 class)。
 *  判斷方向一律「mobile 為 match、桌面為預設」(`(max-width: 1023px)`)。
 *  jsdom 沒有 window.matchMedia — feature-detect 後回 false,vitest 下元件
 *  固定落在桌面分支,既有測試不受影響。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false,
  );
}
