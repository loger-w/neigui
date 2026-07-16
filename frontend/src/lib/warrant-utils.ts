// 權證表格純函式層(filter / sort / 開盤判定 / merge)— 元件只負責掛 DOM。

import type { WarrantQuote, WarrantRow, WarrantTerm } from "./warrant-data";

/** 前端輪詢間隔;> backend QUOTES_COOLDOWN_SEC=10s(SC-3 常數對齊)。 */
export const QUOTES_REFETCH_MS = 15_000;

const TAIPEI_OPEN_MIN = 9 * 60;
// 13:35 inclusive:收盤撮合 13:30 後緩衝(impl-R6 定案)
const TAIPEI_CLOSE_MIN = 13 * 60 + 35;

/** 台灣權證發行商 2 字簡稱名單(現役為主,對權證簡稱內嵌字樣;
 * 名單外新券商抽不出 → 該權證僅在「全部」可見,graceful degradation)。 */
export const WARRANT_ISSUERS = [
  "元大", "凱基", "統一", "群益", "富邦", "永豐", "國泰", "兆豐",
  "中信", "元富", "永昌", "玉山", "台新", "國票", "康和", "宏遠",
] as const;

const ISSUER_SET: ReadonlySet<string> = new Set(WARRANT_ISSUERS);

/** 權證簡稱抽發行商:標準格式 = 標的簡稱 2 字 + 發行商 2 字(index 2 起),
 * 3 字標的簡稱時發行商順延至 index 3 — 從 index 2 起掃描全名取首個命中。
 * index 0/1 不掃:標的自身撞名(國泰金/富邦金等金控標的)靠起點排除。 */
export function extractIssuer(name: string): string | null {
  for (let i = 2; i + 2 <= name.length; i++) {
    const cand = name.slice(i, i + 2);
    if (ISSUER_SET.has(cand)) return cand;
  }
  return null;
}

export interface WarrantFilters {
  kind: "all" | "call" | "put";
  issuer: string | null;
  minDaysLeft: number | null;
  moneynessMin: number | null;
  moneynessMax: number | null;
  requireBidVol: boolean;
  mispricingMin: number | null;
  mispricingMax: number | null;
  ivPctlMax: number | null;
  spreadRatioMax: number | null;
  slrMax: number | null;
  minAskPrice: number | null;
}

export const DEFAULT_FILTERS: WarrantFilters = {
  kind: "all",
  issuer: null,
  minDaysLeft: null,
  moneynessMin: null,
  moneynessMax: null,
  requireBidVol: false,
  mispricingMin: null,
  mispricingMax: null,
  ivPctlMax: null,
  spreadRatioMax: null,
  slrMax: null,
  minAskPrice: null,
};

/** ≈ 法規「到期前 15 個交易日可僅申報買進」的日曆日 proxy(change-spec SC-8)。 */
export const EXIT_CLIFF_DAYS = 21;

export function isExitCliff(daysLeft: number | null | undefined): boolean {
  return daysLeft != null && daysLeft <= EXIT_CLIFF_DAYS;
}

/** 委賣消失 + 委買仍在 = 近售罄(庫存 <10 張只掛買);懸崖區內抑制 —
 * 近到期發行商可合法只買,不可誤判(change-spec SC-9 confounder)。 */
export function isNearSoldOut(r: WarrantRow): boolean {
  if (isExitCliff(r.days_left)) return false;
  const askGone = r.best_ask == null || r.best_ask === 0;
  const bidAlive = r.best_bid != null && r.best_bid > 0;
  return askGone && bidAlive;
}

// 啟用中的 filter 對 null/undefined 欄位一律剔除(SC-4:選了條件就只看
// 有值的列);未啟用(null/false)不剔。
export function filterWarrants(rows: WarrantRow[], f: WarrantFilters): WarrantRow[] {
  return rows.filter((r) => {
    if (f.kind !== "all" && r.kind !== f.kind) return false;
    if (f.issuer !== null && extractIssuer(r.name) !== f.issuer) return false;
    if (f.minDaysLeft !== null && (r.days_left == null || r.days_left < f.minDaysLeft)) {
      return false;
    }
    if (f.moneynessMin !== null && (r.moneyness == null || r.moneyness < f.moneynessMin)) {
      return false;
    }
    if (f.moneynessMax !== null && (r.moneyness == null || r.moneyness > f.moneynessMax)) {
      return false;
    }
    if (f.requireBidVol && !(r.best_bid_vol != null && r.best_bid_vol > 0)) return false;
    if (
      f.mispricingMin !== null &&
      (r.mispricing_pct == null || r.mispricing_pct < f.mispricingMin)
    ) {
      return false;
    }
    if (
      f.mispricingMax !== null &&
      (r.mispricing_pct == null || r.mispricing_pct > f.mispricingMax)
    ) {
      return false;
    }
    if (f.ivPctlMax !== null && (r.iv_percentile == null || r.iv_percentile > f.ivPctlMax)) {
      return false;
    }
    if (f.spreadRatioMax !== null && (r.spread_ratio == null || r.spread_ratio > f.spreadRatioMax)) {
      return false;
    }
    if (f.slrMax !== null && (r.spread_lev_ratio == null || r.spread_lev_ratio > f.slrMax)) {
      return false;
    }
    if (f.minAskPrice !== null && (r.best_ask == null || r.best_ask < f.minAskPrice)) {
      return false;
    }
    return true;
  });
}

export type WarrantSortKey =
  | "strike"
  | "moneyness"
  | "days_left"
  | "exercise_ratio"
  | "price"
  | "iv"
  | "theo_price"
  | "mispricing_pct"
  | "iv_percentile"
  | "leverage"
  | "spread_ratio"
  | "spread_lev_ratio";

export function sortWarrants(
  rows: WarrantRow[],
  key: WarrantSortKey,
  dir: "asc" | "desc",
): WarrantRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    // null/undefined 恆沉底,不論方向(SC-2 預設差槓比 asc 時無值不得置頂)
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * sign;
  });
}

export function isMarketOpen(d: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  // hour12:false + 2-digit 在午夜可能給 "24"(spec 允許),%24 歸零
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return mins >= TAIPEI_OPEN_MIN && mins <= TAIPEI_CLOSE_MIN;
}

/** useWarrantQuotes 的 refetchInterval 函式本體(純函式,兩分支測試鎖 impl-R8)。 */
export function quotesRefetchInterval(d: Date): number | false {
  return isMarketOpen(d) ? QUOTES_REFETCH_MS : false;
}

export function mergeWarrantRows(
  terms: WarrantTerm[],
  quotesById: Record<string, WarrantQuote>,
): WarrantRow[] {
  return terms.map((t) => {
    const q = quotesById[t.warrant_id];
    return q ? { ...t, ...q } : { ...t };
  });
}
