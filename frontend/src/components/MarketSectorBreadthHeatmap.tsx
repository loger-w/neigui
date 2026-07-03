import { useMemo, useRef, type ReactElement } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { layoutCells, type BreadthBin } from "../lib/sector-breadth-svg";
import { eodLabel, pctText } from "../lib/market-format";
import { cn } from "../lib/utils";
import type { SectorBreadthRow } from "../lib/market-types";

type Props = {
  rows: SectorBreadthRow[] | null;
  eodAsOf: string | null;
  loaded: boolean;
  onSectorClick: (sector: string) => void;
};

// design v3 §5 色票定案表。嚴禁 bull/bear token — 這是「參與度」不是漲跌。
const BIN_CLASS: Record<BreadthBin, string> = {
  strong: "bg-accent/70 text-ink",
  mid: "bg-accent/35 text-ink",
  weak: "bg-line-strong/50 text-ink-muted",
  cold: "bg-bg-deep text-ink-dim",
};

export function MarketSectorBreadthHeatmap({
  rows,
  eodAsOf,
  loaded,
  onSectorClick,
}: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(containerRef);

  // MarketHeatmap.tsx:19-22 樣板 — 只在 rows / width / height 變動時重排。
  const cells = useMemo(
    () => layoutCells(rows ?? [], width, height),
    [rows, width, height],
  );

  // CR1-11 修復:containerRef 掛在恆存的 wrapper(三態都會 render 到這個
  // div),不再只在資料態分支才出現 — 理由同 MarketBreadthPanel CR1-10。
  let body: ReactElement;
  if (!loaded) {
    body = (
      <div
        data-state="loading"
        role="status"
        aria-label="載入中"
        className="grid grid-cols-4 gap-1"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (rows === null) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs">
        資料暫缺
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div data-state="empty" className="text-ink-dim text-xs">
        無符合資料
      </div>
    );
  } else {
    body = (
      <>
        {cells.map((c) => (
          <button
            type="button"
            key={c.sector}
            data-testid={`sb-cell-${c.sector}`}
            data-fill-bin={c.bin}
            onClick={() => onSectorClick(c.sector)}
            className={cn(
              "absolute overflow-hidden text-left cursor-pointer rounded-sm px-1",
              BIN_CLASS[c.bin],
            )}
            style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
          >
            <span className="block text-[0.625rem] truncate">{c.sector}</span>
            <span className="block text-[0.625rem]">{pctText(c.pct, 0)}</span>
          </button>
        ))}
      </>
    );
  }

  return (
    <section data-testid="market-sector-breadth-heatmap" className="flex flex-col min-h-0 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-ink text-sm">族群參與度</h3>
        <span className="text-ink-dim text-xs">{eodLabel(eodAsOf)}</span>
      </div>
      <span className="text-ink-dim text-[0.625rem]">站上 20 日均線比例</span>
      <div ref={containerRef} className="relative h-64 lg:h-full lg:flex-1 min-h-0">
        {body}
      </div>
    </section>
  );
}
