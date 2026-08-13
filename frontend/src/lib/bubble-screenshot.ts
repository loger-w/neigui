// feat/bubble-streak-screenshot SC-7(design §4):泡泡圖 SVG → PNG 下載。
// 零新依賴:XMLSerializer → blob URL → Image → canvas → toBlob。
import { PADDING } from "./chip-bubble-svg";
import { CHIP } from "./chip-theme";

const SVG_NS = "http://www.w3.org/2000/svg";

// 窗口標註座標:自 chip-bubble-svg 導出的 PADDING 推導,不抄字面值 ——
// 落在 chart 內區左上,避開 x <= PADDING.left 的價位 label 帶與第一條
// grid 線(design §4 R14/R23)。偏移量與圖內的拖曳提示同一組。
const ANNOTATION_X = PADDING.left + 8;
const ANNOTATION_Y = PADDING.top + 14;
const ANNOTATION_FONT_SIZE = "0.75rem";

/** 檔名:單日 `bubble_{symbol}_{date}.png`;多日 `bubble_{symbol}_{date}_w{days}.png`。 */
export function bubbleScreenshotFilename(
  symbol: string,
  date: string,
  days: number,
): string {
  const suffix = days > 1 ? `_w${days}` : "";
  return `bubble_${symbol}_${date}${suffix}.png`;
}

/** SVG element → standalone markup。
 *  [R5] clone 根 svg 顯式寫入 document root 的 computed font-size(px)—
 *  chip-bubble-svg 的 fontSize 全是 rem 字串(rem 隨大螢幕 root font-size
 *  縮放),standalone 文件的 rem 基準是預設 16px,不寫入會在 ≥1920px 螢幕
 *  (root 112.5%/125%)產出字級不一致的 PNG。
 *  [R14+R23] opts.annotation(days>1 時傳,字串與 badge 同源)→ 在 clone 內
 *  補一個 <text>,PNG 自帶窗口資訊,不與檔名脫鉤。 */
export function serializeSvg(
  svg: SVGSVGElement,
  opts?: { annotation?: string },
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  // BubbleChartSvg 收 px width/height props → attr 恆在;保險起見缺席才不寫。
  const width = svg.getAttribute("width");
  const height = svg.getAttribute("height");
  if (width !== null) clone.setAttribute("width", width);
  if (height !== null) clone.setAttribute("height", height);
  // [impl-review R9] jsdom 下 computed fontSize 可能是空字串 → fallback 16px。
  const rootFont = getComputedStyle(document.documentElement).fontSize || "16px";
  clone.style.fontSize = rootFont;
  if (opts?.annotation) {
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(ANNOTATION_X));
    text.setAttribute("y", String(ANNOTATION_Y));
    text.setAttribute("fill", CHIP.inkMuted);
    text.setAttribute("font-family", CHIP.font);
    text.setAttribute("font-size", ANNOTATION_FONT_SIZE);
    text.textContent = opts.annotation;
    clone.appendChild(text);
  }
  return new XMLSerializer().serializeToString(clone);
}

/** serialize → blob URL → Image → canvas(預設 2x、先鋪不透明 background)→ PNG Blob。
 *  jsdom 無 canvas/Image → 本函式 vitest 不覆蓋,由 e2e download + 真實下載檔驗。
 *  Image error / 取不到 2d context / toBlob null 一律 reject(caller catch 後顯提示)。 */
export async function svgToPngBlob(
  svg: SVGSVGElement,
  opts: { scale?: number; background: string; annotation?: string },
): Promise<Blob> {
  const scale = opts.scale ?? 2;
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("svg 缺少有效的 width/height");
  }
  const markup = serializeSvg(svg, { annotation: opts.annotation });
  const url = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("取不到 canvas 2d context");
    // 先鋪底 —— SVG 本身透明,PNG 直接貼到白底文件會看不到淺色文字。
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob 回傳 null"));
      }, "image/png");
    });
  } finally {
    // 此處是「餵給 Image 的 SVG blob URL」,drawImage 已完成 → 可同步 revoke;
    // 延後 revoke 條款(R13)只針對 downloadBlob 的下載 URL。
    URL.revokeObjectURL(url);
  }
}

/** a[download] click 觸發下載。
 *  [R13] revoke 延後 1000ms + 移除 anchor —— 同步 revoke 會在部分瀏覽器讓
 *  下載中止 / 產出 0 byte 檔。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG 轉圖失敗(Image 載入錯誤)"));
    img.src = url;
  });
}
