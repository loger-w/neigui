import type { ReactElement, ReactNode } from "react";
import { Sparkline } from "../lib/options-svg";
import { OptionsInfoHint } from "./OptionsInfoHint";
import type {
  OptionsForeignFutures, OptionsInstitutional, OptionsLargeTraders,
  OptionsPCR, OptionsRetailMtx,
} from "../lib/options-types";

// ---------------------------------------------------------------------------
// 籌碼溫度計列(options-page-v2 SC-8)— 四格「誰站哪邊」。
// 判讀句是純函式(export 供測試),只描述部位方向與變化,禁方向性文案。
// 「較昨日」一律取 series 末兩點差 — payload 的 day_change 恆 0(KR-1)。
// ---------------------------------------------------------------------------

interface HookSlice<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface Props {
  inst: HookSlice<OptionsInstitutional>;
  lt: HookSlice<OptionsLargeTraders>;
  pcr: HookSlice<OptionsPCR>;
  retail: HookSlice<OptionsRetailMtx>;
  ff: HookSlice<OptionsForeignFutures>;
  /** 週選合約時前十大格附 aggregate 註記(CR2 回復) */
  weeklyAggregate?: boolean;
}

const fmt = (n: number): string => Math.abs(n).toLocaleString("zh-TW");

export function buildForeignReading(
  series: Array<{ date: string; foreign_total_net: number }>,
): string | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1]!.foreign_total_net;
  const side = last >= 0 ? "淨多" : "淨空";
  const base = `外資選擇權${side} ${fmt(last)} 口`;
  if (series.length < 2) return base;
  const prev = series[series.length - 2]!.foreign_total_net;
  const delta = last - prev;
  const dir = delta > 0 ? "增加" : delta < 0 ? "減少" : "持平";
  return `${base},較昨日${dir}`;
}

export function buildTop10Reading(net: number, series20: number[]): string {
  const side = net >= 0 ? "淨多" : "淨空";
  let trend = "";
  if (series20.length >= 2) {
    const diff = series20[series20.length - 1]! - series20[0]!;
    trend = diff > 0 ? "(20 日趨勢上升)" : diff < 0 ? "(20 日趨勢下降)" : "(20 日持平)";
  }
  return `前十大交易人${side} ${fmt(net)} 口${trend}`;
}

export function buildPcrReading(
  current: { pcr: number; percentile: number; region: "high" | "neutral" | "low" | null },
): string | null {
  if (current.region === null) return null;
  const label = current.region === "high" ? "偏高" : current.region === "low" ? "偏低" : "中性";
  return `Put/Call 未平倉比 ${current.pcr.toFixed(2)},歷史第 ${current.percentile.toFixed(0)} 百分位,${label}`;
}

export function buildRetailReading(
  current: { retail_long: number; retail_short: number; ratio: number },
): string {
  const side = current.ratio >= 0 ? "淨多" : "淨空";
  return `小台散戶${side},佔總未平倉 ${(Math.abs(current.ratio) * 100).toFixed(1)}%`;
}

function Tile({
  label, hint, value, valueClass, reading, spark, extra, fallback,
}: {
  label: string;
  hint?: ReactNode;
  value: string | null;
  valueClass: string;
  reading: string | null;
  spark: number[];
  extra?: ReactNode;
  /** 資料缺時的文案(PCR「資料不足」/ 其他「—」,impl-review R6) */
  fallback: string;
}): ReactElement {
  return (
    <div
      data-testid="thermo-tile"
      className="rounded-lg border border-line bg-bg-deep/50 p-3 flex flex-col gap-1 min-w-0"
    >
      <div className="flex items-center gap-1.5 text-[0.625rem] text-ink-dim uppercase tracking-wide">
        <span className="truncate">{label}</span>
        {hint}
      </div>
      {value === null ? (
        <div className="text-sm text-ink-dim">{fallback}</div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-semibold leading-none tabular-nums ${valueClass}`}>
              {value}
            </span>
            {spark.length >= 2 && (
              <span className="ml-auto shrink-0">
                <Sparkline series={spark} width={72} height={24} />
              </span>
            )}
          </div>
          {reading && <div className="text-xs text-ink-muted leading-snug">{reading}</div>}
          {extra}
        </>
      )}
    </div>
  );
}

export function OptionsThermometerRow({
  inst, lt, pcr, retail, ff, weeklyAggregate = false,
}: Props): ReactElement {
  // --- 外資選擇權(+期貨對照行) ---
  const instSeries = inst.data?.series ?? [];
  const foreignNet = instSeries.length
    ? instSeries[instSeries.length - 1]!.foreign_total_net
    : null;
  const ffNet = ff.data?.current?.net_oi ?? null;

  // --- 前十大交易人 ---
  const top10 = lt.data?.current.top10_all.net ?? null;
  const top10Series = (lt.data?.series ?? []).map((s) => s.top10_all_net);

  // --- PCR ---
  const pcrCurrent = pcr.data?.current ?? null;
  const pcrReading = pcrCurrent ? buildPcrReading(pcrCurrent) : null;
  const pcrSeries = (pcr.data?.series ?? []).map((s) => s.pcr);

  // --- 散戶小台 ---
  const retailCurrent = retail.data?.current ?? null;
  const retailSeries = (retail.data?.series ?? []).map((s) => s.ratio);

  const posNeg = (n: number): string => (n >= 0 ? "text-bull" : "text-bear");

  return (
    <section
      data-testid="options-thermometer"
      className="shrink-0 grid gap-3 px-6 py-3 grid-cols-2 xl:grid-cols-4 border-b border-line"
    >
      <Tile
        label="外資選擇權淨部位"
        hint={
          <OptionsInfoHint label="delta 等效淨部位說明">
            <div className="text-ink font-medium mb-1">淨部位怎麼算?</div>
            買 call + 賣 put 視為偏多、賣 call + 買 put 視為偏空,相抵後的口數。
            正值代表整體佈局偏多方,負值偏空方。
          </OptionsInfoHint>
        }
        value={
          inst.error ? null
            : foreignNet !== null
              ? `${foreignNet >= 0 ? "+" : "−"}${fmt(foreignNet)}`
              : null
        }
        valueClass={foreignNet !== null ? posNeg(foreignNet) : ""}
        reading={buildForeignReading(instSeries)}
        spark={instSeries.map((s) => s.foreign_total_net)}
        extra={
          ffNet !== null ? (
            <div data-testid="thermo-foreign-futures" className="text-xs text-ink-dim">
              期貨{ffNet >= 0 ? "淨多" : "淨空"} {fmt(ffNet)} 口
            </div>
          ) : undefined
        }
        fallback="—"
      />
      <Tile
        label="前十大交易人"
        value={
          lt.error ? null
            : top10 !== null ? `${top10 >= 0 ? "+" : "−"}${fmt(top10)}` : null
        }
        valueClass={top10 !== null ? posNeg(top10) : ""}
        reading={top10 !== null ? buildTop10Reading(top10, top10Series) : null}
        spark={top10Series}
        extra={
          weeklyAggregate ? (
            <div className="text-[0.6875rem] text-ink-dim">
              週選為週三選 + 週五選合計
            </div>
          ) : undefined
        }
        fallback="—"
      />
      <Tile
        label="Put/Call 未平倉比"
        hint={
          <OptionsInfoHint label="PCR 說明">
            <div className="text-ink font-medium mb-1">PCR 是什麼?</div>
            Put 未平倉量 ÷ Call 未平倉量。數字本身沒有絕對好壞,
            重點看它在歷史分布的位置(百分位)。
          </OptionsInfoHint>
        }
        value={
          pcr.error || !pcrCurrent || pcrCurrent.region === null
            ? null
            : pcrCurrent.pcr.toFixed(2)
        }
        valueClass="text-ink"
        reading={pcrReading}
        spark={pcrSeries}
        fallback={pcr.error ? "—" : "資料不足"}
      />
      <Tile
        label="小台散戶多空比"
        hint={
          <OptionsInfoHint label="散戶多空比說明">
            <div className="text-ink font-medium mb-1">怎麼算的?</div>
            小台總未平倉扣掉三大法人後視為散戶部位;
            (散戶多單 − 散戶空單)÷ 總未平倉。
          </OptionsInfoHint>
        }
        value={
          retail.error ? null
            : retailCurrent
              ? `${retailCurrent.ratio >= 0 ? "+" : "−"}${(Math.abs(retailCurrent.ratio) * 100).toFixed(1)}%`
              : null
        }
        valueClass={retailCurrent ? posNeg(retailCurrent.ratio) : ""}
        reading={retailCurrent ? buildRetailReading(retailCurrent) : null}
        spark={retailSeries}
        fallback="—"
      />
    </section>
  );
}
