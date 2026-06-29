import { cn } from "@/lib/utils";

interface Props {
  direction: "prev" | "next";
  disabled?: boolean;
  onClick: () => void;
}

export function TradingDayStepper({ direction, disabled, onClick }: Props) {
  const label = direction === "prev" ? "前一交易日" : "後一交易日";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center h-8 w-8",
        "bg-bg-deep border border-line text-ink-muted",
        "outline-none transition-colors",
        "hover:text-ink hover:border-line-strong",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:opacity-40 disabled:cursor-default",
        !disabled && "cursor-pointer",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="size-3.5"
      >
        {direction === "prev" ? (
          <polyline
            points="10,3 5,8 10,13"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <polyline
            points="6,3 11,8 6,13"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}
