import { describe, expect, test } from "vitest";
import {
  formatBrokerLabel,
  formatBrokerName,
  normalizeBrokerQuery,
} from "./broker-name";

describe("formatBrokerLabel", () => {
  test("id + 名稱組成「id 名稱」", () => {
    expect(formatBrokerLabel("9801", "元大松江")).toBe("9801 元大松江");
  });

  test("名稱含 dash 時去 dash(directory 格式統一)", () => {
    expect(formatBrokerLabel("9801", "元大-松江")).toBe("9801 元大松江");
  });

  test("多個 dash 全部移除", () => {
    expect(formatBrokerLabel("102A", "台-灣-摩-根")).toBe("102A 台灣摩根");
  });

  test("name 為 null 時只回 id", () => {
    expect(formatBrokerLabel("9801", null)).toBe("9801");
  });

  test("name 為空字串時只回 id", () => {
    expect(formatBrokerLabel("9801", "")).toBe("9801");
  });

  test("id 為空時只回名稱(防禦邊界)", () => {
    expect(formatBrokerLabel("", "元大松江")).toBe("元大松江");
  });
});

describe("formatBrokerName(非搜尋顯示點:只顯名稱)", () => {
  test("名稱含 dash 時去 dash,不帶 id", () => {
    expect(formatBrokerName("9801", "元大-松江")).toBe("元大松江");
  });

  test("無 dash 名稱原樣回傳", () => {
    expect(formatBrokerName("9200", "凱基台北")).toBe("凱基台北");
  });

  test("name 為 null 時 fallback 顯 id", () => {
    expect(formatBrokerName("9801", null)).toBe("9801");
  });

  test("name 為空字串時 fallback 顯 id", () => {
    expect(formatBrokerName("9801", "")).toBe("9801");
  });
});

describe("normalizeBrokerQuery(搜尋比對正規化)", () => {
  test("去 dash + trim + lowercase", () => {
    expect(normalizeBrokerQuery(" 凱基-信義 ")).toBe("凱基信義");
    expect(normalizeBrokerQuery("102A")).toBe("102a");
  });

  test("純 dash 輸入正規化為空字串(呼叫端須跳過名稱比對)", () => {
    expect(normalizeBrokerQuery("-")).toBe("");
  });
});
