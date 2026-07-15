import { Fragment, useEffect, useMemo, useState } from "react";
import { useWarrants } from "../hooks/useWarrants";
import { useWarrantQuotes } from "../hooks/useWarrantQuotes";
import { useWarrantBrokers } from "../hooks/useWarrantBrokers";
import { WarrantIvHistory } from "./WarrantIvHistory";
import type { WarrantRow } from "../lib/warrant-data";
import { WARRANT_COLUMNS, type WarrantColumnCtx } from "../lib/warrant-columns";
import {
  DEFAULT_FILTERS,
  filterWarrants,
  mergeWarrantRows,
  sortWarrants,
  type WarrantFilters,
  type WarrantSortKey,
} from "../lib/warrant-utils";
import { cn } from "../lib/utils";

// 數字輸入(篩選列):空字串 = 未啟用(null)
function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// controlled input 顯示值:null → 空字串;小數比率 → % 整數避免浮點尾巴
function numVal(v: number | null): string {
  return v == null ? "" : String(v);
}

function pctVal(v: number | null): string {
  return v == null ? "" : String(Math.round(v * 1000) / 10);
}

export function WarrantSelector({ symbol, active }: { symbol: string; active: boolean }) {
  const warrantsHook = useWarrants(symbol, active);
  const quotesHook = useWarrantQuotes(symbol, active);
  const [filters, setFilters] = useState<WarrantFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<WarrantSortKey>("spread_lev_ratio");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const brokersHook = useWarrantBrokers(expandedId);
  // 篩選 input 用 defaultValue + epoch remount:controlled value 會沖掉
  // 「-」「0.」等打字中間態;重製 / 換標的靠 epoch 重掛同步顯示值
  const [filterEpoch, setFilterEpoch] = useState(0);

  // 換標的:展開列與篩選歸零(舊標的殘留會誤導)
  useEffect(() => {
    setExpandedId(null);
    setFilters(DEFAULT_FILTERS);
    setFilterEpoch((e) => e + 1);
  }, [symbol]);

  const rows: WarrantRow[] = useMemo(() => {
    const terms = warrantsHook.data?.warrants ?? [];
    const merged = mergeWarrantRows(terms, quotesHook.data?.quotes ?? {});
    return sortWarrants(filterWarrants(merged, filters), sortKey, sortDir);
  }, [warrantsHook.data, quotesHook.data, filters, sortKey, sortDir]);

  // 差槓比中性強度階(SC-5):非 null 值三分位 → ink 強度,不用紅綠
  const slrTerciles = useMemo(() => {
    const vals = rows
      .map((r) => r.spread_lev_ratio)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (vals.length < 3) return null;
    return [vals[Math.floor(vals.length / 3)]!, vals[Math.floor((vals.length * 2) / 3)]!];
  }, [rows]);

  const slrClass = (v: number | null | undefined): string => {
    if (v == null || slrTerciles == null) return "text-ink-muted";
    if (v <= slrTerciles[0]!) return "text-ink font-medium";
    if (v <= slrTerciles[1]!) return "text-ink-muted";
    return "text-ink-dim";
  };

  const handleSort = (key: WarrantSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (!symbol) {
    return (
      <div className="h-full flex items-center justify-center text-ink-dim text-sm">
        請先搜尋標的後挑選權證
      </div>
    );
  }

  const totalCount = warrantsHook.data?.warrants.length ?? 0;
  const error = warrantsHook.error || quotesHook.error;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 狀態列 + 篩選列(key=epoch:preset/換標的時 remount 讓 defaultValue 生效) */}
      <div
        key={filterEpoch}
        className="shrink-0 px-4 py-2 border-b border-line flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
      >
        <span className="text-ink-dim">
          {warrantsHook.asOfDate && `快照基準日 ${warrantsHook.asOfDate}`}
          {quotesHook.quoteTime && `・最後更新 ${quotesHook.quoteTime}`}
        </span>
        <button
          type="button"
          onClick={() => quotesHook.refresh()}
          disabled={quotesHook.loading}
          aria-label="重新整理權證報價"
          className="px-2 py-1 pointer-coarse:min-h-11 border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 transition-colors cursor-pointer"
        >
          重新整理
        </button>
        <button
          type="button"
          data-testid="filter-reset-btn"
          onClick={() => {
            setFilters(DEFAULT_FILTERS);
            setSortKey("spread_lev_ratio");
            setSortDir("asc");
            setFilterEpoch((e) => e + 1);
          }}
          aria-label="重製篩選"
          title="清除全部篩選條件並將排序恢復預設(差槓比升序)"
          className="px-2 py-1 pointer-coarse:min-h-11 border border-line text-ink-muted hover:text-ink hover:border-accent transition-colors cursor-pointer"
        >
          重製篩選
        </button>
        <div className="inline-flex items-stretch" role="group" aria-label="類型篩選">
          {(
            [
              ["all", "全部"],
              ["call", "認購"],
              ["put", "認售"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, kind: k }))}
              className={cn(
                "px-2 py-1 pointer-coarse:min-h-11 border border-line -ml-px first:ml-0 transition-colors cursor-pointer",
                filters.kind === k
                  ? "text-accent border-accent relative z-10"
                  : "text-ink-dim hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          剩餘天數 ≥
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="剩餘天數下限"
            defaultValue={numVal(filters.minDaysLeft)}
            onChange={(e) =>
              setFilters((f) => ({ ...f, minDaysLeft: numOrNull(e.target.value) }))
            }
          />
        </label>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          價內外%
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="價內外下限(%)"
            placeholder="min"
            defaultValue={pctVal(filters.moneynessMin)}
            onChange={(e) => {
              const n = numOrNull(e.target.value);
              setFilters((f) => ({ ...f, moneynessMin: n == null ? null : n / 100 }));
            }}
          />
          ~
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="價內外上限(%)"
            placeholder="max"
            defaultValue={pctVal(filters.moneynessMax)}
            onChange={(e) => {
              const n = numOrNull(e.target.value);
              setFilters((f) => ({ ...f, moneynessMax: n == null ? null : n / 100 }));
            }}
          />
        </label>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          估價差%
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="估價差下限(%)"
            placeholder="min"
            defaultValue={pctVal(filters.mispricingMin)}
            onChange={(e) => {
              const n = numOrNull(e.target.value);
              setFilters((f) => ({ ...f, mispricingMin: n == null ? null : n / 100 }));
            }}
          />
          ~
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="估價差上限(%)"
            placeholder="max"
            defaultValue={pctVal(filters.mispricingMax)}
            onChange={(e) => {
              const n = numOrNull(e.target.value);
              setFilters((f) => ({ ...f, mispricingMax: n == null ? null : n / 100 }));
            }}
          />
        </label>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          IV百分位 ≤
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="IV百分位上限"
            defaultValue={numVal(filters.ivPctlMax)}
            onChange={(e) =>
              setFilters((f) => ({ ...f, ivPctlMax: numOrNull(e.target.value) }))
            }
          />
        </label>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          價差比% ≤
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="價差比上限(%)"
            defaultValue={pctVal(filters.spreadRatioMax)}
            onChange={(e) => {
              const n = numOrNull(e.target.value);
              setFilters((f) => ({ ...f, spreadRatioMax: n == null ? null : n / 100 }));
            }}
          />
        </label>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          差槓比 ≤
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="差槓比上限"
            defaultValue={numVal(filters.slrMax)}
            onChange={(e) => setFilters((f) => ({ ...f, slrMax: numOrNull(e.target.value) }))}
          />
        </label>
        <label className="inline-flex items-center gap-1 text-ink-muted">
          委賣價 ≥
          <input
            type="number"
            className="w-14 bg-bg-deep border border-line px-1 py-0.5 text-ink"
            aria-label="委賣價下限"
            defaultValue={numVal(filters.minAskPrice)}
            onChange={(e) =>
              setFilters((f) => ({ ...f, minAskPrice: numOrNull(e.target.value) }))
            }
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={filters.requireBidVol}
            aria-label="只看委買量大於零"
            onChange={(e) =>
              setFilters((f) => ({ ...f, requireBidVol: e.target.checked }))
            }
          />
          委買量&gt;0
        </label>
        {totalCount > 0 && (
          <span className="text-ink-dim ml-auto">
            {rows.length}/{totalCount} 檔
          </span>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {warrantsHook.loading && totalCount === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-dim text-sm">
            載入權證資料...
          </div>
        ) : totalCount === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-dim text-sm">
            此標的無掛牌權證
          </div>
        ) : (
          <table className="w-max min-w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-line-strong text-ink-dim">
                <th className="px-2 py-1.5" aria-label="展開" />
                {WARRANT_COLUMNS.map((c) => (
                  <th key={c.id} scope="col" className="px-2 py-1.5 text-right first:text-left font-normal">
                    {c.sortKey ? (
                      <button
                        type="button"
                        onClick={() => handleSort(c.sortKey!)}
                        className={cn(
                          "cursor-pointer hover:text-ink transition-colors",
                          sortKey === c.sortKey && "text-accent",
                        )}
                      >
                        {c.label}
                        {sortKey === c.sortKey && (sortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RowPair
                  key={r.warrant_id}
                  row={r}
                  expanded={expandedId === r.warrant_id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === r.warrant_id ? null : r.warrant_id))
                  }
                  slrClass={slrClass(r.spread_lev_ratio)}
                  brokersHook={expandedId === r.warrant_id ? brokersHook : null}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RowPair({
  row: r,
  expanded,
  onToggle,
  slrClass,
  brokersHook,
}: {
  row: WarrantRow;
  expanded: boolean;
  onToggle: () => void;
  slrClass: string;
  brokersHook: ReturnType<typeof useWarrantBrokers> | null;
}) {
  const ctx: WarrantColumnCtx = { slrClass };
  return (
    <>
      <tr
        data-testid="warrant-row"
        data-warrant-id={r.warrant_id}
        className="border-b border-line hover:bg-bg-deep transition-colors"
      >
        <td className="px-2 py-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`展開分點 ${r.name}`}
            className="w-5 h-5 pointer-coarse:min-h-11 inline-flex items-center justify-center text-ink-dim hover:text-accent cursor-pointer transition-colors"
          >
            {expanded ? "−" : "+"}
          </button>
        </td>
        {WARRANT_COLUMNS.map((c) => (
          <Fragment key={c.id}>{c.cell(r, ctx)}</Fragment>
        ))}
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-bg-deep/50">
          <td colSpan={WARRANT_COLUMNS.length + 1} className="px-8 py-2 space-y-3">
            <div className="text-xs">
              <WarrantIvHistory warrantId={r.warrant_id} />
            </div>
            <div data-testid="warrant-brokers-detail" className="text-xs">
              {brokersHook?.loading ? (
                <span className="text-ink-dim">載入分點資料...</span>
              ) : brokersHook?.error ? (
                <span className="text-accent">{brokersHook.error}</span>
              ) : brokersHook?.data && brokersHook.data.rows.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-ink-dim">
                    分點買賣超(資料日 = {brokersHook.dataDate},T-1)
                  </div>
                  <table className="text-xs">
                    <thead>
                      <tr className="text-ink-dim">
                        <th scope="col" className="pr-4 text-left font-normal">分點</th>
                        <th scope="col" className="pr-4 text-right font-normal">買進</th>
                        <th scope="col" className="pr-4 text-right font-normal">賣出</th>
                        <th scope="col" className="pr-4 text-right font-normal">買賣超</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* key 帶 index:真實 FinMind 分點同名可重複(彰銀買賣
                          兩列,2026-07-11 real-env 實測)— 純名字 key 會撞 */}
                      {brokersHook.data.rows.map((b, i) => (
                        <tr key={`${b.broker_name}-${i}`} className="text-ink-muted">
                          <td className="pr-4">{b.broker_name}</td>
                          <td className="pr-4 text-right">{b.buy}</td>
                          <td className="pr-4 text-right">{b.sell}</td>
                          <td className="pr-4 text-right text-ink">{b.net}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <span className="text-ink-dim">近 5 個交易日無分點報表資料</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
