import type { ReactElement } from "react";
import type { ExcludedCount } from "../lib/market-types";

type Props = { universeSize: number; excludedCount: ExcludedCount; stale: boolean };

export function MarketUniverseBanner({ universeSize, excludedCount, stale }: Props): ReactElement {
  const total = excludedCount.etf + excludedCount.warrant + excludedCount.watch_list;
  return (
    <div
      data-testid="market-universe-banner"
      className="px-4 py-1 text-xs text-ink-muted border-b border-line bg-bg-deep"
    >
      已過濾 ETF / 權證 / 處置股 共 {total} 檔 · 納入 {universeSize} 檔(以本次掃描範圍為準)
      {stale && " · 資料停滯,顯示最近成功結果"}
    </div>
  );
}
