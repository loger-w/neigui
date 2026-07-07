import { useMaxPain } from "./useMaxPain";
import { useOptionsOIWalls } from "./useOptionsOIWalls";
import { useOptionsPCR } from "./useOptionsPCR";
import { useInstitutionalOptions } from "./useInstitutionalOptions";
import { useRetailMtx } from "./useRetailMtx";
import { useForeignFutures } from "./useForeignFutures";

/** Aggregates the chip-page hooks and exposes a single ``refreshAll``
 * + ``anyNoTradingDay`` so OptionsPage's top-bar refresh + no-trading-day
 * banner stay consistent with every data source (post-impl review F9 fix;
 * options-page-v2 加 retail / ff — refreshAll 逐 hook 呼叫,不用
 * invalidateQueries cascade,cascade 不帶 refresh=true 到後端)。
 */
export function useOptionsChip(contractId: string, date: string) {
  const mp     = useMaxPain(contractId, date);
  const ow     = useOptionsOIWalls(contractId, date);
  const pcr    = useOptionsPCR(date, "all_months");
  const inst   = useInstitutionalOptions(date);
  const retail = useRetailMtx(date);
  const ff     = useForeignFutures(date);

  const refreshAll = () => {
    mp.refresh();
    ow.refresh();
    pcr.refresh();
    inst.refresh();
    retail.refresh();
    ff.refresh();
  };

  return {
    mp, ow, pcr, inst, retail, ff, refreshAll,
    loading:
      mp.loading || ow.loading || pcr.loading || inst.loading ||
      retail.loading || ff.loading,
    anyNoTradingDay:
      mp.noTradingDay || ow.noTradingDay || pcr.noTradingDay ||
      inst.noTradingDay || retail.noTradingDay || ff.noTradingDay,
  };
}
