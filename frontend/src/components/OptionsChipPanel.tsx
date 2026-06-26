import type { ReactElement } from "react";
import { OptionsMaxPainCard } from "./OptionsMaxPainCard";
import { OptionsOIWallsCard } from "./OptionsOIWallsCard";
import { OptionsPCRCard } from "./OptionsPCRCard";
import { OptionsInstitutionalCard } from "./OptionsInstitutionalCard";
import type { useOptionsChip } from "../hooks/useOptionsChip";

interface Props {
  /** Aggregated state from {@link useOptionsChip}. OptionsPage owns the hook
   * so the top-bar refresh + no-trading-day banner can see chip state too
   * (F9 fix). */
  chip: ReturnType<typeof useOptionsChip>;
}

export function OptionsChipPanel({ chip }: Props): ReactElement {
  const { mp, ow, pcr, inst, refreshAll } = chip;

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
