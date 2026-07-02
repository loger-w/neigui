// Shared spinner for loading badges. Extracted after code-review flagged
// three identical 9-line SVG copies in ChipKlineChart + ChipBubbleView.
// motion-reduce:animate-none 讓 prefers-reduced-motion 用戶不看到 spin。

interface Props {
  /** Tailwind size class base name (e.g. "3", "3.5"). Default "3.5". */
  size?: "3" | "3.5" | "4";
}

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  "3": "size-3",
  "3.5": "size-3.5",
  "4": "size-4",
};

export function LoadingSpinner({ size = "3.5" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`${SIZE_CLASS[size]} animate-spin text-accent motion-reduce:animate-none`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
