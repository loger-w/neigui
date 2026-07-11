/**
 * @vitest-environment jsdom
 *
 * 券差單檔篩選 combobox(change-spec SC-1/3/4):
 * 空 query focus 列全候選 / 輸入過濾 / 點選與 Enter 選定 / 無匹配提示不可選 /
 * 清除鈕 / 選定態編輯即解除(R3)/ Escape 關下拉。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BorrowFeeStockFilter } from "./BorrowFeeStockFilter";
import type { StockOption } from "../lib/borrow-fee-utils";

const OPTIONS: StockOption[] = [
  { stock_id: "2434", name: "統懋", market: "twse" },
  { stock_id: "5483", name: "中美晶", market: "tpex" },
  { stock_id: "8046", name: "南電", market: "twse" },
];

afterEach(() => cleanup());

const getInput = () =>
  screen.getByTestId("borrow-fee-stock-filter") as HTMLInputElement;

const renderFilter = (over: Partial<Parameters<typeof BorrowFeeStockFilter>[0]> = {}) => {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  render(
    <BorrowFeeStockFilter
      options={OPTIONS}
      selected={null}
      onSelect={onSelect}
      onClear={onClear}
      {...over}
    />,
  );
  return { onSelect, onClear };
};

describe("BorrowFeeStockFilter", () => {
  it("空 query focus 列出當日全部候選(代號 + 名稱 + 市場)", () => {
    renderFilter();
    fireEvent.focus(getInput());
    const opts = screen.getAllByRole("option");
    expect(opts.length).toBe(3);
    expect(opts[0]?.textContent).toContain("2434");
    expect(opts[0]?.textContent).toContain("統懋");
    expect(opts[0]?.textContent).toContain("上市");
    expect(opts[1]?.textContent).toContain("上櫃");
  });

  it("輸入代號 prefix / 名稱 substring 過濾候選", () => {
    renderFilter();
    fireEvent.change(getInput(), { target: { value: "80" } });
    expect(screen.getAllByRole("option").length).toBe(1);
    expect(screen.getByRole("option").textContent).toContain("8046");
    fireEvent.change(getInput(), { target: { value: "中美" } });
    expect(screen.getByRole("option").textContent).toContain("5483");
  });

  it("點選候選觸發 onSelect", () => {
    const { onSelect } = renderFilter();
    fireEvent.change(getInput(), { target: { value: "80" } });
    fireEvent.mouseDown(screen.getByRole("option"));
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it("Enter 選定 highlight 候選", () => {
    const { onSelect } = renderFilter();
    fireEvent.focus(getInput());
    fireEvent.keyDown(getInput(), { key: "ArrowDown" });
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[1]);
  });

  it("無匹配顯示提示且無可選項(SC-4)", () => {
    const { onSelect } = renderFilter();
    fireEvent.change(getInput(), { target: { value: "9999" } });
    expect(screen.getByText("該檔今日未列入券差")).toBeTruthy();
    expect(screen.queryAllByRole("option").length).toBe(0);
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("選定態顯示「代號 名稱」與清除鈕,點清除觸發 onClear", () => {
    const { onClear } = renderFilter({ selected: OPTIONS[1] });
    expect(getInput().value).toBe("5483 中美晶");
    fireEvent.click(screen.getByTestId("stock-filter-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("選定態下編輯輸入即解除 selection(R3:輸入 = 重新搜尋)", () => {
    const { onClear } = renderFilter({ selected: OPTIONS[1] });
    fireEvent.change(getInput(), { target: { value: "54" } });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("Escape 關閉下拉", () => {
    renderFilter();
    fireEvent.focus(getInput());
    expect(screen.getAllByRole("option").length).toBe(3);
    fireEvent.keyDown(getInput(), { key: "Escape" });
    expect(screen.queryAllByRole("option").length).toBe(0);
  });
});
