import { describe, expect, test } from "vitest";
import { formatBrokerLabel } from "./broker-name";

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
