import { useEffect, useMemo, useState } from "react";
import { useWarrants } from "../hooks/useWarrants";
import { useWarrantQuotes } from "../hooks/useWarrantQuotes";
import { useWarrantBrokers } from "../hooks/useWarrantBrokers";
import { WarrantIvHistory } from "./WarrantIvHistory";
import type { WarrantRow } from "../lib/warrant-data";
import {
  DEFAULT_FILTERS,
  filterWarrants,
  mergeWarrantRows,
  sortWarrants,
  type WarrantFilters,
  type WarrantSortKey,
} from "../lib/warrant-utils";
import { cn } from "../lib/utils";

// 欄位格式化:null/undefined 一律 em dash(數值缺席是常態 — 零成交/重設型)
function fmt(v: number | null | undefined, digits = 2): string {
  return v == null ? "—" : v.toFixed(digits);
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  const pct = v * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function fmtVol(price: number | null | undefined, vol: number | null | undefined): string {
  if (price == null) return "—";
  return `${price.toFixed(2)}/${vol ?? "—"}`;
}

const MISPRICING_TEXT = { cheap: "偏便宜", fair: "合理", expensive: "偏貴" } as const;
// IV 趨勢中性文案(warrant-iv-drift SC-6):只陳述統計事實,stable/insufficient
// 顯示 —(全表多數 stable,標出來是噪音);嚴禁「惡意」等指控性文字。
const DRIFT_TEXT: Record<string, string> = { declining: "長期遞減", rising: "長期遞增" };
// SC-5:中性色階,零色相 — accent 與 bull 同色值(#e85a4f,real-env 2026-07-11
// 實測),資料標籤用 accent 即是多頭紅。兩端用「實底 vs 框線」+ ink 強度區分。
const MISPRICING_CLASS = {
  cheap: "text-ink border-line-strong bg-ink/10",
  fair: "text-ink-dim border-transparent",
  expensive: "text-ink border-line-strong",
} as const;

interface SortableHeader {
  key: WarrantSortKey | null;
  label: string;
}

const HEADERS: SortableHeader[] = [
  { key: null, label: "代號" },
  { key: null, label: "名稱" },
  { key: null, label: "類型" },
  { key: null, label: "市場" },
  { key: "strike", label: "履約價" },
  { key: "moneyness", label: "價內外" },
  { key: "days_left", label: "剩餘天數" },
  { key: "exercise_ratio", label: "行使比例" },
  { key: "price", label: "現價" },
  { key: null, label: "買價/量" },
  { key: null, label: "賣價/量" },
  { key: "iv", label: "IV" },
  { key: "theo_price", label: "理論價" },
  { key: "mispricing_pct", label: "估價差" },
  { key: "iv_percentile", label: "IV百分位" },
  { key: null, label: "IV趨勢" },
  { key: "leverage", label: "實質槓桿" },
  { key: "spread_ratio", label: "價差比" },
  { key: "spread_lev_ratio", label: "差槓比" },
];

// 數字輸入(篩選列):空字串 = 未啟用(null)
function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function WarrantSelector({ symbol, active }: { symbol: string; active: boolean }) {
  const warrantsHook = useWarrants(symbol, active);
  const quotesHook = useWarrantQuotes(symbol, active);
  const [filters, setFilters] = useState<WarrantFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<WarrantSortKey>("spread_lev_ratio");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const brokersHook = useWarrantBrokers(expandedId);

  // 換標的:展開列與篩選歸零(舊標的殘留會誤導)
  useEffect(() => {
    setExpandedId(null);
    setFilters(DEFAULT_FILTERS);
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
      {/* 狀態列 + 篩選列 */}
      <div className="shrink-0 px-4 py-2 border-b border-line flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
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
            onChange={(e) =>
              setFilters((f) => ({ ...f, ivPctlMax: numOrNull(e.target.value) }))
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
                {HEADERS.map((h) => (
                  <th key={h.label} scope="col" className="px-2 py-1.5 text-right first:text-left font-normal">
                    {h.key ? (
                      <button
                        type="button"
                        onClick={() => handleSort(h.key!)}
                        className={cn(
                          "cursor-pointer hover:text-ink transition-colors",
                          sortKey === h.key && "text-accent",
                        )}
                      >
                        {h.label}
                        {sortKey === h.key && (sortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    ) : (
                      h.label
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
        <td className="px-2 py-1 text-left text-ink font-medium">{r.warrant_id}</td>
        <td className="px-2 py-1 text-left text-ink-muted">
          {r.name}
          {r.is_reset && (
            <span title="重設型:IV/估價不適用" aria-label="重設型" className="ml-1 text-ink-dim">
              ◇
            </span>
          )}
        </td>
        <td className="px-2 py-1 text-left">
          <span
            data-testid="warrant-kind-badge"
            className={cn(
              // SC-5:認購/認售不用紅綠(accent==bull 同色值)— 實底 vs 框線區分
              "inline-block px-1.5 py-px border text-[0.7rem]",
              r.kind === "call"
                ? "text-ink border-line-strong bg-ink/10"
                : "text-ink-muted border-line-strong",
            )}
          >
            {r.kind === "call" ? "認購" : "認售"}
          </span>
        </td>
        <td className="px-2 py-1 text-right text-ink-dim">
          {r.market === "twse" ? "上市" : "上櫃"}
        </td>
        <td className="px-2 py-1 text-right text-ink-muted">{fmt(r.strike)}</td>
        <td className="px-2 py-1 text-right text-ink-muted">{fmtPct(r.moneyness)}</td>
        <td className="px-2 py-1 text-right text-ink-muted">{r.days_left ?? "—"}</td>
        <td className="px-2 py-1 text-right text-ink-dim">{fmt(r.exercise_ratio, 4)}</td>
        <td className="px-2 py-1 text-right text-ink font-medium">{fmt(r.price)}</td>
        <td className="px-2 py-1 text-right text-ink-muted">
          {fmtVol(r.best_bid, r.best_bid_vol)}
        </td>
        <td className="px-2 py-1 text-right text-ink-muted">
          {fmtVol(r.best_ask, r.best_ask_vol)}
        </td>
        <td className="px-2 py-1 text-right text-ink-muted">
          {r.iv == null ? "—" : `${(r.iv * 100).toFixed(1)}%`}
        </td>
        <td className="px-2 py-1 text-right text-ink-muted">{fmt(r.theo_price)}</td>
        <td className="px-2 py-1 text-right">
          {r.mispricing_label ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-ink-muted">{fmtPct(r.mispricing_pct)}</span>
              <span
                data-testid="mispricing-label"
                className={cn(
                  "inline-block px-1 border text-[0.7rem]",
                  MISPRICING_CLASS[r.mispricing_label],
                )}
              >
                {MISPRICING_TEXT[r.mispricing_label]}
              </span>
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-2 py-1 text-right text-ink-muted">
          {r.iv_percentile == null ? "—" : r.iv_percentile.toFixed(0)}
        </td>
        <td className="px-2 py-1 text-right">
          <span data-testid="iv-drift-label" className="text-ink-muted">
            {(r.iv_drift && DRIFT_TEXT[r.iv_drift]) || "—"}
          </span>
        </td>
        <td className="px-2 py-1 text-right text-ink-muted">{fmt(r.leverage, 2)}</td>
        <td className="px-2 py-1 text-right text-ink-muted">{fmtPct(r.spread_ratio)}</td>
        <td className={cn("px-2 py-1 text-right", slrClass)}>
          {fmt(r.spread_lev_ratio, 4)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-bg-deep/50">
          <td colSpan={HEADERS.length + 1} className="px-8 py-2 space-y-3">
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
