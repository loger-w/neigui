import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 篩選列數字輸入:隱藏原生 spinner(沿 RangeSelector pattern)+ −/+ stepper。
 * Uncontrolled(defaultValue)— 配合呼叫端 epoch remount 保打字中間態,
 * stepper 直接寫 input.value 再回報字串;空字串 = 未啟用(null)語意由呼叫端解。
 */
export interface NumberFieldProps {
  ariaLabel: string;
  onValueChange: (raw: string) => void;
  defaultValue?: string;
  step?: number;
  name?: string;
  placeholder?: string;
  className?: string;
}

export function NumberField({
  ariaLabel,
  onValueChange,
  defaultValue = "",
  step = 1,
  name,
  placeholder,
  className,
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const bump = (dir: -1 | 1) => {
    const el = inputRef.current;
    if (!el) return;
    const cur = Number(el.value);
    const base = el.value.trim() !== "" && Number.isFinite(cur) ? cur : 0;
    // 1e6 rounding:0.2 + 0.1 的浮點尾巴不寫進 input
    const next = Math.round((base + dir * step) * 1e6) / 1e6;
    el.value = String(next);
    onValueChange(el.value);
  };

  const stepBtn =
    "px-1.5 pointer-coarse:min-h-11 text-ink-dim hover:text-ink hover:bg-bg " +
    "cursor-pointer select-none transition-colors leading-none";

  return (
    <span className={cn("inline-flex items-stretch border border-line bg-bg-deep", className)}>
      <button type="button" aria-label={`${ariaLabel} 減少`} onClick={() => bump(-1)} className={stepBtn}>
        −
      </button>
      <input
        ref={inputRef}
        type="number"
        name={name}
        inputMode="decimal"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "w-12 px-1 py-0.5 text-center bg-transparent text-ink outline-none",
          "border-x border-line focus:bg-accent/[0.04]",
          "focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-inset",
          "placeholder:text-ink-dim",
          // 原生 spinner 隱藏(RangeSelector pattern)— stepper 取代
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      <button type="button" aria-label={`${ariaLabel} 增加`} onClick={() => bump(1)} className={stepBtn}>
        +
      </button>
    </span>
  );
}
