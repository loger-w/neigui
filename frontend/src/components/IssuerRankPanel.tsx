import { useState } from "react";
import { useIssuerRank } from "../hooks/useIssuerRank";
import type { IssuerRankRow } from "../lib/warrant-data";
import { TIER_CLASS, TIER_TEXT } from "../lib/warrant-utils";
import { cn } from "../lib/utils";

// 發行商信任排行(warrant-selector-enhance SC-5)。
// 收合預設:排行計算在 backend lazy build,展開才觸發(enabled gate)。
// 文案鐵則:中性陳述,不用「推薦/建議」;不得自稱官方評等(僅對齊其權重方向)。

function pct(v: number | null, digits = 1): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function tierBadge(row: IssuerRankRow) {
  if (!row.tier) return <span className="text-ink-dim">—</span>;
  return (
    <span
      className={cn("inline-block px-1.5 py-px border text-[0.7rem]", TIER_CLASS[row.tier])}
    >
      {TIER_TEXT[row.tier]}
    </span>
  );
}

export function IssuerRankPanel() {
  const [open, setOpen] = useState(false);
  const { data, loading, error, refresh } = useIssuerRank(open);

  return (
    <div data-testid="issuer-rank-panel" className="shrink-0 border-b border-line text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-4 py-1.5 pointer-coarse:min-h-11 flex items-center gap-2 text-ink-muted hover:text-ink transition-colors cursor-pointer"
      >
        <span className="text-ink-dim">{open ? "▾" : "▸"}</span>
        發行商排行
        {data?.as_of_date && open && (
          <span className="text-ink-dim">基準日 {data.as_of_date}</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-2 space-y-1.5">
          <div className="text-ink-dim">
            以最近 {data?.built_from_days ?? "—"} 個交易日的收盤報價推算,三指標於
            (價內外 × 天期)層內取分位後聚合(低 = 佳,權重對齊 TWSE 評等方向;
            樣本不足 5 檔的層不計分)— 非官方盤中口徑,僅供排序參考;懸停欄位可見原始中位數
          </div>
          {loading && !data ? (
            <div className="text-ink-dim py-1">載入中...</div>
          ) : error ? (
            // 錯誤文案一律繁中(CLAUDE.md §3);原始 code 收在 title 供除錯
            <div className="text-accent py-1" title={error}>
              {error === "issuer_rank_not_ready"
                ? "排行資料尚未就緒(需累積 IV 歷史,約兩週)"
                : "排行載入失敗,請稍後重試"}
              <button
                type="button"
                onClick={refresh}
                className="ml-2 px-1.5 border border-line text-ink-muted hover:text-ink cursor-pointer"
              >
                重試
              </button>
            </div>
          ) : data ? (
            <table className="text-xs whitespace-nowrap">
              <thead>
                <tr className="text-ink-dim">
                  <th scope="col" className="pr-4 text-right font-normal">排名</th>
                  <th scope="col" className="pr-4 text-left font-normal">發行商</th>
                  <th scope="col" className="pr-4 text-left font-normal">評級</th>
                  <th scope="col" className="pr-4 text-right font-normal">IV分位</th>
                  <th scope="col" className="pr-4 text-right font-normal">價差分位</th>
                  <th scope="col" className="pr-4 text-right font-normal">降波分位</th>
                  <th scope="col" className="pr-4 text-right font-normal">計分/總檔數</th>
                </tr>
              </thead>
              <tbody>
                {data.issuers.map((r) => (
                  <tr key={r.issuer_id} className="text-ink-muted">
                    <td className="pr-4 text-right text-ink">{r.rank ?? "—"}</td>
                    <td className="pr-4">{r.issuer_name}</td>
                    <td className="pr-4">{tierBadge(r)}</td>
                    <td className="pr-4 text-right" title={`原始中位數 ${pct(r.iv_std_median)}`}>
                      {pct(r.iv_score)}
                    </td>
                    <td className="pr-4 text-right" title={`原始中位數 ${pct(r.spread_median)}`}>
                      {pct(r.spread_score)}
                    </td>
                    <td className="pr-4 text-right" title={`原始占比 ${pct(r.declining_share, 0)}`}>
                      {pct(r.declining_score)}
                    </td>
                    <td
                      className="pr-4 text-right text-ink-dim"
                      title={`覆蓋 ${r.n_strata} 層`}
                    >
                      {r.n_scored}/{r.n_warrants}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}
    </div>
  );
}
