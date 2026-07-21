/**
 * BB-1 (mod/batch-ui-update): 泡泡圖分點過濾清單持久化。
 *
 * 全域生效(跨個股)— 過濾動機是「永遠不想看到的雜訊分點」,依個股記憶
 * 不符動機。清單存 localStorage,壞資料一律靜默回空清單(過濾是輔助功能,
 * 不值得為殘料炸頁面)。
 */

export interface BlockedBroker {
  /** FinMind securities_trader_id,對齊 BrokerTrade.broker_id。 */
  id: string;
  /** 顯示名稱快照 — 清單列表要能顯示不在當日資料內的分點。 */
  name: string;
}

export const BLOCKLIST_STORAGE_KEY = "neigui.bubble-broker-blocklist.v1";

export function loadBlocklist(): BlockedBroker[] {
  const raw = localStorage.getItem(BLOCKLIST_STORAGE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is BlockedBroker =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as BlockedBroker).id === "string" &&
      typeof (e as BlockedBroker).name === "string",
  );
}

export function saveBlocklist(list: BlockedBroker[]): void {
  localStorage.setItem(BLOCKLIST_STORAGE_KEY, JSON.stringify(list));
}

export function addBlocked(
  list: BlockedBroker[],
  entry: BlockedBroker,
): BlockedBroker[] {
  if (list.some((e) => e.id === entry.id)) return list;
  return [...list, entry];
}

export function removeBlocked(list: BlockedBroker[], id: string): BlockedBroker[] {
  if (!list.some((e) => e.id === id)) return list;
  return list.filter((e) => e.id !== id);
}
