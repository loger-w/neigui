import { useState, type ReactElement } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchSectorMembers } from "../lib/market-api";
import { changeColorClass, formatAmount, formatRatio, signedPercent } from "../lib/market-format";
import type { SectorMembers, SectorRotation, SectorRotationGroup } from "../lib/market-types";

type Props = { data: SectorRotation | null; loading: boolean };

type Drill = { industry: string; subIndustry: string | null };

/** SC-3:量比 >1.5 過熱 / <0.7 冷清,null → 無 flag。中性標色(不用 accent —
 * frontend-conventions:資料 badge 禁用 accent,避免撞多頭紅語意)。 */
function volRatioFlag(v: number | null): "hot" | "cold" | null {
  if (v === null) return null;
  if (v > 1.5) return "hot";
  if (v < 0.7) return "cold";
  return null;
}

function VolRatioBadge({ v }: { v: number | null }): ReactElement {
  const flag = volRatioFlag(v);
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-dim">{formatRatio(v)}</span>
      {flag === "hot" && (
        <span data-flag="hot" className="px-1 rounded bg-ink/10 text-ink text-[0.625rem]">
          過熱
        </span>
      )}
      {flag === "cold" && (
        <span
          data-flag="cold"
          className="px-1 rounded border border-line-strong text-ink-dim text-[0.625rem]"
        >
          冷清
        </span>
      )}
    </span>
  );
}

function GroupStatsRow({ group }: { group: SectorRotationGroup }): ReactElement {
  return (
    <span className="flex items-center gap-2">
      <span className={changeColorClass(group.avg_change_rate)}>
        {signedPercent(group.avg_change_rate)}
      </span>
      <VolRatioBadge v={group.vol_ratio} />
    </span>
  );
}

function MembersPanel({
  drill,
  query,
  onClose,
}: {
  drill: Drill;
  query: UseQueryResult<SectorMembers, Error>;
  onClose: () => void;
}): ReactElement {
  const title = drill.subIndustry ? `${drill.industry} › ${drill.subIndustry}` : `${drill.industry}(全產業)`;
  return (
    <div data-testid="sector-members-panel" className="mt-3 border-t border-line pt-2">
      <div className="flex items-center justify-between">
        <h4 className="text-ink text-xs">{title} 成員股</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉成員列表"
          className="text-ink-dim hover:text-ink text-xs cursor-pointer"
        >
          關閉
        </button>
      </div>
      {query.isLoading && (
        <div
          data-state="loading"
          role="status"
          aria-label="載入中"
          className="mt-1 flex flex-col gap-1"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-3 animate-pulse bg-bg-deep" />
          ))}
        </div>
      )}
      {query.isError && (
        <div data-state="error" className="text-danger text-xs mt-1">
          成員股載入失敗:{query.error.message}
        </div>
      )}
      {query.data &&
        (query.data.members.length === 0 ? (
          <div data-state="empty" className="text-ink-dim text-xs mt-1">
            無成員資料
          </div>
        ) : (
          <div className="overflow-y-auto max-h-48 mt-1">
            <table data-testid="sector-members-table" className="w-full text-xs">
              <thead>
                <tr className="text-ink-dim text-left">
                  <th className="font-normal">名稱</th>
                  <th className="font-normal">漲跌</th>
                  <th className="font-normal">量比</th>
                  <th className="font-normal">成交額</th>
                </tr>
              </thead>
              <tbody>
                {query.data.members.map((m) => (
                  <tr key={m.stock_id} data-testid={`sector-member-${m.stock_id}`}>
                    <td className="text-ink">{m.name}</td>
                    <td className={changeColorClass(m.change_rate)}>
                      {signedPercent(m.change_rate)}
                    </td>
                    <td className="text-ink">{formatRatio(m.vol_ratio)}</td>
                    <td className="text-ink">{formatAmount(m.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

export function MarketSectorRotation({ data, loading }: Props): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<Drill | null>(null);

  const membersQuery = useQuery<SectorMembers, Error>({
    queryKey: ["market", "sector-members", drill?.industry ?? null, drill?.subIndustry ?? null],
    // drill 非 null 才 enabled,queryFn 內非 null assertion 安全(§3 慣例:signal 傳入)
    queryFn: ({ signal }) => fetchSectorMembers(drill!.industry, drill!.subIndustry, { signal }),
    enabled: drill !== null,
  });

  function toggleExpand(name: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  let body: ReactElement;
  if (loading) {
    body = (
      <div data-state="loading" role="status" aria-label="載入中" className="flex flex-col gap-1 mt-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-5 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (data === null || data.industries.length === 0) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs mt-2">
        資料暫缺
      </div>
    );
  } else {
    body = (
      <ul data-testid="sector-rotation-list" className="flex flex-col mt-2 text-xs">
        {data.industries.map((ind) => {
          const isExpanded = expanded.has(ind.name);
          return (
            <li key={ind.name} data-testid={`sector-row-${ind.name}`} className="border-b border-line py-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleExpand(ind.name)}
                  aria-expanded={isExpanded}
                  aria-label={`展開 ${ind.name} 子產業`}
                  data-testid={`sector-toggle-${ind.name}`}
                  className="text-ink-dim hover:text-ink cursor-pointer w-4 shrink-0 pointer-coarse:min-h-11"
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
                <button
                  type="button"
                  onClick={() => setDrill({ industry: ind.name, subIndustry: null })}
                  data-testid={`sector-drill-${ind.name}`}
                  className="flex-1 flex items-center justify-between text-left hover:text-ink cursor-pointer pointer-coarse:min-h-11"
                >
                  <span className="text-ink">
                    {ind.name}
                    <span className="text-ink-dim ml-1">({ind.members})</span>
                  </span>
                  <GroupStatsRow group={ind} />
                </button>
              </div>
              {isExpanded && (
                <ul className="pl-6 mt-1 flex flex-col gap-1">
                  {ind.subs.map((sub) => (
                    <li key={sub.name}>
                      <button
                        type="button"
                        onClick={() => setDrill({ industry: ind.name, subIndustry: sub.name })}
                        data-testid={`sub-row-${ind.name}-${sub.name}`}
                        className="w-full flex items-center justify-between text-left hover:text-ink cursor-pointer pointer-coarse:min-h-11"
                      >
                        <span className="text-ink-muted">
                          {sub.name}
                          <span className="text-ink-dim ml-1">({sub.members})</span>
                        </span>
                        <GroupStatsRow group={sub} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section data-testid="market-sector-rotation" className="flex flex-col min-h-0 p-3 overflow-y-auto">
      <h3 className="text-ink text-sm">族群輪動</h3>
      {body}
      {drill && <MembersPanel drill={drill} query={membersQuery} onClose={() => setDrill(null)} />}
    </section>
  );
}
