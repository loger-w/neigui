import type { ReactElement } from "react";
import { changeColorClass, signedPercent } from "../lib/market-format";
import type { IndexContribEntry, IndexContribGroup, IndexSide, IndexStrength } from "../lib/market-types";

type Props = { data: IndexStrength | null; loading: boolean };

/** SC-1:spread>0 = 權值拉抬指數,<0 = 中小強於指數,null → "—"(貢獻估算誤差來源之一)。 */
function spreadLabel(spread: number | null): string {
  if (spread === null) return "—";
  if (spread === 0) return "打平(0.00pp)";
  const dir = spread > 0 ? "權值拉抬" : "中小強於指數";
  const sign = spread > 0 ? "+" : "";
  return `${dir}(${sign}${spread.toFixed(2)}pp)`;
}

function IndexSideBlock({
  label,
  side,
  testid,
}: {
  label: string;
  side: IndexSide | null;
  testid: string;
}): ReactElement {
  if (side === null) {
    return (
      <div data-testid={testid} data-state="unavailable" className="text-xs">
        <div className="text-ink-dim">{label}</div>
        <div className="text-ink-dim mt-1">資料暫缺</div>
      </div>
    );
  }
  return (
    <div data-testid={testid} className="text-xs">
      <div className="text-ink-dim">{label}</div>
      <div className="text-ink text-sm mt-0.5">{side.close.toLocaleString("zh-Hant-TW")}</div>
      <div className={changeColorClass(side.change_rate)}>{signedPercent(side.change_rate)}</div>
      <div className="text-ink-dim text-[0.625rem] mt-1">{spreadLabel(side.spread)}</div>
    </div>
  );
}

function TsmcRow({ tsmc }: { tsmc: IndexStrength["tsmc"] }): ReactElement {
  const contribText =
    tsmc.contrib_points === null
      ? "—"
      : `${tsmc.contrib_points > 0 ? "+" : ""}${tsmc.contrib_points.toFixed(1)} 點`;
  return (
    <div
      data-testid="idx-tsmc"
      className="flex items-baseline justify-between border-t border-line pt-2 text-xs"
    >
      <span className="text-ink-dim">台積電</span>
      <span className={changeColorClass(tsmc.change_rate)}>{signedPercent(tsmc.change_rate)}</span>
      <span className="text-ink-dim text-[0.625rem]">對加權貢獻(估算){contribText}</span>
    </div>
  );
}

function ContribList({
  label,
  entries,
  testid,
  tone,
}: {
  label: string;
  entries: IndexContribEntry[];
  testid: string;
  tone: "bull" | "bear";
}): ReactElement {
  const colorClass = tone === "bull" ? "text-bull" : "text-bear";
  return (
    <div data-testid={testid} className="flex flex-col gap-0.5">
      <div className="text-ink-dim text-[0.625rem]">{label}</div>
      {entries.length === 0 ? (
        <div className="text-ink-dim text-[0.625rem]">無資料</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((e) => (
            <li key={e.stock_id} className="flex justify-between gap-2 text-[0.625rem]">
              <span className="text-ink truncate">{e.name}</span>
              <span className={colorClass}>
                {e.contrib_points > 0 ? "+" : ""}
                {e.contrib_points.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContribBlock({
  label,
  group,
  testid,
}: {
  label: string;
  group: IndexContribGroup | null;
  testid: string;
}): ReactElement {
  if (group === null) {
    return (
      <div data-testid={testid} data-state="unavailable" className="text-ink-dim text-xs">
        {label}貢獻:資料暫缺
      </div>
    );
  }
  return (
    <div data-testid={testid}>
      <div className="text-ink-dim text-[0.625rem] mb-1">{label}貢獻 Top5(估算)</div>
      <div className="grid grid-cols-2 gap-2">
        <ContribList label="拉抬" entries={group.up} testid={`${testid}-up`} tone="bull" />
        <ContribList label="拖累" entries={group.down} testid={`${testid}-down`} tone="bear" />
      </div>
    </div>
  );
}

export function MarketIndexStrength({ data, loading }: Props): ReactElement {
  let body: ReactElement;
  if (loading) {
    body = (
      <div data-state="loading" role="status" aria-label="載入中" className="flex flex-col gap-2 mt-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (data === null) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs mt-2">
        資料暫缺
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 mt-2">
        <div className="grid grid-cols-2 gap-3">
          <IndexSideBlock label="加權" side={data.twse} testid="idx-side-twse" />
          <IndexSideBlock label="櫃買" side={data.tpex} testid="idx-side-tpex" />
        </div>
        <TsmcRow tsmc={data.tsmc} />
        <ContribBlock label="加權" group={data.contrib.twse} testid="idx-contrib-twse" />
        <ContribBlock label="櫃買" group={data.contrib.tpex} testid="idx-contrib-tpex" />
      </div>
    );
  }

  return (
    <section
      data-testid="market-index-strength"
      className="flex flex-col min-h-0 p-3 border-r border-line overflow-y-auto"
    >
      <h3 className="text-ink text-sm">大盤強弱</h3>
      {body}
    </section>
  );
}
