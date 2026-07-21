/**
 * 分點名稱統一顯示 formatter(SC-7)。
 *
 * 兩個 FinMind dataset 的分點名稱格式不同:
 * - taiwan_stock_trading_daily_report:「元大松江」(無 dash)
 * - TaiwanSecuritiesTraderInfo(directory):「元大-松江」(帶 dash)
 * 全前端顯示統一為「{broker_id} {去dash名稱}」,例「9801 元大松江」。
 * 只動顯示字串;selection / API 契約仍以 broker_id 為 key。
 */
export function formatBrokerLabel(id: string, name: string | null): string {
  const cleaned = (name ?? "").replace(/-/g, "").trim();
  return [id, cleaned].filter(Boolean).join(" ");
}
