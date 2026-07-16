import { Fragment, useEffect, useMemo, useState } from "react";
import { useWarrants } from "../hooks/useWarrants";
import { useWarrantQuotes } from "../hooks/useWarrantQuotes";
import { WarrantIvHistory } from "./WarrantIvHistory";
import { WarrantColumnMenu } from "./WarrantColumnMenu";
import { Checkbox } from "./ui/checkbox";
import { NumberField } from "./ui/number-field";
import type { WarrantRow } from "../lib/warrant-data";
import {
  WARRANT_COLUMNS,
  type WarrantColumnCtx,
  type WarrantColumnDef,
} from "../lib/warrant-columns";
import {
  loadColumnPrefs,
  saveColumnPrefs,
  type ColumnPrefs,
} from "../lib/warrant-column-prefs";
import {
  DEFAULT_FILTERS,
  extractIssuer,
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

const REGISTRY_IDS = WARRANT_COLUMNS.map((c) => c.id);
const LOCKED_IDS = WARRANT_COLUMNS.filter((c) => c.lockVisible).map((c) => c.id);
const COLUMN_BY_ID = new Map(WARRANT_COLUMNS.map((c) => [c.id, c]));

export function WarrantSelector({ symbol, active }: { symbol: string; active: boolean }) {
  const warrantsHook = useWarrants(symbol, active);
  const quotesHook = useWarrantQuotes(symbol, active);
  const [filters, setFilters] = useState<WarrantFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<WarrantSortKey>("spread_lev_ratio");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 篩選 input 用 defaultValue + epoch remount:controlled value 會沖掉
  // 「-」「0.」等打字中間態;重製 / 換標的靠 epoch 重掛同步顯示值
  const [filterEpoch, setFilterEpoch] = useState(0);
  // 欄位偏好 = 全域設定(localStorage),不隨標的 reset(白名單 5)
  const [colPrefs, setColPrefs] = useState<ColumnPrefs>(() =>
    loadColumnPrefs(REGISTRY_IDS, LOCKED_IDS),
  );
  const handleColPrefs = (p: ColumnPrefs) => {
    setColPrefs(p);
    saveColumnPrefs(p);
  };
  const visibleColumns = useMemo(() => {
    const hidden = new Set(colPrefs.hidden);
    return colPrefs.order
      .filter((id) => !hidden.has(id))
      .map((id) => COLUMN_BY_ID.get(id))
      .filter((c): c is WarrantColumnDef => c != null);
  }, [colPrefs]);

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

  // 發行商下拉選項:從 terms 推導(不隨其他篩選縮減);.sort() 走 code point,
  // 跨環境 deterministic(localeCompare 依 ICU 而異)
  const issuers = useMemo(() => {
    const found = new Set<string>();
    for (const t of warrantsHook.data?.warrants ?? []) {
      const issuer = extractIssuer(t.name);
      if (issuer) found.add(issuer);
    }
    return Array.from(found).sort();
  }, [warrantsHook.data]);

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
        <WarrantColumnMenu columns={WARRANT_COLUMNS} prefs={colPrefs} onChange={handleColPrefs} />
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
          發行商
          <select
            aria-label="發行商篩選"
            value={filters.issuer ?? "all"}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                issuer: e.target.value === "all" ? null : e.target.value,
              }))
            }
            className="border border-line text-ink px-2 py-1 pointer-coarse:min-h-11 bg-bg cursor-pointer"
          >
            <option value="all">全部</option>
            {issuers.map((issuer) => (
              <option key={issuer} value={issuer}>
                {issuer}
              </option>
            ))}
          </select>
        </label>
        {/* 期限/位階群組 */}
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2 pl-3 border-l border-line">
          <label className="inline-flex items-center gap-1 text-ink-muted">
            剩餘天數 ≥
            <NumberField
              ariaLabel="剩餘天數下限"
              name="minDaysLeft"
              step={10}
              defaultValue={numVal(filters.minDaysLeft)}
              onValueChange={(raw) =>
                setFilters((f) => ({ ...f, minDaysLeft: numOrNull(raw) }))
              }
            />
          </label>
          <label className="inline-flex items-center gap-1 text-ink-muted">
            價內外%
            <NumberField
              ariaLabel="價內外下限(%)"
              name="moneynessMin"
              placeholder="min"
              defaultValue={pctVal(filters.moneynessMin)}
              onValueChange={(raw) => {
                const n = numOrNull(raw);
                setFilters((f) => ({ ...f, moneynessMin: n == null ? null : n / 100 }));
              }}
            />
            ~
            <NumberField
              ariaLabel="價內外上限(%)"
              name="moneynessMax"
              placeholder="max"
              defaultValue={pctVal(filters.moneynessMax)}
              onValueChange={(raw) => {
                const n = numOrNull(raw);
                setFilters((f) => ({ ...f, moneynessMax: n == null ? null : n / 100 }));
              }}
            />
          </label>
        </span>
        {/* 估值/成本群組 */}
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2 pl-3 border-l border-line">
          <label className="inline-flex items-center gap-1 text-ink-muted">
            估價差%
            <NumberField
              ariaLabel="估價差下限(%)"
              name="mispricingMin"
              placeholder="min"
              defaultValue={pctVal(filters.mispricingMin)}
              onValueChange={(raw) => {
                const n = numOrNull(raw);
                setFilters((f) => ({ ...f, mispricingMin: n == null ? null : n / 100 }));
              }}
            />
            ~
            <NumberField
              ariaLabel="估價差上限(%)"
              name="mispricingMax"
              placeholder="max"
              defaultValue={pctVal(filters.mispricingMax)}
              onValueChange={(raw) => {
                const n = numOrNull(raw);
                setFilters((f) => ({ ...f, mispricingMax: n == null ? null : n / 100 }));
              }}
            />
          </label>
          <label className="inline-flex items-center gap-1 text-ink-muted">
            IV百分位 ≤
            <NumberField
              ariaLabel="IV百分位上限"
              name="ivPctlMax"
              step={5}
              defaultValue={numVal(filters.ivPctlMax)}
              onValueChange={(raw) =>
                setFilters((f) => ({ ...f, ivPctlMax: numOrNull(raw) }))
              }
            />
          </label>
          <label className="inline-flex items-center gap-1 text-ink-muted">
            價差比% ≤
            <NumberField
              ariaLabel="價差比上限(%)"
              name="spreadRatioMax"
              step={0.5}
              defaultValue={pctVal(filters.spreadRatioMax)}
              onValueChange={(raw) => {
                const n = numOrNull(raw);
                setFilters((f) => ({ ...f, spreadRatioMax: n == null ? null : n / 100 }));
              }}
            />
          </label>
          <label className="inline-flex items-center gap-1 text-ink-muted">
            差槓比 ≤
            <NumberField
              ariaLabel="差槓比上限"
              name="slrMax"
              step={0.05}
              defaultValue={numVal(filters.slrMax)}
              onValueChange={(raw) => setFilters((f) => ({ ...f, slrMax: numOrNull(raw) }))}
            />
          </label>
        </span>
        {/* 流動性群組 */}
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2 pl-3 border-l border-line">
          <label className="inline-flex items-center gap-1 text-ink-muted">
            委賣價 ≥
            <NumberField
              ariaLabel="委賣價下限"
              name="minAskPrice"
              step={0.1}
              defaultValue={numVal(filters.minAskPrice)}
              onValueChange={(raw) =>
                setFilters((f) => ({ ...f, minAskPrice: numOrNull(raw) }))
              }
            />
          </label>
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <Checkbox
              checked={filters.requireBidVol}
              aria-label="只看委買量大於零"
              onCheckedChange={(checked) =>
                setFilters((f) => ({ ...f, requireBidVol: checked }))
              }
            />
            委買量&gt;0
          </span>
        </span>
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
                {visibleColumns.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    title={c.desc}
                    className={cn(
                      "px-2 py-1.5 font-normal",
                      c.align === "left" ? "text-left" : "text-right",
                    )}
                  >
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
                  columns={visibleColumns}
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
  columns,
}: {
  row: WarrantRow;
  expanded: boolean;
  onToggle: () => void;
  slrClass: string;
  columns: WarrantColumnDef[];
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
            aria-label={`展開明細 ${r.name}`}
            className="w-5 h-5 pointer-coarse:min-h-11 inline-flex items-center justify-center text-ink-dim hover:text-accent cursor-pointer transition-colors"
          >
            {expanded ? "−" : "+"}
          </button>
        </td>
        {columns.map((c) => (
          <Fragment key={c.id}>{c.cell(r, ctx)}</Fragment>
        ))}
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-bg-deep/50">
          <td colSpan={columns.length + 1} className="px-8 py-2">
            <div className="text-xs">
              <WarrantIvHistory warrantId={r.warrant_id} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
