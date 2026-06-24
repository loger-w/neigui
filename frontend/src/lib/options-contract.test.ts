import { describe, expect, it } from "vitest";
import { listActiveContracts } from "./options-contract";
import fix from "../../../backend/tests/fixtures/options/contracts_2026-06-23.json";

describe("listActiveContracts", () => {
  it("matches the backend fixture for 2026-06-23", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const projected = items.map((i) => ({
      kind: i.kind,
      option_id: i.optionId,
      contract_date: i.contractDate,
      contract_type: i.contractType,
      settlement: i.settlement,
    }));
    expect(projected).toEqual(fix.expected);
  });

  it("returns contracts sorted by settlement ascending", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const setts = items.map((i) => i.settlement);
    expect(setts).toEqual([...setts].sort());
  });

  it("includes weekly_fri (TXO Friday weeklies, 上市 2025/06/27)", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const fri = items.filter((i) => i.kind === "weekly_fri");
    expect(fri.length).toBeGreaterThan(0);
    expect(fri.every((f) => /^\d{6}F\d$/.test(f.contractDate))).toBe(true);
  });

  it("weekly_fri settlements fall on Fridays", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    for (const f of items.filter((i) => i.kind === "weekly_fri")) {
      const wd = new Date(`${f.settlement}T00:00:00`).getDay();
      expect(wd).toBe(5); // Friday
    }
  });

  it("never emits a weekly_wed on a monthly-settlement day", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const bySett = new Map<string, string[]>();
    for (const i of items) {
      const kinds = bySett.get(i.settlement) ?? [];
      kinds.push(i.kind);
      bySett.set(i.settlement, kinds);
    }
    for (const [, kinds] of bySett) {
      if (kinds.includes("monthly")) {
        expect(kinds).not.toContain("weekly_wed");
      }
    }
  });

  it("contract kinds are only the three known values", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const allowed = new Set(["weekly_wed", "weekly_fri", "monthly"]);
    for (const i of items) {
      expect(allowed.has(i.kind)).toBe(true);
    }
  });
});
