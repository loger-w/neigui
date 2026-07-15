// 權證表欄位偏好(順序 + 顯示/隱藏)— localStorage 持久化純函式層。
// reconcile 邊界(R6):shape 驗證 / lockVisible 防隱藏 / 去重 / 新欄插預設位置。

export interface ColumnPrefs {
  order: string[];
  hidden: string[];
}

export const COLUMN_PREFS_KEY = "neigui.warrant-columns.v1";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** 存檔內容對 registry 校正:未知 id 剔除、去重、registry 新欄插入
 * 「registry 中前一個已存在欄」之後(無前導 → 最前)、hidden 剔除
 * lockVisible id;shape 不符一律 fallback 預設(order=registry、hidden=[])。 */
export function reconcilePrefs(
  raw: unknown,
  registryIds: string[],
  lockedIds: string[],
): ColumnPrefs {
  const fallback: ColumnPrefs = { order: [...registryIds], hidden: [] };
  if (typeof raw !== "object" || raw === null) return fallback;
  const o = raw as Record<string, unknown>;
  if (!isStringArray(o.order) || !isStringArray(o.hidden)) return fallback;

  const known = new Set(registryIds);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of o.order) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  registryIds.forEach((id, i) => {
    if (seen.has(id)) return;
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(registryIds[j]!);
      if (k !== -1) {
        insertAt = k + 1;
        break;
      }
    }
    order.splice(insertAt, 0, id);
    seen.add(id);
  });

  const locked = new Set(lockedIds);
  const hidden = [...new Set(o.hidden)].filter((id) => known.has(id) && !locked.has(id));
  return { order, hidden };
}

/** 相鄰交換;邊界 / 未知 id 回傳原陣列(reference 相等 = no-op,呼叫端零 re-render)。 */
export function moveColumn(order: string[], id: string, dir: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** 拖曳落點:from 移到 to 的位置(往下拖插 to 後、往上拖插 to 前);
 * 同 id / 未知 id 回傳原陣列。 */
export function reorderColumn(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from === -1 || to === -1) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(next.indexOf(toId) + (from < to ? 1 : 0), 0, fromId);
  return next;
}

export function loadColumnPrefs(registryIds: string[], lockedIds: string[]): ColumnPrefs {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(COLUMN_PREFS_KEY) ?? "null");
  } catch {
    raw = null; // 壞 JSON = 無存檔,交給 reconcile fallback 預設
  }
  return reconcilePrefs(raw, registryIds, lockedIds);
}

export function saveColumnPrefs(p: ColumnPrefs): void {
  try {
    localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage 不可用(隱私模式 / 配額滿)→ 偏好僅存活於當前 session,功能不阻斷
  }
}
