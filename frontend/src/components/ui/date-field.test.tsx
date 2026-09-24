/**
 * @vitest-environment jsdom
 *
 * Cluster E 🟢 — project-themed DateField wrapping native <input type="date">.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DateField } from "./date-field";

afterEach(() => cleanup());

describe("DateField", () => {
  it("renders an input with type=date", () => {
    const { container } = render(<DateField value="2026-06-22" />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("date");
  });

  it("forwards onChange with event.target.value", () => {
    let captured: string | undefined;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      // Capture eagerly — React's controlled-input rerender will revert the
      // DOM value back to the value prop, so reading lazily later sees the old
      // value rather than what fireEvent set.
      captured = e.target.value;
    });
    const { container } = render(
      <DateField value="2026-06-22" onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-21" } });
    expect(onChange).toHaveBeenCalled();
    expect(captured).toBe("2026-06-21");
  });

  it("value prop reflects in DOM", () => {
    const { container, rerender } = render(<DateField value="2026-06-22" />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("2026-06-22");
    rerender(<DateField value="2026-06-21" />);
    expect(input.value).toBe("2026-06-21");
  });

  it("aria-label is exposed", () => {
    const { getByLabelText } = render(
      <DateField value="2026-06-22" aria-label="選擇日期" />,
    );
    expect(getByLabelText("選擇日期")).toBeTruthy();
  });

  it("disabled prevents value change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateField value="2026-06-22" disabled onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("applies project-theme classes for picker indicator targeting", () => {
    const { container } = render(<DateField value="2026-06-22" />);
    const input = container.querySelector("input") as HTMLInputElement;
    // Must carry the marker class so the index.css ::-webkit rule applies.
    expect(input.className).toContain("date-field-input");
  });

  // --- snapToDates (chip-date-controls 2026-06-29) ---

  it("snaps onChange value to the latest trading day when target is not a trading day", () => {
    // user types Saturday 2026-06-27; snap to Friday 2026-06-26
    let captured: string | undefined;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      captured = e.target.value;
    });
    const { container } = render(
      <DateField
        value="2026-06-25"
        snapToDates={["2026-06-24", "2026-06-25", "2026-06-26"]}
        onChange={onChange}
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(onChange).toHaveBeenCalled();
    expect(captured).toBe("2026-06-26");
  });

  it("passes raw value through when snapToDates is empty (W9: race noop)", () => {
    let captured: string | undefined;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      captured = e.target.value;
    });
    const { container } = render(
      <DateField value="2026-06-25" snapToDates={[]} onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(captured).toBe("2026-06-27");
  });

  it("does not wrap onChange when snapToDates is undefined (W2: pure-native path)", () => {
    // W2 — without snapToDates / onValueChange DateField must remain pure-native;
    // BrokerFlowsPanel depends on this raw onChange contract (it runs its own
    // draft guard). OptionsHeader moved to onValueChange in
    // fix/date-field-partial-input.
    let captured: string | undefined;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      captured = e.target.value;
    });
    const { container } = render(
      <DateField value="2026-06-25" onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    // Saturday value — without snapToDates the DateField must forward verbatim
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(captured).toBe("2026-06-27");
  });

  it("forwards in-list value without snapping (idempotent)", () => {
    let captured: string | undefined;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      captured = e.target.value;
    });
    const { container } = render(
      <DateField
        value="2026-06-25"
        snapToDates={["2026-06-24", "2026-06-25", "2026-06-26"]}
        onChange={onChange}
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-24" } });
    expect(captured).toBe("2026-06-24");
  });

  // --- A1: snap path must NOT strip HTMLInputElement / SyntheticEvent prototype.
  // The old impl synthesized a POJO via { ...e, target: { ...e.target } }, which
  // dropped focus()/checkValidity()/preventDefault() etc. New impl mutates
  // e.target.value in place and forwards the real event.
  it("preserves HTMLInputElement on e.target after snap (no prototype strip)", () => {
    let target: EventTarget | null = null;
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      target = e.target;
    });
    const { container } = render(
      <DateField
        value="2026-06-25"
        snapToDates={["2026-06-24", "2026-06-25", "2026-06-26"]}
        onChange={onChange}
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    // The forwarded target must still be the real input element,
    // not a plain object lacking HTMLInputElement methods.
    expect(target).toBe(input);
    expect(target).not.toBeNull();
    expect((target as unknown as HTMLInputElement).focus).toBeTypeOf("function");
  });

  // --- A2: controlled-input desync — when snapped value equals current `value`
  // prop, React's Object.is bail-out skips re-render and the DOM input retains
  // the user-typed value unless we also mutate the DOM in place. Verify the
  // DOM value reflects the snapped result.
  it("forces DOM input.value to the snapped value (avoids controlled-input desync)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateField
        value="2026-06-26"
        snapToDates={["2026-06-24", "2026-06-25", "2026-06-26"]}
        onChange={onChange}
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    // user types Saturday — would snap to Friday (2026-06-26) which equals
    // the controlled value prop, so React bails out and would NOT resync DOM.
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(input.value).toBe("2026-06-26");
  });

  // --- A1/A2 alternative API: onValueChange receives the post-snap string.
  it("calls onValueChange with snapped string (preferred over onChange for snap-aware callers)", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <DateField
        value="2026-06-25"
        snapToDates={["2026-06-24", "2026-06-25", "2026-06-26"]}
        onValueChange={onValueChange}
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(onValueChange).toHaveBeenCalledWith("2026-06-26");
  });

  it("calls onValueChange with raw value when snapToDates is undefined (W2 backward compat)", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <DateField value="2026-06-25" onValueChange={onValueChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(onValueChange).toHaveBeenCalledWith("2026-06-27");
  });

  // --- fix/date-field-partial-input:原生 date input 清除 / 逐位打年份會送出
  // 空值與 0002-/0020-/0202- 半成品;snap 路徑曾把它們夾到清單最早日並回呼
  // (個股頁跳到約一年前),純回呼路徑則直接送出半成品(選擇權頁打出錯誤請求)。
  const DAYS = ["2025-07-01", "2025-07-02", "2026-06-25", "2026-06-26"];
  for (const raw of ["", "0002-06-26", "0020-06-26", "0202-06-26"]) {
    it(`不完整輸入 ${JSON.stringify(raw)}:不 snap、不回呼、欄位保留輸入中的內容`, () => {
      const onValueChange = vi.fn();
      const { container } = render(
        <DateField value="2026-06-26" snapToDates={DAYS} onValueChange={onValueChange} />,
      );
      const input = container.querySelector("input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: raw } });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(input.value).toBe(raw);
    });
  }

  it("不完整輸入(無 snapToDates 的回呼路徑)也不回呼", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <DateField value="2026-06-26" onValueChange={onValueChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0002-06-26" } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("逐位打完年份才回呼一次;失焦時未完成的輸入還原為已提交值", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <DateField value="2026-06-26" snapToDates={DAYS} onValueChange={onValueChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    for (const v of ["0002-06-25", "0020-06-25", "0202-06-25", "2026-06-25"]) {
      fireEvent.change(input, { target: { value: v } });
    }
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("2026-06-25");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("2026-06-26");
  });

  it("有草稿時外部 value 變動(如個股頁 K 線回來後自動對齊日期)→ 丟草稿顯示新值", () => {
    const onValueChange = vi.fn();
    const { container, rerender } = render(
      <DateField value="2026-06-26" snapToDates={DAYS} onValueChange={onValueChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0002-06-26" } });
    expect(input.value).toBe("0002-06-26");
    rerender(<DateField value="2026-06-25" snapToDates={DAYS} onValueChange={onValueChange} />);
    expect(input.value).toBe("2026-06-25");
  });

  it("純原生路徑(無 snapToDates / onValueChange)不套防護:不完整值原樣交給 onChange", () => {
    // 分點反查(BrokerFlowsPanel)在此路徑上自帶草稿防護,依賴收到每個原始值
    const seen: string[] = [];
    const { container } = render(
      <DateField value="2026-06-26" onChange={(e) => seen.push(e.target.value)} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "0002-06-26" } });
    expect(seen).toEqual(["", "0002-06-26"]);
  });

  it("早於下限(預設 2000-01-01)或超過 max 的完整日期不回呼", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <DateField value="2026-06-26" max="2026-06-26" onValueChange={onValueChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1999-12-31" } });
    fireEvent.change(input, { target: { value: "2026-06-27" } });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
