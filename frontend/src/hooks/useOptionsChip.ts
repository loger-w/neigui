import { useMaxPain } from "./useMaxPain";
import { useOptionsOIWalls } from "./useOptionsOIWalls";
import { useOptionsPCR } from "./useOptionsPCR";
import { useInstitutionalOptions } from "./useInstitutionalOptions";

/** Aggregates the four chip-panel hooks and exposes a single ``refreshAll``
 * + ``anyNoTradingDay`` so OptionsPage's top-bar refresh + no-trading-day
 * banner stay consistent with the four cards (post-impl review F9 fix).
 */
export function useOptionsChip(contractId: string, date: string) {
  const mp   = useMaxPain(contractId, date);
  const ow   = useOptionsOIWalls(contractId, date);
  const pcr  = useOptionsPCR(date, "all_months");
  const inst = useInstitutionalOptions(date);

  const refreshAll = () => {
    mp.refresh();
    ow.refresh();
    pcr.refresh();
    inst.refresh();
  };

  return {
    mp, ow, pcr, inst, refreshAll,
    loading: mp.loading || ow.loading || pcr.loading || inst.loading,
    anyNoTradingDay:
      mp.noTradingDay || ow.noTradingDay || pcr.noTradingDay || inst.noTradingDay,
  };
}
