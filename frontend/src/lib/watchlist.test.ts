/**
 * @vitest-environment jsdom
 *
 * WL-1 (mod/batch-ui-update): 自選清單 — CRUD 純函式 + localStorage 持久化
 * (key neigui.watchlist.v1)。分組 v1 = 建立/刪除/歸組,不做拖曳排序。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  WATCHLIST_STORAGE_KEY,
  addStock,
  assignGroup,
  createGroup,
  deleteGroup,
  loadWatchlist,
  removeStock,
  saveWatchlist,
  type Watchlist,
} from "./watchlist";

beforeEach(() => {
  localStorage.clear();
});

const empty: Watchlist = { groups: [], items: [] };

describe("watchlist — load / save", () => {
  it("key 不存在 → 空清單", () => {
    expect(loadWatchlist()).toEqual(empty);
  });

  it("save 後 load 還原;使用指定 key", () => {
    const w: Watchlist = {
      groups: [{ id: "g1", name: "半導體" }],
      items: [
        { symbol: "2330", name: "台積電", groupId: "g1" },
        { symbol: "2412", name: null, groupId: null },
      ],
    };
    saveWatchlist(w);
    expect(WATCHLIST_STORAGE_KEY).toBe("neigui.watchlist.v1");
    expect(loadWatchlist()).toEqual(w);
  });

  it("壞 JSON / 非物件 / 缺欄位 → 空清單", () => {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, "{oops");
    expect(loadWatchlist()).toEqual(empty);
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([1, 2]));
    expect(loadWatchlist()).toEqual(empty);
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify({ groups: "x" }));
    expect(loadWatchlist()).toEqual(empty);
  });

  it("items / groups 內壞條目被濾掉;指向不存在 group 的 groupId 重設 null", () => {
    localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify({
        groups: [{ id: "g1", name: "半導體" }, { id: 5 }, null],
        items: [
          { symbol: "2330", name: "台積電", groupId: "g1" },
          { symbol: "2412", name: null, groupId: "gGone" },
          { name: "缺 symbol" },
        ],
      }),
    );
    expect(loadWatchlist()).toEqual({
      groups: [{ id: "g1", name: "半導體" }],
      items: [
        { symbol: "2330", name: "台積電", groupId: "g1" },
        { symbol: "2412", name: null, groupId: null },
      ],
    });
  });
});

describe("watchlist — 純函式 CRUD", () => {
  it("addStock 追加;同 symbol 去重(原樣返回)", () => {
    const w1 = addStock(empty, "2330", "台積電");
    expect(w1.items).toEqual([{ symbol: "2330", name: "台積電", groupId: null }]);
    const w2 = addStock(w1, "2330", "改名");
    expect(w2).toEqual(w1);
    expect(empty.items).toEqual([]);
  });

  it("removeStock 依 symbol 移除", () => {
    const w = addStock(addStock(empty, "2330", "台積電"), "2412", null);
    expect(removeStock(w, "2330").items).toEqual([
      { symbol: "2412", name: null, groupId: null },
    ]);
  });

  it("createGroup 產生遞增 id;名稱空白 trim 後為空 → 原樣返回", () => {
    const w1 = createGroup(empty, "半導體");
    expect(w1.groups).toEqual([{ id: "g1", name: "半導體" }]);
    const w2 = createGroup(w1, "金融");
    expect(w2.groups[1]).toEqual({ id: "g2", name: "金融" });
    expect(createGroup(w2, "   ")).toEqual(w2);
  });

  it("assignGroup 歸組 / null 取消歸組", () => {
    const base = createGroup(addStock(empty, "2330", "台積電"), "半導體");
    const grouped = assignGroup(base, "2330", "g1");
    expect(grouped.items[0]!.groupId).toBe("g1");
    expect(assignGroup(grouped, "2330", null).items[0]!.groupId).toBeNull();
  });

  it("deleteGroup 刪組;組內股票退回未分組(不刪股票)", () => {
    let w = createGroup(addStock(empty, "2330", "台積電"), "半導體");
    w = assignGroup(w, "2330", "g1");
    const after = deleteGroup(w, "g1");
    expect(after.groups).toEqual([]);
    expect(after.items).toEqual([
      { symbol: "2330", name: "台積電", groupId: null },
    ]);
  });

  it("deleteGroup 後 createGroup 不重用已刪 id 之前的最大序號", () => {
    let w = createGroup(createGroup(empty, "A"), "B"); // g1, g2
    w = deleteGroup(w, "g1");
    const next = createGroup(w, "C");
    // 剩 g2 → 下一個 id 取 max+1 = g3,不回頭撞 g1 也無妨但不得撞 g2
    expect(next.groups.map((g) => g.id)).toEqual(["g2", "g3"]);
  });
});
