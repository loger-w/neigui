import type { ReactElement } from "react";
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
  const mp   = useMaxPain(contractId, date);
  const ow   = useOptionsOIWalls(contractId, date);
  const pcr  = useOptionsPCR(date, "all_months");  // MVP1: default all_months
  const inst = useInstitutionalOptions(date);

  // F4 修 (post-impl review): the earlier cascadeInvalidate-via-queryClient
  // pattern raced against the backend cache check — sibling refetches arrived
  // with refresh=false, hit their parse cache before _invalidate_chip_parse_caches
  // ran, and returned stale data. Fix: when ANY card's refresh is clicked,
  // call all FOUR hooks' refresh() so each one sets its own forceRefreshRef
  // and the backend receives refresh=true on every endpoint. This ensures
  // parse-cache invalidation on the shared window correctly propagates to
  // each card's response.
  //
  // Institutional is included even though it doesn't share the window, so
  // the user gets a consistent "refresh = update everything" expectation.
  const refreshAll = () => {
    mp.refresh();
    ow.refresh();
    pcr.refresh();
    inst.refresh();
  };

  return (
    <div
      className="shrink-0 grid gap-3 px-6 py-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      data-testid="options-chip-panel"
    >
      <OptionsMaxPainCard
        data={mp.data} loading={mp.loading} error={mp.error}
        onRefresh={refreshAll}
      />
      <OptionsOIWallsCard
        data={ow.data} loading={ow.loading} error={ow.error}
        onRefresh={refreshAll}
      />
      <OptionsPCRCard
        data={pcr.data} loading={pcr.loading} error={pcr.error}
        onRefresh={refreshAll}
      />
      <OptionsInstitutionalCard
        data={inst.data} loading={inst.loading} error={inst.error}
        onRefresh={refreshAll}
      />
    </div>
  );
}
