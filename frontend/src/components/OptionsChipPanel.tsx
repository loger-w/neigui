import { useCallback, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMaxPain } from "../hooks/useMaxPain";
import { useOptionsOIWalls } from "../hooks/useOptionsOIWalls";
import { useOptionsPCR } from "../hooks/useOptionsPCR";
import { useInstitutionalOptions } from "../hooks/useInstitutionalOptions";
import { OptionsMaxPainCard } from "./OptionsMaxPainCard";
import { OptionsOIWallsCard } from "./OptionsOIWallsCard";
import { OptionsPCRCard } from "./OptionsPCRCard";
import { OptionsInstitutionalCard } from "./OptionsInstitutionalCard";

interface Props {
  contractId: string;
  date: string;
}

export function OptionsChipPanel({ contractId, date }: Props): ReactElement {
  const queryClient = useQueryClient();

  const mp   = useMaxPain(contractId, date);
  const ow   = useOptionsOIWalls(contractId, date);
  const pcr  = useOptionsPCR(date, "all_months");  // MVP1: default all_months
  const inst = useInstitutionalOptions(date);

  // design v4 T2: cross-hook refresh — when user refreshes ONE card, also
  // invalidate the sibling shared-window-dependent queries so a fresh window
  // fetch on the backend doesn't end up consumed only by the refreshed card.
  const cascadeInvalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["options-max-pain", contractId, date] });
    queryClient.invalidateQueries({ queryKey: ["options-oi-walls", contractId, date] });
    queryClient.invalidateQueries({ queryKey: ["options-pcr"] });
    // institutional NOT in cascade (independent data source).
  }, [queryClient, contractId, date]);

  const wrapRefresh = (own: () => void) => () => {
    own();
    cascadeInvalidate();
  };

  return (
    <div
      className="shrink-0 grid gap-3 px-6 py-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      data-testid="options-chip-panel"
    >
      <OptionsMaxPainCard
        data={mp.data} loading={mp.loading} error={mp.error}
        onRefresh={wrapRefresh(mp.refresh)}
      />
      <OptionsOIWallsCard
        data={ow.data} loading={ow.loading} error={ow.error}
        onRefresh={wrapRefresh(ow.refresh)}
      />
      <OptionsPCRCard
        data={pcr.data} loading={pcr.loading} error={pcr.error}
        onRefresh={wrapRefresh(pcr.refresh)}
      />
      <OptionsInstitutionalCard
        data={inst.data} loading={inst.loading} error={inst.error}
        onRefresh={inst.refresh}
      />
    </div>
  );
}
