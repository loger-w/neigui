/**
 * 今日結論列的規則模板句(options-page-v2 SC-6,design v3 §1.1)。
 *
 * 純函式、零 React 依賴。素材全部來自既有 payload,句式固定可測試;
 * 判讀句只描述「位置與距離」,嚴禁方向性文案(做多/做空/賣選/滿倉 —
 * design §0 反身性鐵則,由 options-conclusion.test.ts 鎖住)。
 * 資料缺哪段就省哪句,不硬湊。
 */

export interface ConclusionInput {
  spot: number | null;
  putWall: number | null;
  callWall: number | null;
  maxPain: number | null;
}

const fmt = (n: number): string => n.toLocaleString("zh-TW");

/** |現價 − Max Pain| / 現價 低於此值視為「幾乎重合」 */
const NEAR_COINCIDENT = 0.0005;

function positionSentence(
  spot: number, putWall: number | null, callWall: number | null,
): string {
  if (putWall !== null && callWall !== null) {
    // 突破/跌破用嚴格不等 — spot 恰在牆上算區間內邊緣(edge 2)
    if (spot > callWall) return `TX ${fmt(spot)} 已越過壓力 ${fmt(callWall)}`;
    if (spot < putWall) return `TX ${fmt(spot)} 已跌破支撐 ${fmt(putWall)}`;
    const width = callWall - putWall;
    if (width <= 0) return `TX ${fmt(spot)} 貼齊支撐與壓力重合價位 ${fmt(callWall)}`;
    const pos = (spot - putWall) / width;
    const zone = pos < 1 / 3 ? "偏下緣" : pos < 2 / 3 ? "中段" : "偏上緣";
    return `TX ${fmt(spot)} 位於支撐 ${fmt(putWall)} 與壓力 ${fmt(callWall)} 之間,${zone}`;
  }
  if (callWall !== null) {
    if (spot > callWall) return `TX ${fmt(spot)} 已越過壓力 ${fmt(callWall)},下方無明顯 OI 牆`;
    return `TX ${fmt(spot)} 在壓力 ${fmt(callWall)} 之下,下方無明顯 OI 牆`;
  }
  if (putWall !== null) {
    if (spot < putWall) return `TX ${fmt(spot)} 已跌破支撐 ${fmt(putWall)},上方無明顯 OI 牆`;
    return `TX ${fmt(spot)} 在支撐 ${fmt(putWall)} 之上,上方無明顯 OI 牆`;
  }
  return `TX ${fmt(spot)},上下方皆無明顯 OI 牆`;
}

function maxPainSentence(spot: number, maxPain: number): string {
  const diff = (maxPain - spot) / spot;
  if (Math.abs(diff) < NEAR_COINCIDENT) {
    return `Max Pain ${fmt(maxPain)} 與現價幾乎重合`;
  }
  const dir = diff > 0 ? "上方" : "下方";
  return `Max Pain ${fmt(maxPain)} 在現價${dir} ${(Math.abs(diff) * 100).toFixed(1)}%`;
}

export function buildConclusion(input: ConclusionInput): string[] {
  const { spot, putWall, callWall, maxPain } = input;
  const sentences: string[] = [];
  if (spot !== null) {
    sentences.push(positionSentence(spot, putWall, callWall));
    if (maxPain !== null) sentences.push(maxPainSentence(spot, maxPain));
  }
  return sentences;
}
