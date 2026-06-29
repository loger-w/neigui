import { useMemo, useRef, useState, type ReactElement } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { layoutHeatmap, type TileLayout } from "../lib/heatmap-svg";
import type { Sector } from "../lib/market-types";

type Props = {
  sectors: Sector[];
  onSymbolPick: (stockId: string) => void;
};

export function MarketHeatmap({ sectors, onSymbolPick }: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(containerRef);
  const [hoveredTile, setHoveredTile] = useState<TileLayout | null>(null);

  // Audit X2:hover state 變動會重 render 此元件;裸呼叫 layoutHeatmap 等於
  // 每次 hover 都重跑整張 squarified treemap(28 sector × ~30 tile)。包 useMemo
  // 後僅在 sectors / width / height 變動時才重排。
  const groups = useMemo(
    () => layoutHeatmap(sectors, width, height),
    [sectors, width, height],
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-bg-deep">
      <svg width={width} height={height} role="img" aria-label="大盤族群熱力圖">
        {groups.map((g) => (
          <g key={g.id}>
            <rect
              x={g.x}
              y={g.y}
              width={g.w}
              height={g.h}
              fill="none"
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={g.x + 4}
              y={g.y + 12}
              className="fill-ink-muted text-[10px] pointer-events-none"
            >
              {g.name}
            </text>
            {g.tiles.map((t) => (
              <g
                key={t.stockId}
                onMouseEnter={() => setHoveredTile(t)}
                onMouseLeave={() => setHoveredTile(null)}
                onClick={() => onSymbolPick(t.stockId)}
                className="cursor-pointer"
                data-testid={`tile-${t.stockId}`}
              >
                <rect
                  x={t.x}
                  y={t.y}
                  width={t.w}
                  height={t.h}
                  fill={t.fillColor}
                  data-fill-bin={t.changeRate > 0 ? "bull" : t.changeRate < 0 ? "bear" : "neutral"}
                />
                {t.w > 30 && t.h > 18 && (
                  <text
                    x={t.x + t.w / 2}
                    y={t.y + t.h / 2}
                    textAnchor="middle"
                    className="fill-ink text-[10px] pointer-events-none"
                  >
                    {t.stockId}
                  </text>
                )}
              </g>
            ))}
          </g>
        ))}
      </svg>
      {hoveredTile && (
        <div
          className="absolute pointer-events-none bg-bg border border-line rounded px-2 py-1 text-xs text-ink shadow-lg"
          style={{ left: hoveredTile.x + hoveredTile.w + 4, top: hoveredTile.y }}
          role="tooltip"
        >
          <div className="font-medium">
            {hoveredTile.stockId} {hoveredTile.name}
          </div>
          <div className={hoveredTile.changeRate > 0 ? "text-red-500" : "text-green-500"}>
            {hoveredTile.changeRate >= 0 ? "+" : ""}
            {hoveredTile.changeRate.toFixed(2)}%
          </div>
          <div className="text-ink-dim">
            成交額 {(hoveredTile.totalAmount / 1e6).toFixed(1)}M
            {hoveredTile.marketValueIsFallback && (
              <span className="text-yellow-600 ml-1">(市值估)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
