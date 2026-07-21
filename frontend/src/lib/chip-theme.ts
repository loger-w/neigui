export const CHIP = {
  bull: "#e85a4f",
  bear: "#7fc99a",
  ink: "#ede4d3",
  inkMuted: "#d4c8b0",
  inkDim: "#8a8273",
  line: "#2e2a22",
  lineStrong: "#4a4234",
  ma5: "#f0b429",
  ma20: "#b794f4",
  intradayLine: "#7c6f55",
  font: '"Inter Tight", system-ui, sans-serif',
} as const;

/** SVG 大標籤字級(OHLC 資訊列、子圖標籤)。桌面 16px 等值;窄容器
 *  (<500px,手機堆疊)降到 13px 等值避免與 bars/資訊互相重疊。
 *  回傳 rem 字串讓大螢幕 root font-size 縮放同步生效(responsive spec SC1)。 */
export function svgLabelFont(width: number): string {
  return width < 500 ? "0.8125rem" : "1rem";
}

/** SVG 圖例字級(MA5 / MA20 / BB 標籤)。桌面 14px 等值;窄容器 12px 等值。 */
export function svgLegendFont(width: number): string {
  return width < 500 ? "0.75rem" : "0.875rem";
}
