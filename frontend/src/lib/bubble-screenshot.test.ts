/**
 * @vitest-environment jsdom
 *
 * feat/bubble-streak-screenshot SC-7:截圖工具函式(design §4)。
 * svgToPngBlob 走 canvas / Image,jsdom 無法覆蓋 —— 由 e2e E44(真實下載檔
 * size > 0)承擔;本檔只測純 DOM 可驗的 filename / serializeSvg。
 */
import { afterEach, describe, expect, it } from "vitest";
import { bubbleScreenshotFilename, serializeSvg } from "./bubble-screenshot";
import { PADDING } from "./chip-bubble-svg";

const SVG_NS = "http://www.w3.org/2000/svg";

function mkSvg(width = 400, height = 300): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "120");
  circle.setAttribute("cy", "80");
  circle.setAttribute("r", "12");
  svg.appendChild(circle);
  return svg;
}

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

describe("bubbleScreenshotFilename", () => {
  it("days=1 → bubble_{symbol}_{date}.png(無 w 後綴)", () => {
    expect(bubbleScreenshotFilename("2330", "2026-08-13", 1)).toBe(
      "bubble_2330_2026-08-13.png",
    );
  });

  it("days>1 → bubble_{symbol}_{date}_w{days}.png", () => {
    expect(bubbleScreenshotFilename("2330", "2026-08-13", 5)).toBe(
      "bubble_2330_2026-08-13_w5.png",
    );
    expect(bubbleScreenshotFilename("3481", "2026-06-26", 20)).toBe(
      "bubble_3481_2026-06-26_w20.png",
    );
  });
});

describe("serializeSvg", () => {
  it("輸出 standalone markup:xmlns + width/height attr + 子節點", () => {
    const out = serializeSvg(mkSvg(640, 480));
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="640"');
    expect(out).toContain('height="480"');
    expect(out).toContain("<circle");
  });

  // [R5/R9] chip-bubble-svg 的 fontSize 全是 rem 字串;standalone 文件的 rem
  // 基準是預設 16px,不寫入 root font-size 會在 ≥1920px 螢幕(root 112.5%/
  // 125%)產出字級不一致的 PNG。
  it("寫入 document root 的 computed font-size(px)到 clone 根 svg", () => {
    document.documentElement.style.fontSize = "20px";
    const out = serializeSvg(mkSvg());
    expect(out).toContain("font-size: 20px");
  });

  it("未傳 annotation → 不插 <text>", () => {
    const out = serializeSvg(mkSvg());
    expect(out).not.toContain("<text");
  });

  it("傳 annotation → 插 <text> 且含該文字", () => {
    const out = serializeSvg(mkSvg(), { annotation: "近 5 個交易日累計" });
    expect(out).toContain("<text");
    expect(out).toContain("近 5 個交易日累計");
  });

  // [R23] annotation 字串與 badge 同源,含「(實際 X 日)」variant。
  it("annotation 帶「(實際 X 日)」variant → 原字串完整出現", () => {
    const out = serializeSvg(mkSvg(), {
      annotation: "近 5 個交易日累計(實際 3 日)",
    });
    expect(out).toContain("近 5 個交易日累計(實際 3 日)");
  });

  // [review-1 ANNOTATION-COORD-COUPLING] 標註座標原本是抄自 chip-bubble-svg 的
  // 字面值(64 / 26)+ 一行「PADDING 若改要跟著改」的註解。註解攔不住改動:
  // 有人調 PADDING.left 後標註會靜默飄到價位 label 帶上,PNG 才看得出來。
  // 改成引用導出的 PADDING,這條測試同時鎖住「引用」與「偏移量」。
  it("annotation <text> 座標 = 導出的 PADDING 偏移(不得回退成硬編值)", () => {
    const out = serializeSvg(mkSvg(), { annotation: "近 5 個交易日累計" });
    expect(out).toContain(`x="${PADDING.left + 8}"`);
    expect(out).toContain(`y="${PADDING.top + 14}"`);
  });

  it("不動原 svg(clone 操作)", () => {
    const svg = mkSvg();
    serializeSvg(svg, { annotation: "近 5 個交易日累計" });
    expect(svg.getAttribute("xmlns")).toBeNull();
    expect(svg.querySelector("text")).toBeNull();
  });
});
