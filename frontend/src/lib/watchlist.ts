/**
 * WL-1 (mod/batch-ui-update): 自選清單 — 純函式 CRUD + localStorage 持久化。
 *
 * v1 範圍:加股票 / 移除、分組建立 / 刪除 / 歸組;不做拖曳排序、匯入匯出。
 * 壞資料一律靜默回空清單;items 的 groupId 指向不存在的組時重設 null
 * (刪組後殘料自癒)。
 */

export interface WatchlistGroup {
  id: string;
  name: string;
}

export interface WatchlistItem {
  symbol: string;
  /** SymbolSearch 帶入的顯示名;跨 mode pivot(只有代號)時為 null。 */
  name: string | null;
  groupId: string | null;
}

export interface Watchlist {
  groups: WatchlistGroup[];
  items: WatchlistItem[];
}

export const WATCHLIST_STORAGE_KEY = "neigui.watchlist.v1";

const EMPTY: Watchlist = { groups: [], items: [] };

export function loadWatchlist(): Watchlist {
  const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
  if (raw === null) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return EMPTY;
  }
  const { groups, items } = parsed as { groups?: unknown; items?: unknown };
  if (!Array.isArray(groups) || !Array.isArray(items)) return EMPTY;
  const validGroups = groups.filter(
    (g): g is WatchlistGroup =>
      typeof g === "object" &&
      g !== null &&
      typeof (g as WatchlistGroup).id === "string" &&
      typeof (g as WatchlistGroup).name === "string",
  );
  const groupIds = new Set(validGroups.map((g) => g.id));
  const validItems = items
    .filter(
      (i): i is WatchlistItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as WatchlistItem).symbol === "string" &&
        ((i as WatchlistItem).name === null ||
          typeof (i as WatchlistItem).name === "string") &&
        ((i as WatchlistItem).groupId === null ||
          typeof (i as WatchlistItem).groupId === "string"),
    )
    .map((i) => ({
      symbol: i.symbol,
      name: i.name,
      groupId: i.groupId !== null && groupIds.has(i.groupId) ? i.groupId : null,
    }));
  return { groups: validGroups, items: validItems };
}

export function saveWatchlist(w: Watchlist): void {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(w));
}

export function addStock(
  w: Watchlist,
  symbol: string,
  name: string | null,
  groupId: string | null = null,
): Watchlist {
  if (w.items.some((i) => i.symbol === symbol)) return w;
  return { ...w, items: [...w.items, { symbol, name, groupId }] };
}

export function removeStock(w: Watchlist, symbol: string): Watchlist {
  if (!w.items.some((i) => i.symbol === symbol)) return w;
  return { ...w, items: w.items.filter((i) => i.symbol !== symbol) };
}

/** id 取現有 `g<N>` 最大序號 +1 — 純函式(不依賴時鐘/亂數),刪組後不撞現存 id。 */
export function createGroup(w: Watchlist, name: string): Watchlist {
  const trimmed = name.trim();
  if (trimmed === "") return w;
  const maxN = w.groups.reduce((max, g) => {
    const m = /^g(\d+)$/.exec(g.id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return { ...w, groups: [...w.groups, { id: `g${maxN + 1}`, name: trimmed }] };
}

export function deleteGroup(w: Watchlist, groupId: string): Watchlist {
  return {
    groups: w.groups.filter((g) => g.id !== groupId),
    items: w.items.map((i) =>
      i.groupId === groupId ? { ...i, groupId: null } : i,
    ),
  };
}

export function assignGroup(
  w: Watchlist,
  symbol: string,
  groupId: string | null,
): Watchlist {
  return {
    ...w,
    items: w.items.map((i) => (i.symbol === symbol ? { ...i, groupId } : i)),
  };
}
