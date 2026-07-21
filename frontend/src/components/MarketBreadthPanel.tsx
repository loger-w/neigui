import { useState, type ReactElement } from "react";
import { changeColorClass, signedPercent } from "../lib/market-format";
import type { Breadth, BreadthCounts, BreadthRow } from "../lib/market-types";

type Props = {
  data: Breadth | null;
  loading: boolean;
  onSymbolPick: (stockId: string) => void;
  /** SC-4:內嵌大盤強弱卡時去 section 外框(border/padding),標題縮小。 */
  embedded?: boolean;
};

type ListTarget = { market: "twse" | "tpex"; kind: "limit_up" | "limit_down" };

const MARKET_LABEL = { twse: "上市", tpex: "上櫃" } as const;
const KIND_LABEL = { limit_up: "漲停", limit_down: "跌停" } as const;

/** MK-5(mod/batch-ui-update):上市/上櫃 漲跌家數;漲停/跌停 bucket 可點開
 * 該清單(interactive bucket 用底線提示),點個股跳 equity。 */
function CountsRow({
  market,
  counts,
  target,
  onToggleList,
}: {
  market: "twse" | "tpex";
  counts: BreadthCounts;
  target: ListTarget | null;
  onToggleList: (t: ListTarget) => void;
}): ReactElement {
  return (
    <div data-testid={`breadth-${market}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-ink w-8 shrink-0">{MARKET_LABEL[market]}</span>
      {(["limit_up", "limit_down"] as const).map((kind) => {
        const active = target?.market === market && target.kind === kind;
        const cls = kind === "limit_up" ? "text-bull" : "text-bear";
        return (
          <button
            key={kind}
            type="button"
            aria-label={`${MARKET_LABEL[market]}${KIND_LABEL[kind]}清單`}
            aria-expanded={active}
            onClick={() => onToggleList({ market, kind })}
            className={`${cls} underline decoration-dotted underline-offset-2 cursor-pointer hover:opacity-80 tabular-nums`}
          >
            {KIND_LABEL[kind]} {counts[kind]}
          </button>
        );
      })}
      <span className="text-bull tabular-nums">上漲 {counts.up}</span>
      <span className="text-ink-dim tabular-nums">平盤 {counts.flat}</span>
      <span className="text-bear tabular-nums">下跌 {counts.down}</span>
    </div>
  );
}

export function MarketBreadthPanel({ data, loading, onSymbolPick, embedded }: Props): ReactElement {
  const [target, setTarget] = useState<ListTarget | null>(null);

  const toggleList = (t: ListTarget): void => {
    setTarget((cur) =>
      cur?.market === t.market && cur.kind === t.kind ? null : t,
    );
  };

  let body: ReactElement;
  if (loading) {
    body = (
      <div data-state="loading" role="status" aria-label="載入中" className="flex flex-col gap-1 mt-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (data === null) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs mt-2">
        資料暫缺
      </div>
    );
  } else {
    const listRows: BreadthRow[] = target
      ? data.rows.filter(
          (r) =>
            r.market === target.market &&
            (target.kind === "limit_up" ? r.limit_up : r.limit_down),
        )
      : [];
    body = (
      <div className="flex flex-col gap-2 mt-2 text-xs">
        <CountsRow market="twse" counts={data.twse} target={target} onToggleList={toggleList} />
        <CountsRow market="tpex" counts={data.tpex} target={target} onToggleList={toggleList} />
        {target && (
          <div data-testid="breadth-list" className="mt-1 pl-2 border-l border-line">
            <div className="text-ink-dim text-[0.625rem] mb-1">
              {MARKET_LABEL[target.market]}
              {KIND_LABEL[target.kind]}清單({listRows.length})
            </div>
            {listRows.length === 0 ? (
              <div className="text-ink-dim">無個股</div>
            ) : (
              <ul className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                {listRows.map((r) => (
                  <li key={r.stock_id}>
                    <button
                      type="button"
                      data-testid={`breadth-stock-${r.stock_id}`}
                      onClick={() => onSymbolPick(r.stock_id)}
                      className="w-full flex items-center justify-between gap-2 text-left hover:text-ink cursor-pointer"
                    >
                      <span className="text-ink truncate">
                        {r.stock_id} {r.name}
                      </span>
                      <span className={changeColorClass(r.change_rate)}>
                        {signedPercent(r.change_rate)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      data-testid="market-breadth"
      className={
        embedded
          ? "flex flex-col min-h-0 mt-3 pt-2 border-t border-line"
          : "flex flex-col min-h-0 p-3 border-r border-line"
      }
    >
      <h3 className={embedded ? "text-ink-dim text-xs" : "text-ink text-sm"}>漲跌家數</h3>
      {body}
    </section>
  );
}
