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

/** MK-3(mod/batch-ui-update):成員表巢狀內嵌在展開的族群/副族群列之下,
 * 不再是卡片底部面板;收合 = 再點該列(無獨立關閉鈕)。 */
function MembersPanel({
  query,
}: {
  query: UseQueryResult<SectorMembers, Error>;
}): ReactElement {
  return (
    <div data-testid="sector-members-panel" className="mt-1 mb-1 pl-2 border-l border-line">
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
  // MK-3:單一成員表目標(同時僅一個展開,沿用單一 lazy query 避免並發 fan-out)
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

  // 整列點擊(MK-3):有副族群 → 展開/收合子列;無副族群 → 直接內嵌個股表
  function handleIndustryClick(name: string, hasSubs: boolean): void {
    if (hasSubs) {
      toggleExpand(name);
      return;
    }
    setDrill((cur) =>
      cur?.industry === name && cur.subIndustry === null
        ? null
        : { industry: name, subIndustry: null },
    );
  }

  function handleSubClick(industry: string, sub: string): void {
    setDrill((cur) =>
      cur?.industry === industry && cur.subIndustry === sub
        ? null
        : { industry, subIndustry: sub },
    );
  }

  const isDrillTarget = (industry: string, sub: string | null): boolean =>
    drill !== null && drill.industry === industry && drill.subIndustry === sub;

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
          const hasSubs = ind.subs.length > 0;
          const isExpanded = hasSubs
            ? expanded.has(ind.name)
            : isDrillTarget(ind.name, null);
          return (
            <li key={ind.name} data-testid={`sector-row-${ind.name}`} className="border-b border-line py-1">
              <button
                type="button"
                onClick={() => handleIndustryClick(ind.name, hasSubs)}
                aria-expanded={isExpanded}
                data-testid={`sector-row-btn-${ind.name}`}
                className="w-full flex items-center gap-1 text-left hover:text-ink cursor-pointer pointer-coarse:min-h-11"
              >
                <span aria-hidden="true" className="text-ink-dim w-4 shrink-0">
                  {isExpanded ? "▾" : "▸"}
                </span>
                <span className="flex-1 flex items-center justify-between">
                  <span className="text-ink">
                    {ind.name}
                    <span className="text-ink-dim ml-1">({ind.members})</span>
                  </span>
                  <GroupStatsRow group={ind} />
                </span>
              </button>
              {!hasSubs && isDrillTarget(ind.name, null) && (
                <MembersPanel query={membersQuery} />
              )}
              {hasSubs && expanded.has(ind.name) && (
                <ul className="pl-6 mt-1 flex flex-col gap-1">
                  {ind.subs.map((sub) => (
                    <li key={sub.name}>
                      <button
                        type="button"
                        onClick={() => handleSubClick(ind.name, sub.name)}
                        aria-expanded={isDrillTarget(ind.name, sub.name)}
                        data-testid={`sub-row-${ind.name}-${sub.name}`}
                        className="w-full flex items-center justify-between text-left hover:text-ink cursor-pointer pointer-coarse:min-h-11"
                      >
                        <span className="text-ink-muted">
                          {sub.name}
                          <span className="text-ink-dim ml-1">({sub.members})</span>
                        </span>
                        <GroupStatsRow group={sub} />
                      </button>
                      {isDrillTarget(ind.name, sub.name) && (
                        <MembersPanel query={membersQuery} />
                      )}
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
    </section>
  );
}
