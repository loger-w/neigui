import { useEffect, useState } from "react";
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

  // 寫回放 commit 後 effect,不放 setter 的 updater 內 —— updater 必須純
  // (StrictMode 雙跑 / concurrent render 可能丟棄)。mount 也會寫一次
  // (寫回剛讀到的值或 initial),順帶覆掉壞 JSON。
  useEffect(() => {
    try {
      sessionStorage.setItem(
        key,
        opts ? opts.serialize(value) : JSON.stringify(value),
      );
    } catch {
      // sessionStorage 不可用(隱私模式/配額)時退化為純 useState
    }
    // opts 是 caller 的 inline 物件(identity 不穩),serialize 需為純函式,不入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}
