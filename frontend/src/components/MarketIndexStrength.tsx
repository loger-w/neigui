import type { ReactElement } from "react";
import type { IndexStrength } from "../lib/market-types";

type Props = { data: IndexStrength | null; loading: boolean };

// Commit 1 stub(market-today-only change-spec §4 Frontend):只掛 root testid +
// null 態,SC-1 完整 UI(強弱並排 / spread 判讀 / 台積電貢獻 / top5)由同 spec
// 的 Commit 2(🟢)補完。
export function MarketIndexStrength({ loading }: Props): ReactElement {
  return (
    <section
      data-testid="market-index-strength"
      className="flex flex-col min-h-0 p-3 border-r border-line"
    >
      <h3 className="text-ink text-sm">大盤強弱</h3>
      <div
        data-state={loading ? "loading" : "unavailable"}
        className="text-ink-dim text-xs mt-2"
      >
        {loading ? "載入中…" : "資料暫缺"}
      </div>
    </section>
  );
}
