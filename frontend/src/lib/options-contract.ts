export type ContractKind = "weekly" | "monthly";

export interface Contract {
  slot: string;
  kind: ContractKind;
  optionId: string;
  contractDate: string;
  contractType: string;
  label: string;
  settlement: string;
}

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

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function listActiveContracts(today: Date): Contract[] {
  const m0Settle = thirdWednesday(today.getFullYear(), today.getMonth());
  const m0Anchor =
    today > m0Settle
      ? addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1);
  const m1Anchor = addMonths(m0Anchor, 1);
  const m2Anchor = addMonths(m0Anchor, 3);

  const monthlies: Contract[] = (
    [
      { slot: "M0", anchor: m0Anchor },
      { slot: "M1", anchor: m1Anchor },
      { slot: "M2", anchor: m2Anchor },
    ] as const
  ).map(({ slot, anchor }) => {
    const sett = thirdWednesday(anchor.getFullYear(), anchor.getMonth());
    const yyyymm =
      `${anchor.getFullYear()}` +
      `${String(anchor.getMonth() + 1).padStart(2, "0")}`;
    return {
      slot,
      kind: "monthly" as const,
      optionId: "TXO",
      contractDate: yyyymm,
      contractType: yyyymm,
      label: `${anchor.getFullYear()}/${String(anchor.getMonth() + 1).padStart(2, "0")} 月選`,
      settlement: toISODate(sett),
    };
  });

  const monthlySetts = new Set(monthlies.map((m) => m.settlement));
  let cursor = today;
  const weeklies: Contract[] = [];
  for (let i = 1; i <= 4; i += 1) {
    let nxt = nextWednesday(cursor);
    while (monthlySetts.has(toISODate(nxt))) nxt = nextWednesday(nxt);
    const ordinal = Math.floor((nxt.getDate() - 1) / 7) + 1;
    const yyyymm =
      `${nxt.getFullYear()}` +
      `${String(nxt.getMonth() + 1).padStart(2, "0")}`;
    weeklies.push({
      slot: `W${i}`,
      kind: "weekly",
      optionId: "TXO",
      contractDate: `${yyyymm}W${ordinal}`,
      contractType: "week",
      label: `${String(nxt.getMonth() + 1).padStart(2, "0")}/${String(nxt.getDate()).padStart(2, "0")} 週選 W${i}`,
      settlement: toISODate(nxt),
    });
    cursor = nxt;
  }

  return [...weeklies, ...monthlies];
}
