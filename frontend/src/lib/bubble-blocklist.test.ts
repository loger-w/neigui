/**
 * @vitest-environment jsdom
 *
 * BB-1 (mod/batch-ui-update): 泡泡圖分點過濾清單 — localStorage 持久化
 * (key neigui.bubble-broker-blocklist.v1,全域跨個股)。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BLOCKLIST_STORAGE_KEY,
  addBlocked,
  loadBlocklist,
  removeBlocked,
  saveBlocklist,
  type BlockedBroker,
} from "./bubble-blocklist";

beforeEach(() => {
  localStorage.clear();
});

describe("bubble-blocklist — load / save", () => {
  it("key 不存在 → []", () => {
    expect(loadBlocklist()).toEqual([]);
  });

  it("save 後 load 還原相同清單", () => {
    const list: BlockedBroker[] = [
      { id: "9200", name: "凱基" },
      { id: "1440", name: "美林" },
    ];
    saveBlocklist(list);
    expect(loadBlocklist()).toEqual(list);
  });

  it("使用指定的 storage key", () => {
    saveBlocklist([{ id: "9200", name: "凱基" }]);
    expect(BLOCKLIST_STORAGE_KEY).toBe("neigui.bubble-broker-blocklist.v1");
    expect(localStorage.getItem(BLOCKLIST_STORAGE_KEY)).toBeTruthy();
  });

  it("壞 JSON → []", () => {
    localStorage.setItem(BLOCKLIST_STORAGE_KEY, "{not json");
    expect(loadBlocklist()).toEqual([]);
  });

  it("JSON 不是 array → []", () => {
    localStorage.setItem(BLOCKLIST_STORAGE_KEY, JSON.stringify({ id: "x" }));
    expect(loadBlocklist()).toEqual([]);
  });

  it("array 內缺欄位 / 型別錯的條目被濾掉", () => {
    localStorage.setItem(
      BLOCKLIST_STORAGE_KEY,
      JSON.stringify([
        { id: "9200", name: "凱基" },
        { id: 123, name: "數字 id" },
        { name: "缺 id" },
        "字串",
        null,
      ]),
    );
    expect(loadBlocklist()).toEqual([{ id: "9200", name: "凱基" }]);
  });
});

describe("bubble-blocklist — add / remove(純函式,回傳新陣列)", () => {
  it("addBlocked 追加條目,不改原陣列", () => {
    const orig: BlockedBroker[] = [{ id: "A1", name: "Alpha" }];
    const next = addBlocked(orig, { id: "B1", name: "Bravo" });
    expect(next).toEqual([
      { id: "A1", name: "Alpha" },
      { id: "B1", name: "Bravo" },
    ]);
    expect(orig).toEqual([{ id: "A1", name: "Alpha" }]);
  });

  it("addBlocked 同 id 去重(回傳原清單內容不重複)", () => {
    const orig: BlockedBroker[] = [{ id: "A1", name: "Alpha" }];
    const next = addBlocked(orig, { id: "A1", name: "Alpha 改名" });
    expect(next).toEqual([{ id: "A1", name: "Alpha" }]);
  });

  it("removeBlocked 依 id 移除;id 不在清單時原樣返回", () => {
    const orig: BlockedBroker[] = [
      { id: "A1", name: "Alpha" },
      { id: "B1", name: "Bravo" },
    ];
    expect(removeBlocked(orig, "A1")).toEqual([{ id: "B1", name: "Bravo" }]);
    expect(removeBlocked(orig, "ZZ")).toEqual(orig);
  });
});
