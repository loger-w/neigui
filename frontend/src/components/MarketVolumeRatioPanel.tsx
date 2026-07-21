import { useState, type ReactElement } from "react";
import { changeColorClass, formatAmount, formatRatio, signedPercent } from "../lib/market-format";
import type { BreadthRow } from "../lib/market-types";

type Props = {
  rows: BreadthRow[] | null;
  loading: boolean;
  onSymbolPick: (stockId: string) => void;
};

type SortKey = "volume_ratio" | "change_rate" | "amount";

const DEFAULT_THRESHOLD = 1.5;
const MARKET_LABEL = { twse: "上市", tpex: "上櫃" } as const;
/** SC-6:可排序欄定義 — 點欄位標題設定排序鍵(降序),取代舊 toggle 鈕。 */
const SORT_COLUMNS: readonly [SortKey, string][] = [
  ["change_rate", "漲跌"],
  ["volume_ratio", "量比"],
  ["amount", "成交額"],
];

/** MK-6(mod/batch-ui-update):經典檢視退役後保留的量比功能 — 門檻(預設
 * 1.5)過濾出全部符合個股(非 top30),點欄位標題排序,點列跳 equity。 */
export function MarketVolumeRatioPanel({ rows, loading, onSymbolPick }: Props): ReactElement {
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [sortKey, setSortKey] = useState<SortKey>("volume_ratio");

  let body: ReactElement;
  if (loading) {
    body = (
      <div data-state="loading" role="status" aria-label="載入中" className="flex flex-col gap-1 mt-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (rows === null) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs mt-2">
        資料暫缺
      </div>
    );
  } else {
    const matched = rows
      .filter((r): r is BreadthRow & { volume_ratio: number } =>
        r.volume_ratio !== null && r.volume_ratio >= threshold,
      )
      .sort((a, b) =>
        sortKey === "volume_ratio"
          ? b.volume_ratio - a.volume_ratio
          : sortKey === "change_rate"
            ? b.change_rate - a.change_rate
            : b.total_amount - a.total_amount,
      );
    body = (
      <div className="flex flex-col min-h-0 mt-2 text-xs gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="inline-flex items-center gap-1 text-ink-muted">
            量比 ≥
            <input
              type="number"
              aria-label="量比門檻"
              step={0.1}
              min={0}
              value={threshold}
              onChange={(e) => {
                const n = Number(e.target.value);
                setThreshold(Number.isFinite(n) ? n : DEFAULT_THRESHOLD);
              }}
              className="w-16 h-6 px-1 bg-bg border border-line text-ink tabular-nums focus:outline-none focus:border-accent"
            />
          </label>
          <span className="text-ink-dim">{matched.length} 檔</span>
        </div>
        {matched.length === 0 ? (
          <div className="text-ink-dim">無符合門檻的個股</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg">
                <tr className="text-ink-dim text-left">
                  <th className="font-normal">代號/名稱</th>
                  <th className="font-normal">市場</th>
                  {SORT_COLUMNS.map(([key, label]) => {
                    const active = sortKey === key;
                    return (
                      <th
                        key={key}
                        className="font-normal text-right"
                        aria-sort={active ? "descending" : undefined}
                      >
                        <button
                          type="button"
                          aria-label={`依${label}排序`}
                          onClick={() => setSortKey(key)}
                          className={`cursor-pointer hover:text-ink ${
                            active ? "text-accent" : ""
                          }`}
                        >
                          {label}
                          <span aria-hidden="true" className="ml-0.5">
                            {active ? "▾" : ""}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matched.map((r) => (
                  <tr
                    key={r.stock_id}
                    data-testid={`vr-row-${r.stock_id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSymbolPick(r.stock_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSymbolPick(r.stock_id);
                      }
                    }}
                    className="cursor-pointer hover:bg-bg-deep/50"
                  >
                    <td className="text-ink">
                      {r.stock_id} {r.name}
                    </td>
                    <td className="text-ink-dim">{MARKET_LABEL[r.market]}</td>
                    <td className={`text-right ${changeColorClass(r.change_rate)}`}>
                      {signedPercent(r.change_rate)}
                    </td>
                    <td className="text-right text-ink tabular-nums">{formatRatio(r.volume_ratio)}</td>
                    <td className="text-right text-ink-dim tabular-nums">
                      {formatAmount(r.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <section data-testid="market-volume-ratio" className="flex flex-col min-h-0 p-3">
      <h3 className="text-ink text-sm">量比排行</h3>
      {body}
    </section>
  );
}
