import { useState, type ReactElement } from "react";
import { RangeMapSvg } from "../lib/options-range-svg";
import { OptionsInfoHint } from "./OptionsInfoHint";
import type {
  OptionsMaxPain, OptionsOIWalls, OptionsSpot, OptionsStrikeVolume,
} from "../lib/options-types";

interface Props {
  sv: OptionsStrikeVolume | null;
  ow: OptionsOIWalls | null;
  mp: OptionsMaxPain | null;
  spot: OptionsSpot | null;
  loading: boolean;
  error: string | null;
}

type Metric = "oi" | "volume";

/** 區間地圖 wrapper(options-page-v2 SC-7)。
 *
 * - OI / 成交量 toggle 用普通 button(Radix Tabs 在 jsdom 不可靠 —
 *   frontend-testing;樣板 MarketLeaderboard)。
 * - R10 防禦:sv 與 ow 的 as_of_date 不一致(cache 殘留等殘餘情境;
 *   後端 fallback 已對齊常態)→ 隱藏牆標記 + 註記,不疊錯基準日的牆。
 */
export function OptionsRangeMap({
  sv, ow, mp, spot, loading, error,
}: Props): ReactElement {
  const [metric, setMetric] = useState<Metric>("oi");

  const asOfMismatch =
    sv != null && ow != null &&
    sv.as_of_date != null && ow.as_of_date != null &&
    sv.as_of_date !== ow.as_of_date;

  const callWall = !asOfMismatch ? ow?.current.static_call_wall?.strike ?? null : null;
  const putWall = !asOfMismatch ? ow?.current.static_put_wall?.strike ?? null : null;

  return (
    <section data-testid="options-range-map" className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 px-4 py-2 text-xs text-ink-dim uppercase tracking-wide border-b border-line flex items-center gap-2">
        <span>區間地圖 · Range Map</span>
        <OptionsInfoHint label="OI 牆說明">
          <div className="text-ink font-medium mb-1">OI 牆是什麼?</div>
          未平倉量(OI)特別大的履約價。大量賣方部位聚集處,行情接近時常有
          支撐(Put Wall,紅)或壓力(Call Wall,綠)效果,但不是保證。
        </OptionsInfoHint>
        <div role="tablist" aria-label="指標切換" className="ml-auto flex gap-1 normal-case">
          {(["oi", "volume"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={metric === m}
              onClick={() => setMetric(m)}
              className={`px-2 py-0.5 rounded text-xs border ${
                metric === m
                  ? "border-accent text-accent"
                  : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {m === "oi" ? "OI" : "成交量"}
            </button>
          ))}
        </div>
      </header>
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {asOfMismatch && (
        <div className="shrink-0 px-4 py-1.5 text-xs text-ink-dim bg-ink/[0.04] border-b border-line">
          牆資料基準日不同({ow?.as_of_date} vs {sv?.as_of_date}),暫不標示 OI 牆
        </div>
      )}
      {loading && !sv && (
        <div
          data-testid="rangemap-loading"
          className="flex-1 flex items-center justify-center text-ink-dim text-sm"
        >
          載入中…
        </div>
      )}
      {sv && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="h-full min-w-[480px]">
            <RangeMapSvg
              data={sv}
              metric={metric}
              spot={spot?.spot ?? null}
              callWall={callWall}
              putWall={putWall}
              maxPain={mp?.current.max_pain ?? null}
            />
          </div>
        </div>
      )}
    </section>
  );
}
