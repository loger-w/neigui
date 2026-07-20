import type { RequestOptions } from "./api";
import { apiOrigin } from "./api-base";
import type { MarketSnapshot, SectorMembers } from "./market-types";

const BASE = "/api/market";

/**
 * 直接 fetch,**不** 經 lib/api.ts 的 __apiGet 5-min cache。
 *
 * 設計理由(design.md §6.7):polling 2.5s 跟 __apiGet 內建 5-min _cache
 * 會撞,前端 UI 凍結;TanStack Query 自身已 dedup 同 queryKey 並發,不需
 * 第二層 client cache。
 *
 * signal 由 TanStack Query queryFn 傳入,mode 切走時 abort — 冷啟動
 * 190s+ 的 EOD compute 網路層立刻中斷,不再霸佔 rate slot。
 */
export async function fetchMarketSnapshot(
  refresh: boolean,
  options?: RequestOptions,
): Promise<MarketSnapshot> {
  const url = new URL(`${BASE}/snapshot`, apiOrigin());
  if (refresh) url.searchParams.set("refresh", "true");

  const resp = await fetch(url.toString(), { signal: options?.signal });
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as
      | { detail?: { error?: string } }
      | null;
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<MarketSnapshot>;
}

/**
 * SC-3 族群輪動三層鑽取:`GET /api/market/sector_members`(不經 __apiGet 5-min
 * cache,理由同 fetchMarketSnapshot;5s snapshot cache 已由 backend 保證同步)。
 * 未知 industry/sub_industry → 404 unknown_sector,轉一般 Error 讓 caller 顯示
 * 繁中錯誤字。
 */
export async function fetchSectorMembers(
  industry: string,
  subIndustry: string | null,
  options?: RequestOptions,
): Promise<SectorMembers> {
  const url = new URL(`${BASE}/sector_members`, apiOrigin());
  url.searchParams.set("industry", industry);
  if (subIndustry !== null) url.searchParams.set("sub_industry", subIndustry);

  const resp = await fetch(url.toString(), { signal: options?.signal });
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as
      | { detail?: { error?: string } }
      | null;
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<SectorMembers>;
}
