import type { ReactElement } from "react";
import type { SectorRotation } from "../lib/market-types";

type Props = { data: SectorRotation | null; loading: boolean };

// Commit 1 stub(market-today-only change-spec §4 Frontend):只掛 root testid +
// null 態,SC-3 完整 UI(產業→子產業→成員股三層鑽取)由同 spec的
// Commit 2(🟢)補完。
export function MarketSectorRotation({ loading }: Props): ReactElement {
  return (
    <section data-testid="market-sector-rotation" className="flex flex-col min-h-0 p-3">
      <h3 className="text-ink text-sm">族群輪動</h3>
      <div
        data-state={loading ? "loading" : "unavailable"}
        className="text-ink-dim text-xs mt-2"
      >
        {loading ? "載入中…" : "資料暫缺"}
      </div>
    </section>
  );
}
