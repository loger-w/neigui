/**
 * API base origin 的環境分支(fix/prd-cancel-propagation)。
 *
 * prd(Vercel)的 `/api` rewrite 不轉發 client abort:瀏覽器 abort 只斷到
 * Vercel edge,edge 對 Railway 的 fetch 照跑 → backend fan-out 殭屍燒完
 * 配額並佔滿 rate limiter(probe 實證見 cancel-chain skill 第五環)。
 * 修法:prd 正式域名直連 Railway,abort 直達 origin(Railway edge 會傳導
 * disconnect,cancel 鏈全通)。
 *
 * - 精確比對 hostname,不用 `.vercel.app` 結尾:preview deploy 的 origin
 *   不在 backend CORS 名單(FRONTEND_ORIGIN 單值),直連會被擋 — 留在
 *   rewrite fallback 路徑(可用,只是沒 cancel)。
 * - dev / e2e(localhost)同源不變,vite proxy 的 cancel 鏈本就通。
 * - Railway URL 與 frontend/vercel.json rewrite destination 同一份拓撲事實,
 *   改 Railway 網域時兩處同步。
 */
export const RAILWAY_ORIGIN = "https://neigui-production.up.railway.app";

const PRD_HOSTNAME = "neigui.vercel.app";

export function apiOrigin(
  loc: { hostname: string; origin: string } = window.location,
): string {
  return loc.hostname === PRD_HOSTNAME ? RAILWAY_ORIGIN : loc.origin;
}
