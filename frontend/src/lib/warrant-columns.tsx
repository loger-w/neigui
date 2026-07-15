// 權證表欄位 registry — th/td 渲染的單一來源(mod/warrant-ux-feedback Commit 1)。
// 展開按鈕欄與展開列不在此(常駐結構,非資料欄);元件只負責迭代掛 DOM。

import type { ReactNode } from "react";
import type { WarrantRow } from "./warrant-data";
import {
  TIER_CLASS,
  TIER_TEXT,
  isExitCliff,
  isNearSoldOut,
  type WarrantSortKey,
} from "./warrant-utils";
import { cn } from "./utils";

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

export interface WarrantColumnCtx {
  /** 差槓比中性強度階(三分位 → ink 強度)— 由元件依當前 rows 計算注入 */
  slrClass: string;
}

export interface WarrantColumnDef {
  id: string;
  label: string;
  /** 欄位一行說明(欄位選單與 th title 共用) */
  desc: string;
  sortKey?: WarrantSortKey;
  /** 不可隱藏(表格 anchor 欄) */
  lockVisible?: boolean;
  /** 回傳完整 <td>(保留各欄 class / testid;caller 以 Fragment key 包) */
  cell: (row: WarrantRow, ctx: WarrantColumnCtx) => ReactNode;
}

export const WARRANT_COLUMNS: WarrantColumnDef[] = [
  {
    id: "warrant_id",
    label: "代號",
    desc: "權證代號;點左側 + 可展開 IV 時序與分點明細",
    lockVisible: true,
    cell: (r) => <td className="px-2 py-1 text-left text-ink font-medium">{r.warrant_id}</td>,
  },
  {
    id: "name",
    label: "名稱",
    desc: "權證名稱;◇ = 重設型(IV/估價不適用)",
    cell: (r) => (
      <td className="px-2 py-1 text-left text-ink-muted">
        {r.name}
        {r.is_reset && (
          <span title="重設型:IV/估價不適用" aria-label="重設型" className="ml-1 text-ink-dim">
            ◇
          </span>
        )}
      </td>
    ),
  },
  {
    id: "kind",
    label: "類型",
    desc: "認購(看多標的)/認售(看空標的)",
    cell: (r) => (
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
    ),
  },
  {
    id: "market",
    label: "市場",
    desc: "掛牌市場:上市(TWSE)/上櫃(TPEx)",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-dim">
        {r.market === "twse" ? "上市" : "上櫃"}
      </td>
    ),
  },
  {
    id: "issuer",
    label: "發行商",
    desc: "發行券商與信任分層(前段/中段/後段)",
    cell: (r) => (
      <td data-testid="issuer-cell" className="px-2 py-1 text-left">
        {r.issuer_name ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-ink-muted">{r.issuer_name}</span>
            {r.issuer_tier && (
              <span
                className={cn(
                  "inline-block px-1 border text-[0.7rem]",
                  TIER_CLASS[r.issuer_tier],
                )}
              >
                {TIER_TEXT[r.issuer_tier]}
              </span>
            )}
          </span>
        ) : (
          "—"
        )}
      </td>
    ),
  },
  {
    id: "strike",
    label: "履約價",
    desc: "行使權利的約定價格",
    sortKey: "strike",
    cell: (r) => <td className="px-2 py-1 text-right text-ink-muted">{fmt(r.strike)}</td>,
  },
  {
    id: "moneyness",
    label: "價內外",
    desc: "標的價相對履約價的偏離(正 = 價內,負 = 價外)",
    sortKey: "moneyness",
    cell: (r) => <td className="px-2 py-1 text-right text-ink-muted">{fmtPct(r.moneyness)}</td>,
  },
  {
    id: "days_left",
    label: "剩餘天數",
    desc: "距最後交易日的日曆日;≤21 日標「近到期」(出場品質懸崖)",
    sortKey: "days_left",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-muted">
        <span className="inline-flex items-center gap-1">
          {r.days_left ?? "—"}
          {isExitCliff(r.days_left) && (
            <span
              data-testid="cliff-badge"
              title="距最後交易日 ≤21 日曆日;法規:到期前 15 個交易日發行商可僅申報買進(出場品質懸崖)"
              className="inline-block px-1 border border-line-strong text-ink text-[0.7rem]"
            >
              近到期
            </span>
          )}
        </span>
      </td>
    ),
  },
  {
    id: "exercise_ratio",
    label: "行使比例",
    desc: "一張權證可換標的股數比",
    sortKey: "exercise_ratio",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-dim">{fmt(r.exercise_ratio, 4)}</td>
    ),
  },
  {
    id: "price",
    label: "現價",
    desc: "權證最新成交價",
    sortKey: "price",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink font-medium">{fmt(r.price)}</td>
    ),
  },
  {
    id: "bid",
    label: "買價/量",
    desc: "最佳委買價與掛單量",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-muted">
        {fmtVol(r.best_bid, r.best_bid_vol)}
      </td>
    ),
  },
  {
    id: "ask",
    label: "賣價/量",
    desc: "最佳委賣價與掛單量;委賣消失且委買仍在標「近售罄」",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-muted">
        <span className="inline-flex items-center gap-1">
          {fmtVol(r.best_ask, r.best_ask_vol)}
          {isNearSoldOut(r) && (
            <span
              data-testid="soldout-badge"
              title="委賣掛單消失且委買仍在:發行商庫存不足 10 張時僅掛委買,報價可能與標的脫鉤"
              className="inline-block px-1 border border-line-strong text-ink bg-ink/10 text-[0.7rem]"
            >
              近售罄
            </span>
          )}
        </span>
      </td>
    ),
  },
  {
    id: "iv",
    label: "IV",
    desc: "以委買/委賣中價反解的隱含波動率",
    sortKey: "iv",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-muted">
        {r.iv == null ? "—" : `${(r.iv * 100).toFixed(1)}%`}
      </td>
    ),
  },
  {
    id: "theo_price",
    label: "理論價",
    desc: "以昨日 IV 計算的 Black-Scholes 理論價",
    sortKey: "theo_price",
    cell: (r) => <td className="px-2 py-1 text-right text-ink-muted">{fmt(r.theo_price)}</td>,
  },
  {
    id: "mispricing",
    label: "估價差",
    desc: "現價相對理論價的偏離(±10% 內視為合理)",
    sortKey: "mispricing_pct",
    cell: (r) => (
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
    ),
  },
  {
    id: "iv_percentile",
    label: "IV百分位",
    desc: "目前 IV 在同標的全部權證中的百分位(低 = 相對便宜)",
    sortKey: "iv_percentile",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-muted">
        {r.iv_percentile == null ? "—" : r.iv_percentile.toFixed(0)}
      </td>
    ),
  },
  {
    id: "iv_drift",
    label: "IV趨勢",
    desc: "近 10 個交易日 IV 走勢(長期遞減/遞增;— = 平穩或樣本不足)",
    cell: (r) => (
      <td className="px-2 py-1 text-right">
        <span data-testid="iv-drift-label" className="text-ink-muted">
          {(r.iv_drift && DRIFT_TEXT[r.iv_drift]) || "—"}
        </span>
      </td>
    ),
  },
  {
    id: "leverage",
    label: "實質槓桿",
    desc: "標的漲跌 1% 時權證理論漲跌的倍數",
    sortKey: "leverage",
    cell: (r) => <td className="px-2 py-1 text-right text-ink-muted">{fmt(r.leverage, 2)}</td>,
  },
  {
    id: "spread_ratio",
    label: "價差比",
    desc: "委買賣價差佔委買價比例(低 = 進出成本低)",
    sortKey: "spread_ratio",
    cell: (r) => (
      <td className="px-2 py-1 text-right text-ink-muted">{fmtPct(r.spread_ratio)}</td>
    ),
  },
  {
    id: "slr",
    label: "差槓比",
    desc: "價差比 ÷ 實質槓桿(綜合成本效率,低 = 佳;預設排序欄)",
    sortKey: "spread_lev_ratio",
    cell: (r, ctx) => (
      <td className={cn("px-2 py-1 text-right", ctx.slrClass)}>
        {fmt(r.spread_lev_ratio, 4)}
      </td>
    ),
  },
];
