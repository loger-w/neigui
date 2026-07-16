/** Pure YYYY-MM-DD date arithmetic — UTC 錨定,無 wall-clock 依賴。
 *  (§3「new Date() 只在邊界」:這裡是確定性換算,非取當下時間。) */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}
