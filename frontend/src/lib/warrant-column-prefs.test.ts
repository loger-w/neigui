/**
 * @vitest-environment jsdom
 *
 * warrant-column-prefs 純函式測試(mod warrant-ux-feedback SC-6;R6 六邊界)。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  COLUMN_PREFS_KEY,
  loadColumnPrefs,
  moveColumn,
  reconcilePrefs,
  reorderColumn,
  saveColumnPrefs,
} from "./warrant-column-prefs";

const IDS = ["a", "b", "c", "d"];
const LOCKED = ["a"];

describe("reconcilePrefs", () => {
  it("未知 id 自 order/hidden 剔除", () => {
    const p = reconcilePrefs({ order: ["zz", "b", "a", "c", "d"], hidden: ["yy", "c"] }, IDS, LOCKED);
    expect(p.order).toEqual(["b", "a", "c", "d"]);
    expect(p.hidden).toEqual(["c"]);
  });

  it("registry 新欄按預設相對位置插入(前一個已存在欄之後;無前導 → 最前)", () => {
    // 存檔時代只有 d/b:a 無前導 → 最前;c 的 registry 前導 b 在 → 插 b 後
    const p = reconcilePrefs({ order: ["d", "b"], hidden: [] }, IDS, LOCKED);
    expect(p.order).toEqual(["a", "d", "b", "c"]);
  });

  it("shape 錯誤(非 parse throw)一律 fallback 預設", () => {
    for (const bad of [null, 42, "x", { order: "foo", hidden: [] }, { order: ["a"], hidden: "x" }, { order: [1, 2], hidden: [] }]) {
      const p = reconcilePrefs(bad, IDS, LOCKED);
      expect(p).toEqual({ order: IDS, hidden: [] });
    }
  });

  it("hidden 剔除 lockVisible id(防「代號」被舊資料永久隱藏)", () => {
    const p = reconcilePrefs({ order: IDS, hidden: ["a", "b"] }, IDS, LOCKED);
    expect(p.hidden).toEqual(["b"]);
  });

  it("order 去重(重複 id 取首見)", () => {
    const p = reconcilePrefs({ order: ["b", "b", "c", "a", "c", "d"], hidden: [] }, IDS, LOCKED);
    expect(p.order).toEqual(["b", "c", "a", "d"]);
  });

  it("hidden 去重", () => {
    const p = reconcilePrefs({ order: IDS, hidden: ["b", "b"] }, IDS, LOCKED);
    expect(p.hidden).toEqual(["b"]);
  });
});

describe("moveColumn", () => {
  it("上移/下移交換相鄰位置", () => {
    expect(moveColumn(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("邊界與未知 id no-op(回傳原陣列)", () => {
    const order = ["a", "b", "c"];
    expect(moveColumn(order, "a", -1)).toBe(order);
    expect(moveColumn(order, "c", 1)).toBe(order);
    expect(moveColumn(order, "zz", 1)).toBe(order);
  });
});

describe("reorderColumn(拖曳落點)", () => {
  it("往下拖:from 插到 to 之後;往上拖:插到 to 之前", () => {
    expect(reorderColumn(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(reorderColumn(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("同 id / 未知 id no-op(回傳原陣列)", () => {
    const order = ["a", "b", "c"];
    expect(reorderColumn(order, "a", "a")).toBe(order);
    expect(reorderColumn(order, "zz", "a")).toBe(order);
    expect(reorderColumn(order, "a", "zz")).toBe(order);
  });
});

describe("load/save(localStorage)", () => {
  beforeEach(() => localStorage.clear());

  it("壞 JSON parse fallback 預設(不炸)", () => {
    localStorage.setItem(COLUMN_PREFS_KEY, "{oops");
    expect(loadColumnPrefs(IDS, LOCKED)).toEqual({ order: IDS, hidden: [] });
  });

  it("save 後 load 還原(經 reconcile)", () => {
    saveColumnPrefs({ order: ["c", "a", "b", "d"], hidden: ["d"] });
    expect(loadColumnPrefs(IDS, LOCKED)).toEqual({ order: ["c", "a", "b", "d"], hidden: ["d"] });
  });

  it("無存檔 → 預設全顯示、registry 順序", () => {
    expect(loadColumnPrefs(IDS, LOCKED)).toEqual({ order: IDS, hidden: [] });
  });
});
