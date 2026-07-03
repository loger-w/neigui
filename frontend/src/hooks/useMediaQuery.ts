import { useSyncExternalStore } from "react";

/** 響應式 JS 分支用(換容器類版面切換;純樣式降級直接用 Tailwind 斷點 class)。
 *  判斷方向一律「mobile 為 match、桌面為預設」(`(max-width: 1023px)`)—
 *  jsdom 的 matchMedia 恆 `matches: false`,vitest 下元件自動落在桌面分支,
 *  既有測試不受影響。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
  );
}
