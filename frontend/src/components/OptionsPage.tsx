import { useEffect, useMemo, useState, type ReactElement } from "react";
import { OptionsHeader } from "./OptionsHeader";
import { OptionsLargeTradersPanel } from "./OptionsLargeTradersPanel";
import { OptionsStrikeVolumePanel } from "./OptionsStrikeVolumePanel";
import { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import { useOptionsStrikeVolume } from "../hooks/useOptionsStrikeVolume";
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
  // persisted kind preference
  const kind = localStorage.getItem("opt:kind");
  const pick = list.find((c) =>
    kind === "monthly" ? c.slot === "M0" : c.slot === "W1",
  ) ?? list[0];
  return `${pick.optionId}${pick.contractDate}`;
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
    if (currentContract) localStorage.setItem("opt:kind", currentContract.kind);
  }, [currentContract]);

  const lt = useOptionsLargeTraders(contractId, date);
  const sv = useOptionsStrikeVolume(contractId, date);
  const loading = lt.loading || sv.loading;
  const refresh = () => { lt.refresh(); sv.refresh(); };

  const isWeekly = currentContract?.kind === "weekly";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <OptionsHeader
        contractId={contractId}
        onContractChange={setContractId}
        date={date}
        onDateChange={setDate}
        loading={loading}
        onRefresh={refresh}
      />
      {(lt.noTradingDay || sv.noTradingDay) && (
        <div className="shrink-0 px-6 py-2 text-sm text-ink-dim bg-ink/[0.04] border-b border-line">
          {date} 無交易
        </div>
      )}
      <div className="flex-1 grid grid-rows-2 overflow-hidden">
        <OptionsLargeTradersPanel
          data={lt.data}
          loading={lt.loading}
          error={lt.error}
          weeklyAggregateBanner={isWeekly}
        />
        <OptionsStrikeVolumePanel
          data={sv.data}
          loading={sv.loading}
          error={sv.error}
        />
      </div>
    </div>
  );
}
