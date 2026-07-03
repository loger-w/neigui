import { useState, type ReactElement, type ReactNode } from "react";
import { cn } from "../lib/utils";
import type { Leaderboards, LeaderboardRow } from "../lib/market-types";

type Tab = "gainers" | "amount" | "volume_ratio";

const TAB_LABELS: Array<{ key: Tab; label: string }> = [
  { key: "gainers", label: "漲跌幅" },
  { key: "amount", label: "大量單" },
  { key: "volume_ratio", label: "量比" },
];

type Props = {
  leaderboards: Leaderboards | null;
  onSymbolPick: (stockId: string) => void;
};

export function MarketLeaderboard({
  leaderboards,
  onSymbolPick,
}: Props): ReactElement {
  const [tab, setTab] = useState<Tab>("gainers");

  return (
    <div data-testid="market-leaderboard" className="border-l border-line flex flex-col h-full bg-bg">
      <div role="tablist" className="flex border-b border-line">
        {TAB_LABELS.map(({ key, label }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={cn(
                "px-3 py-2 text-xs transition-colors cursor-pointer",
                active
                  ? "text-accent border-b-2 border-accent font-medium"
                  : "text-ink-dim hover:text-ink",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "gainers" && (
          <DualRankList
            up={leaderboards?.gainers ?? []}
            down={leaderboards?.losers ?? []}
            onPick={onSymbolPick}
          />
        )}
        {tab === "amount" && (
          <RankList
            rows={leaderboards?.amount ?? []}
            valueLabel={(r) => `${(r.total_amount / 1e6).toFixed(1)}M`}
            onPick={onSymbolPick}
          />
        )}
        {tab === "volume_ratio" && (
          <RankList
            rows={leaderboards?.volume_ratio ?? []}
            valueLabel={(r) => (r.volume_ratio != null ? `${r.volume_ratio.toFixed(2)}x` : "—")}
            onPick={onSymbolPick}
          />
        )}
      </div>
    </div>
  );
}

function DualRankList({
  up,
  down,
  onPick,
}: {
  up: LeaderboardRow[];
  down: LeaderboardRow[];
  onPick: (sid: string) => void;
}) {
  return (
    <>
      <SectionTitle>漲幅 Top 15</SectionTitle>
      {up.slice(0, 15).map((r) => (
        <Row key={`up-${r.stock_id}`} row={r} onPick={onPick} />
      ))}
      <SectionTitle>跌幅 Top 15</SectionTitle>
      {down.slice(0, 15).map((r) => (
        <Row key={`dn-${r.stock_id}`} row={r} onPick={onPick} />
      ))}
    </>
  );
}

function RankList({
  rows,
  valueLabel,
  onPick,
}: {
  rows: LeaderboardRow[];
  valueLabel: (r: LeaderboardRow) => string;
  onPick: (sid: string) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <Row
          key={r.stock_id}
          row={r}
          onPick={onPick}
          extraValue={valueLabel(r)}
        />
      ))}
    </>
  );
}

function Row({
  row,
  onPick,
  extraValue,
}: {
  row: LeaderboardRow;
  onPick: (sid: string) => void;
  extraValue?: string;
}) {
  // Audit X6 + X5:三分支對齊 SC-2 「bull=紅 / bear=綠 / 平=灰」。原 `> 0`
  // 二分把 change_rate === 0 撞到 bear green,但 heatmap colorForChange(0)
  // 是 NEUTRAL gray,同檔在兩個 view 顏色不一致。X5 改 semantic token。
  const colorBin: "bull" | "bear" | "neutral" =
    row.change_rate > 0 ? "bull" : row.change_rate < 0 ? "bear" : "neutral";
  const colorClass =
    colorBin === "bull"
      ? "text-bull"
      : colorBin === "bear"
        ? "text-bear"
        : "text-ink-dim";
  const sign = colorBin === "bull" ? "+" : "";
  return (
    <button
      type="button"
      onClick={() => onPick(row.stock_id)}
      data-testid={`lb-row-${row.stock_id}`}
      data-color-bin={colorBin}
      className={cn(
        "flex justify-between items-center w-full px-3 py-1",
        "hover:bg-bg-deep cursor-pointer text-xs",
      )}
    >
      <span className="text-ink">
        {row.stock_id} <span className="text-ink-muted">{row.name}</span>
      </span>
      <span className="flex gap-2 items-baseline">
        <span className={colorClass}>
          {sign}
          {row.change_rate.toFixed(2)}%
        </span>
        {extraValue && <span className="text-ink-dim">{extraValue}</span>}
      </span>
    </button>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1 text-[0.625rem] text-ink-dim border-b border-line">
      {children}
    </div>
  );
}
