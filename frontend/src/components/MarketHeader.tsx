import { type ReactElement } from "react";
import { cn } from "../lib/utils";

type Props = {
  lastUpdated: string | null;
  isStale: boolean;
  isTradingSession: boolean;
  lagSeconds: number | null;
  onRefresh: () => void;
};

export function MarketHeader({
  lastUpdated,
  isStale,
  isTradingSession,
  lagSeconds,
  onRefresh,
}: Props): ReactElement {
  const sessionLabel = !lastUpdated
    ? "尚未載入"
    : isTradingSession
      ? "盤中"
      : "已收盤";
  // Phase 4 R7: lag pill 只在「盤中」有意義,!isTradingSession 時(已收盤 /
  // 假日 / 開盤前)隱藏,避免 "1080 分鐘" 這種無意義的數字。
  const showLagPill = isTradingSession && lagSeconds != null;
  const lagLabel = lagSeconds == null
    ? "—"
    : lagSeconds < 30
      ? "即時"
      : lagSeconds < 60
        ? `${lagSeconds}s`
        : `${Math.floor(lagSeconds / 60)} 分鐘`;
  const lagPillColor = lagSeconds == null
    ? "bg-bg-deep text-ink-dim"
    : lagSeconds < 30
      ? "bg-accent/20 text-accent"
      : lagSeconds < 60
        ? "bg-yellow-500/20 text-yellow-600"
        : "bg-red-500/20 text-red-600";

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-line">
      <div className="flex items-center gap-3">
        <h2 className="text-ink font-medium">大盤掃描</h2>
        <span className="text-ink-muted text-xs">
          {sessionLabel}
          {lastUpdated && ` · ${formatTime(lastUpdated)}`}
        </span>
        {showLagPill && (
          <span className={cn("text-xs px-2 py-0.5 rounded", lagPillColor)}>
            {lagLabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isStale && (
          <span className="text-yellow-600 text-xs">資料停滯</span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className={cn(
            "text-ink-muted hover:text-ink text-xs px-2 py-1 rounded",
            "border border-line hover:border-line-strong cursor-pointer",
          )}
          aria-label="重新整理"
        >
          重新整理
        </button>
      </div>
    </header>
  );
}

function formatTime(iso: string): string {
  const t = iso.split("T")[1] ?? iso;
  return t.split(".")[0] ?? t;
}
