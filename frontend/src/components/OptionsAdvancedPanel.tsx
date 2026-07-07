import { useState, type ReactElement } from "react";
import { OptionsMaxPainCard } from "./OptionsMaxPainCard";
import { OptionsOIWallsCard } from "./OptionsOIWallsCard";
import { OptionsPCRCard } from "./OptionsPCRCard";
import { OptionsInstitutionalCard } from "./OptionsInstitutionalCard";
import { OptionsNetTable } from "./OptionsNetTable";
import type { useOptionsChip } from "../hooks/useOptionsChip";
import type { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import type { OptionsSpot } from "../lib/options-types";

interface Props {
  chip: ReturnType<typeof useOptionsChip>;
  lt: ReturnType<typeof useOptionsLargeTraders>;
  spot: OptionsSpot | null;
  /** 週選 aggregate 註記透傳 NetTable(CR2) */
  weeklyAggregate?: boolean;
}

/** 進階統計收合層(options-page-v2 SC-9)— 現四卡統計 + NET 對照表全數
 * 保留於此,預設收合;內容用 `hidden` attribute 保留 DOM(CLAUDE.md §3)。 */
export function OptionsAdvancedPanel({
  chip, lt, spot, weeklyAggregate = false,
}: Props): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { mp, ow, pcr, inst, refreshAll } = chip;

  return (
    <section data-testid="options-advanced-panel" className="shrink-0 border-b border-line">
      <button
        type="button"
        data-testid="advanced-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-6 py-2 text-left text-xs text-ink-dim hover:text-ink"
      >
        {expanded ? "▼ 收起進階統計" : "▶ 進階統計(Max Pain / OI 牆 / PCR / 三大法人 / 大戶對照)"}
      </button>
      <div hidden={!expanded} data-testid="advanced-content" className="px-6 pb-4">
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
          <OptionsMaxPainCard
            data={mp.data} loading={mp.loading} error={mp.error}
            onRefresh={refreshAll} spot={spot?.spot ?? null}
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
        <div className="mt-3">
          <OptionsNetTable data={lt.data} weeklyAggregate={weeklyAggregate} />
        </div>
      </div>
    </section>
  );
}
