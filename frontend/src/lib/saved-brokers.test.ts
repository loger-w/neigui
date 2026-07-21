/** @vitest-environment jsdom */
import { afterEach, describe, expect, test } from "vitest";
import {
  SAVED_BROKERS_STORAGE_KEY,
  addSavedBroker,
  loadSavedBrokers,
  removeSavedBroker,
  saveSavedBrokers,
} from "./saved-brokers";

afterEach(() => localStorage.clear());

describe("saved-brokers(SC-9 常用分點)", () => {
  test("無既存 → 空清單", () => {
    expect(loadSavedBrokers()).toEqual([]);
  });

  test("save → load roundtrip", () => {
    saveSavedBrokers([{ id: "9801", name: "元大-松江" }]);
    expect(loadSavedBrokers()).toEqual([{ id: "9801", name: "元大-松江" }]);
  });

  test("壞 JSON / 非陣列 / 壞元素靜默濾除", () => {
    localStorage.setItem(SAVED_BROKERS_STORAGE_KEY, "{bad");
    expect(loadSavedBrokers()).toEqual([]);
    localStorage.setItem(SAVED_BROKERS_STORAGE_KEY, JSON.stringify({ a: 1 }));
    expect(loadSavedBrokers()).toEqual([]);
    localStorage.setItem(
      SAVED_BROKERS_STORAGE_KEY,
      JSON.stringify([{ id: "9801", name: "元大" }, { id: 5 }, null]),
    );
    expect(loadSavedBrokers()).toEqual([{ id: "9801", name: "元大" }]);
  });

  test("addSavedBroker 去重(同 id 不重複)", () => {
    const a = addSavedBroker([], { id: "9801", name: "元大" });
    const b = addSavedBroker(a, { id: "9801", name: "元大" });
    expect(b).toEqual([{ id: "9801", name: "元大" }]);
    expect(b).toBe(a); // 無變更回原 reference
  });

  test("removeSavedBroker 移除指定 id,不存在時回原清單", () => {
    const list = [{ id: "9801", name: "元大" }, { id: "9600", name: "富邦" }];
    expect(removeSavedBroker(list, "9801")).toEqual([{ id: "9600", name: "富邦" }]);
    expect(removeSavedBroker(list, "XXXX")).toBe(list);
  });
});
