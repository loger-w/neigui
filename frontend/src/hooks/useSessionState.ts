import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

interface SerializeOpts<T> {
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
}

/**
 * sessionStorage-backed useState(SC-8 返回狀態保留基座)。
 *
 * mode 切換是 ternary 真卸載(e2e N4 鎖死,不可改 hidden keep-alive),
 * 需要跨 unmount 保留的 UI 狀態改掛這裡:同 tab session 內 remount 讀回,
 * 關 tab 即清。壞 JSON / deserialize 例外靜默回 initial(對齊 loadWatchlist 慣例)。
 */
export function useSessionState<T>(
  key: string,
  initial: T,
  opts?: SerializeOpts<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return initial;
      return opts ? opts.deserialize(raw) : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      setValue((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: T) => T)(prev)
            : action;
        try {
          sessionStorage.setItem(
            key,
            opts ? opts.serialize(next) : JSON.stringify(next),
          );
        } catch {
          // sessionStorage 不可用(隱私模式/配額)時退化為純 useState
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return [value, set];
}
