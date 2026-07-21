/**
 * 分點名稱統一顯示 formatter。
 *
 * 兩個 FinMind dataset 的分點名稱格式不同:
 * - taiwan_stock_trading_daily_report:「元大松江」(無 dash)
 * - TaiwanSecuritiesTraderInfo(directory):「元大-松江」(帶 dash)
 *
 * 顯示分工(mod/broker-label-search-only-id):
 * - 搜尋框情境(input echo + combobox dropdown)→ formatBrokerLabel:
 *   「{broker_id} {去dash名稱}」,例「9801 元大松江」。
 * - 其他顯示點(badge / chips / tooltip / 清單列 / 提示文案)→
 *   formatBrokerName:只顯去dash名稱,名稱缺時 fallback 顯 id。
 * 只動顯示字串;selection / API 契約仍以 broker_id 為 key。
 */
export function formatBrokerLabel(id: string, name: string | null): string {
  const cleaned = (name ?? "").replace(/-/g, "").trim();
  return [id, cleaned].filter(Boolean).join(" ");
}

export function formatBrokerName(id: string, name: string | null): string {
  const cleaned = (name ?? "").replace(/-/g, "").trim();
  return cleaned || id;
}

/**
 * 搜尋比對正規化:去 dash + trim + lowercase。顯示層去 dash 後,使用者照
 * 顯示字樣輸入(「凱基信義」)也要能命中原始含 dash 名稱(「凱基-信義」)—
 * query 與名稱雙邊過此函式再比對。純 dash 輸入會正規化為空字串,呼叫端
 * 須跳過名稱比對分支(空字串 includes 全命中)。
 */
export function normalizeBrokerQuery(s: string): string {
  return s.replace(/-/g, "").trim().toLowerCase();
}
