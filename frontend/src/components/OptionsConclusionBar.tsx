import type { ReactElement } from "react";
import { buildConclusion } from "../lib/options-conclusion";

interface Props {
  spot: number | null;
  putWall: number | null;
  callWall: number | null;
  maxPain: number | null;
}

/** 今日結論列(options-page-v2 SC-6)— 模板句由 lib/options-conclusion
 * 生成;只描述位置與距離,禁方向性文案(測試鎖住)。 */
export function OptionsConclusionBar({
  spot, putWall, callWall, maxPain,
}: Props): ReactElement {
  const sentences = buildConclusion({ spot, putWall, callWall, maxPain });
  return (
    <div
      data-testid="options-conclusion"
      className="shrink-0 px-6 py-3 border-b border-line bg-bg-deep/40"
    >
      {sentences.length === 0 ? (
        <span className="text-sm text-ink-dim">結論生成資料不足</span>
      ) : (
        <p className="text-sm text-ink leading-relaxed">
          <span className="font-semibold">{sentences[0]}</span>
          {sentences.slice(1).map((s) => (
            <span key={s} className="text-ink-muted">;{s}</span>
          ))}
        </p>
      )}
    </div>
  );
}
