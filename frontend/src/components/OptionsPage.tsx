import { useEffect, useMemo, useState, type ReactElement } from "react";
import { OptionsHeader } from "./OptionsHeader";
import { OptionsLargeTradersStrip } from "./OptionsLargeTradersStrip";
import { OptionsStrikeLadder } from "./OptionsStrikeLadder";
import { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import { useOptionsStrikeVolume } from "../hooks/useOptionsStrikeVolume";
import { useOptionsSpot } from "../hooks/useOptionsSpot";
import { listActiveContracts } from "../lib/options-contract";

function todayStr(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function defaultContractId(): string {
  const list = listActiveContracts(new Date());
  if (list.length === 0) return "";
  const remembered = localStorage.getItem("opt:contractId");
  if (remembered) {
    const hit = list.find((c) => `${c.optionId}${c.contractDate}` === remembered);
    if (hit) return remembered;
  }
  // Picker is settlement-asc sorted; head = nearest unsettled contract.
  // `list.length === 0` is already checked above, so head is safe.
  const head = list[0]!;
  return `${head.optionId}${head.contractDate}`;
}

export function OptionsPage(): ReactElement {
  const [contractId, setContractId] = useState<string>(defaultContractId);
  const [date, setDate] = useState<string>(todayStr);

  const currentContract = useMemo(
    () => listActiveContracts(new Date())
      .find((c) => `${c.optionId}${c.contractDate}` === contractId),
    [contractId],
  );

  useEffect(() => {
    if (currentContract) localStorage.setItem("opt:contractId", contractId);
  }, [currentContract, contractId]);

  const lt   = useOptionsLargeTraders(contractId, date);
  const sv   = useOptionsStrikeVolume(contractId, date);
  const spot = useOptionsSpot(date);

  const loading = lt.loading || sv.loading || spot.loading;
  const refresh = () => { lt.refresh(); sv.refresh(); spot.refresh(); };

  const isWeekly = currentContract?.kind.startsWith("weekly") ?? false;
  const anyNoTradingDay =
    lt.noTradingDay || sv.noTradingDay || spot.noTradingDay;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <OptionsHeader
        contractId={contractId}
        onContractChange={setContractId}
        date={date}
        onDateChange={setDate}
        loading={loading}
        onRefresh={refresh}
        spot={spot.data}
      />
      {anyNoTradingDay && (
        <div className="shrink-0 px-6 py-2 text-sm text-ink-dim bg-ink/[0.04] border-b border-line">
          {date} 無交易
        </div>
      )}
      <OptionsLargeTradersStrip
        data={lt.data}
        loading={lt.loading}
        error={lt.error}
        weeklyAggregateBanner={isWeekly}
      />
      <OptionsStrikeLadder
        data={sv.data}
        spot={spot.data}
        loading={sv.loading}
        error={sv.error}
      />
    </div>
  );
}
