import { describe, expect, it } from "vitest";
import { listActiveContracts } from "./options-contract";
import fix from "../../../backend/tests/fixtures/options/contracts_2026-06-23.json";

describe("listActiveContracts", () => {
  it("matches the backend fixture for 2026-06-23", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const projected = items.map((i) => ({
      slot: i.slot,
      kind: i.kind,
      option_id: i.optionId,
      contract_date: i.contractDate,
      contract_type: i.contractType,
      settlement: i.settlement,
    }));
    expect(projected).toEqual(fix.expected);
  });

  it("returns seven items in fixed order W1..W4, M0..M2", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    expect(items.map((i) => i.slot)).toEqual([
      "W1",
      "W2",
      "W3",
      "W4",
      "M0",
      "M1",
      "M2",
    ]);
  });
});
