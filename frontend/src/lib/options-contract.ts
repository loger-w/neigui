export type ContractKind = "weekly_wed" | "weekly_fri" | "monthly";

export interface Contract {
  kind: ContractKind;
  optionId: string;
  contractDate: string;
  contractType: string;
  label: string;
  settlement: string;
}

const DEFAULT_HORIZON_DAYS = 35;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function thirdWednesday(year: number, monthIdx0: number): Date {
  const first = new Date(year, monthIdx0, 1);
  const day = first.getDay(); // Sun=0..Sat=6
  const offset = (3 - day + 7) % 7; // Wed=3
  const firstWed = new Date(year, monthIdx0, 1 + offset);
  return new Date(year, monthIdx0, firstWed.getDate() + 14);
}

function nextWednesday(d: Date): Date {
  const day = d.getDay();
  const offset = ((3 - day + 7) % 7) || 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

function nextFriday(d: Date): Date {
  const day = d.getDay();
  const offset = ((5 - day + 7) % 7) || 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function ordinal(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

function yyyymm(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Active TXO contracts sorted by settlement date ascending.
 *
 * Three kinds, all sharing option_id="TXO":
 *   - "monthly":    3rd-Wednesday of month. contract_date = YYYYMM.
 *   - "weekly_wed": every other Wednesday. contract_date = YYYYMMW{n}.
 *   - "weekly_fri": every Friday (TXO Fri weekly 上市 2025/06/27).
 *                   contract_date = YYYYMMF{n}.
 *
 * Both weekly kinds use contract_type="week" — FinMind's
 * TaiwanOptionOpenInterestLargeTraders aggregates Wed+Fri under that single
 * label. The strike-volume dataset distinguishes via contract_date suffix.
 *
 * Same-day collision rule: when a Wednesday is the 3rd-Wed monthly
 * settlement, the monthly contract represents it — no duplicate weekly_wed.
 *
 * Mirrors backend services/finmind_options.py:list_active_contracts.
 */
export function listActiveContracts(
  today: Date,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): Contract[] {
  const horizon = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + horizonDays,
  );

  // --- monthlies ---------------------------------------------------------
  const m0Settle = thirdWednesday(today.getFullYear(), today.getMonth());
  const m0Anchor =
    today > m0Settle
      ? addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1);
  const m1Anchor = addMonths(m0Anchor, 1);
  const m2Anchor = addMonths(m0Anchor, 3);
  const monthlies: Contract[] = [m0Anchor, m1Anchor, m2Anchor].map((anchor) => {
    const sett = thirdWednesday(anchor.getFullYear(), anchor.getMonth());
    const ym = yyyymm(anchor);
    return {
      kind: "monthly" as const,
      optionId: "TXO",
      contractDate: ym,
      contractType: ym,
      label: `${anchor.getFullYear()}/${String(anchor.getMonth() + 1).padStart(2, "0")} 月選`,
      settlement: toISODate(sett),
    };
  });
  const monthlySetts = new Set(monthlies.map((m) => m.settlement));

  // --- weekly Wednesdays (skip monthly-settlement days) -----------------
  const weeklyWed: Contract[] = [];
  for (
    let cursor = today;
    ;

  ) {
    const nxt = nextWednesday(cursor);
    cursor = nxt;
    if (nxt > horizon) break;
    if (monthlySetts.has(toISODate(nxt))) continue;
    weeklyWed.push({
      kind: "weekly_wed",
      optionId: "TXO",
      contractDate: `${yyyymm(nxt)}W${ordinal(nxt)}`,
      contractType: "week",
      label: `${String(nxt.getMonth() + 1).padStart(2, "0")}/${String(nxt.getDate()).padStart(2, "0")} 週三選`,
      settlement: toISODate(nxt),
    });
  }

  // --- weekly Fridays ----------------------------------------------------
  const weeklyFri: Contract[] = [];
  for (
    let cursor = today;
    ;

  ) {
    const nxt = nextFriday(cursor);
    cursor = nxt;
    if (nxt > horizon) break;
    weeklyFri.push({
      kind: "weekly_fri",
      optionId: "TXO",
      contractDate: `${yyyymm(nxt)}F${ordinal(nxt)}`,
      contractType: "week",
      label: `${String(nxt.getMonth() + 1).padStart(2, "0")}/${String(nxt.getDate()).padStart(2, "0")} 週五選`,
      settlement: toISODate(nxt),
    });
  }

  return [...monthlies, ...weeklyWed, ...weeklyFri].sort((a, b) =>
    a.settlement < b.settlement ? -1 : a.settlement > b.settlement ? 1 : 0,
  );
}
