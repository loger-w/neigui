import { useEffect, useMemo, useState, type ReactElement } from "react";
import { OptionsHeader } from "./OptionsHeader";
import { OptionsConclusionBar } from "./OptionsConclusionBar";
import { OptionsRangeMap } from "./OptionsRangeMap";
import { OptionsThermometerRow } from "./OptionsThermometerRow";
import { OptionsAdvancedPanel } from "./OptionsAdvancedPanel";
import { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import { useOptionsStrikeVolume } from "../hooks/useOptionsStrikeVolume";
import { useOptionsSpot } from "../hooks/useOptionsSpot";
import { useOptionsChip } from "../hooks/useOptionsChip";
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

/** options-page-v2 四層結構(design v3 §0):
 * 結論列 → 區間地圖 → 溫度計列 → 進階統計收合層。
 * 舊平列結構(OptionsChipPanel / OptionsLargeTradersStrip / OptionsStrikeLadder)
 * 的內容分別收進 AdvancedPanel / ThermometerRow+NetTable / RangeMap。 */
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
  const chip = useOptionsChip(contractId, date);

  const loading = lt.loading || sv.loading || spot.loading || chip.loading;
  const refresh = () => {
    lt.refresh(); sv.refresh(); spot.refresh();
    chip.refreshAll();
  };

  const anyNoTradingDay =
    lt.noTradingDay || sv.noTradingDay || spot.noTradingDay || chip.anyNoTradingDay;

  const walls = chip.ow.data?.current ?? null;

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
      <OptionsConclusionBar
        spot={spot.data?.spot ?? null}
        putWall={walls?.static_put_wall?.strike ?? null}
        callWall={walls?.static_call_wall?.strike ?? null}
        maxPain={chip.mp.data?.current.max_pain ?? null}
      />
      <OptionsRangeMap
        sv={sv.data}
        ow={chip.ow.data}
        mp={chip.mp.data}
        spot={spot.data}
        loading={sv.loading}
        error={sv.error}
      />
      <OptionsThermometerRow
        inst={chip.inst}
        lt={lt}
        pcr={chip.pcr}
        retail={chip.retail}
        ff={chip.ff}
      />
      <OptionsAdvancedPanel chip={chip} lt={lt} spot={spot.data} />
    </div>
  );
}
