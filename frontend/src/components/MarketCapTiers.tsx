import type { ReactElement } from "react";
import type { CapTier } from "../lib/market-types";

type Props = { data: CapTier[] | null; loading: boolean };

// Commit 1 stub(market-today-only change-spec §4 Frontend):只掛 root testid +
// null 態,SC-2 完整 UI(三桶等權漲跌 + 上漲家數比例 bar)由同 spec的
// Commit 2(🟢)補完。
export function MarketCapTiers({ loading }: Props): ReactElement {
  return (
    <section
      data-testid="market-cap-tiers"
      className="flex flex-col min-h-0 p-3 border-r border-line"
    >
      <h3 className="text-ink text-sm">市值分層</h3>
      <div
        data-state={loading ? "loading" : "unavailable"}
        className="text-ink-dim text-xs mt-2"
      >
        {loading ? "載入中…" : "資料暫缺"}
      </div>
    </section>
  );
}
