import type { ReactElement } from "react";
import type { OptionsStrikeVolume } from "./options-types";

// ---------------------------------------------------------------------------
// RangeMapSvg — options-page-v2 SC-7 主視覺(自 StrikeLadder 演進)。
//
// 與基底的三個關鍵差異(design v3 §0/§3.1):
// 1. 牆一律吃後端 oi_walls 權威值(props),前端 maxOIStrike 自算已刪除 —
//    SC-1 價外規則後兩套算法會標出不同的牆(雙源 drift)。
// 2. 配色翻轉:基底的 call=紅 / put=綠 是反轉遺留(R7);正確為
//    call=bear 綠(壓力側)/ put=bull 紅(支撐側),與 OptionsOIWallsCard
//    的 F2 修一致。oi_change chip 維持漲紅跌綠(值方向,非側別)。
// 3. 顯示視窗:spot 上下各 20 檔,牆 / Max Pain 落窗外則擴窗至包含(R12);
//    牆 strike 不在資料集時仍插入合成列畫標記(R4 防禦)。
// ---------------------------------------------------------------------------

export interface RangeMapSvgProps {
  data: OptionsStrikeVolume;
  metric: "oi" | "volume";
  spot: number | null;
  /** 後端 oi_walls 權威值;null = 該側無牆(或 as_of 防禦隱藏) */
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
}

const WINDOW_HALF = 20; // spot 上下各 20 檔(design R12 [auto-default])

function fmtSigned(n: number): string {
  if (!n) return "0";
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${a.toLocaleString()}`;
  return n > 0 ? `+${s}` : `−${s}`;
}

export function RangeMapSvg({
  data, metric, spot, callWall, putWall, maxPain,
}: RangeMapSvgProps): ReactElement {
  const callByStrike = new Map(data.call.map((r) => [r.strike, r]));
  const putByStrike = new Map(data.put.map((r) => [r.strike, r]));

  // Union of data strikes + synthetic wall / max-pain strikes (R4 防禦)
  const allStrikes = new Set<number>([
    ...data.call.map((r) => r.strike),
    ...data.put.map((r) => r.strike),
  ]);
  if (allStrikes.size === 0) {
    return (
      <div
        data-testid="rangemap-empty"
        className="h-full flex items-center justify-center text-ink-dim text-sm"
      >
        無履約價資料
      </div>
    );
  }
  for (const s of [callWall, putWall, maxPain]) {
    if (s !== null) allStrikes.add(s);
  }

  const strikesAsc = Array.from(allStrikes).sort((a, b) => a - b);

  // 視窗:spot ±WINDOW_HALF 檔;牆 / Max Pain 擴窗納入;spot 缺 → 全部顯示
  let visible = strikesAsc;
  if (spot !== null) {
    const insertIdx = strikesAsc.filter((s) => s < spot).length;
    let lo = Math.max(0, insertIdx - WINDOW_HALF);
    let hi = Math.min(strikesAsc.length, insertIdx + WINDOW_HALF);
    for (const s of [callWall, putWall, maxPain]) {
      if (s === null) continue;
      const i = strikesAsc.indexOf(s);
      if (i < 0) continue;
      lo = Math.min(lo, i);
      hi = Math.max(hi, i + 1);
    }
    visible = strikesAsc.slice(lo, hi);
  }
  const strikesDesc = [...visible].sort((a, b) => b - a);

  const valueOf = (r: { oi: number; volume: number } | undefined): number =>
    r ? (metric === "oi" ? r.oi : r.volume) : 0;

  const maxVal = Math.max(
    1,
    ...strikesDesc.map((s) => Math.max(valueOf(callByStrike.get(s)), valueOf(putByStrike.get(s)))),
  );

  // spot 插入列(沿 StrikeLadder 慣例:desc 掃描,第一個低於 spot 的 strike 前插)
  const rows: Array<{ kind: "strike"; strike: number } | { kind: "spot" }> = [];
  let spotInserted = false;
  for (const k of strikesDesc) {
    if (!spotInserted && spot != null && k < spot && spot < strikesDesc[0]! + 1) {
      rows.push({ kind: "spot" });
      spotInserted = true;
    }
    rows.push({ kind: "strike", strike: k });
  }
  if (!spotInserted && spot != null && spot >= strikesDesc[0]!) {
    rows.unshift({ kind: "spot" });
  }

  return (
    <div className="h-full overflow-y-auto font-variant-numeric tabular-nums">
      <table className="w-full">
        <colgroup>
          <col style={{ width: "calc(50% - 60px)" }} />
          <col style={{ width: "120px" }} />
          <col style={{ width: "calc(50% - 60px)" }} />
        </colgroup>
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="text-[0.625rem] text-ink-dim uppercase tracking-wide border-b border-line">
            <th className="px-3 py-1 text-right">
              Call {metric === "oi" ? "OI" : "vol"} / OI±
            </th>
            <th className="px-3 py-1 text-center">Strike</th>
            <th className="px-3 py-1 text-left">
              {metric === "oi" ? "OI" : "vol"} / OI± Put
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "spot") {
              return (
                <tr
                  key="spot-row"
                  data-testid="rangemap-row"
                  className="border-y border-accent bg-accent/[0.04]"
                  style={{ height: "26px" }}
                >
                  <td />
                  <td
                    data-testid="rangemap-spot"
                    className="text-center text-accent font-semibold"
                  >
                    {(spot as number).toLocaleString()} ← 現價
                  </td>
                  <td />
                </tr>
              );
            }
            const c = callByStrike.get(row.strike);
            const p = putByStrike.get(row.strike);
            const cw = (valueOf(c) / maxVal) * 100;
            const pw = (valueOf(p) / maxVal) * 100;
            const isCallWall = callWall !== null && row.strike === callWall;
            const isPutWall = putWall !== null && row.strike === putWall;
            const isMaxPain = maxPain !== null && row.strike === maxPain;
            const wallTag = isCallWall && isPutWall ? "both"
              : isCallWall ? "call"
              : isPutWall ? "put"
              : undefined;
            const strikeClass = isCallWall && isPutWall
              ? "text-center text-[0.8125rem] font-bold text-accent"
              : isCallWall
              ? "text-center text-[0.8125rem] font-bold text-bear"
              : isPutWall
              ? "text-center text-[0.8125rem] font-bold text-bull"
              : "text-center text-[0.8125rem] text-ink";
            return (
              <tr
                key={`s-${row.strike}`}
                data-testid="rangemap-row"
                data-wall={wallTag}
                className="border-b border-line/40"
                style={{ height: "22px" }}
              >
                <td className="relative pr-3 text-right">
                  {c ? (
                    <>
                      <span
                        data-testid="rangemap-bar-call"
                        className="absolute inset-y-1 right-0 bg-bear opacity-60"
                        style={{ width: `${cw}%` }}
                      />
                      <span className="relative text-[0.6875rem] text-ink z-10">
                        {valueOf(c).toLocaleString()}
                        <span
                          className={`ml-1 text-[0.625rem] px-1 rounded bg-bg/75 ${
                            c.oi_change >= 0 ? "text-bull" : "text-bear"
                          }`}
                        >
                          {fmtSigned(c.oi_change)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </td>
                <td data-testid="rangemap-strike" className={strikeClass}>
                  {isMaxPain && (
                    <span
                      data-testid="rangemap-maxpain"
                      className="mr-1 text-accent"
                      aria-label="Max Pain"
                    >
                      ▼
                    </span>
                  )}
                  {wallTag === "call" ? (
                    <span data-testid="rangemap-wall-call" className="text-bear">
                      {row.strike.toLocaleString()}
                    </span>
                  ) : wallTag === "put" ? (
                    <span data-testid="rangemap-wall-put" className="text-bull">
                      {row.strike.toLocaleString()}
                    </span>
                  ) : (
                    row.strike.toLocaleString()
                  )}
                </td>
                <td className="relative pl-3 text-left">
                  {p ? (
                    <>
                      <span
                        data-testid="rangemap-bar-put"
                        className="absolute inset-y-1 left-0 bg-bull opacity-60"
                        style={{ width: `${pw}%` }}
                      />
                      <span className="relative text-[0.6875rem] text-ink z-10">
                        {valueOf(p).toLocaleString()}
                        <span
                          className={`ml-1 text-[0.625rem] px-1 rounded bg-bg/75 ${
                            p.oi_change >= 0 ? "text-bull" : "text-bear"
                          }`}
                        >
                          {fmtSigned(p.oi_change)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
