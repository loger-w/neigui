/**
 * SC-9(mod/batch-ui-polish):常用分點清單持久化(分點反查頁)。
 *
 * 樣板 = bubble-blocklist.ts:localStorage、壞資料靜默回空、純函式 CRUD。
 * name 存原始 directory 名稱(可含 dash),顯示時走 formatBrokerName 統一。
 */

export interface SavedBroker {
  /** FinMind securities_trader_id。 */
  id: string;
  /** 顯示名稱快照(原始 directory 格式,可含 dash)。 */
  name: string;
}

export const SAVED_BROKERS_STORAGE_KEY = "neigui.saved-brokers.v1";

export function loadSavedBrokers(): SavedBroker[] {
  const raw = localStorage.getItem(SAVED_BROKERS_STORAGE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is SavedBroker =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as SavedBroker).id === "string" &&
      typeof (e as SavedBroker).name === "string",
  );
}

export function saveSavedBrokers(list: SavedBroker[]): void {
  localStorage.setItem(SAVED_BROKERS_STORAGE_KEY, JSON.stringify(list));
}

export function addSavedBroker(
  list: SavedBroker[],
  entry: SavedBroker,
): SavedBroker[] {
  if (list.some((e) => e.id === entry.id)) return list;
  return [...list, entry];
}

export function removeSavedBroker(list: SavedBroker[], id: string): SavedBroker[] {
  if (!list.some((e) => e.id === id)) return list;
  return list.filter((e) => e.id !== id);
}
