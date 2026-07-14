import { useEffect, useRef, useState } from "react";
import { useWarrantFlow } from "../hooks/useWarrantFlow";
import { useContainerSize } from "../hooks/useContainerSize";
import {
  barRatio,
  formatNet,
  formatValue,
  type WarrantFlowBranch,
  type WarrantFlowPayload,
} from "../lib/warrant-flow-data";
import { cn } from "../lib/utils";

const KIND_TEXT = { call: "認購", put: "認售" } as const;
// SC-5:認購/認售 badge 零紅綠(accent==bull 同色值,資料標籤禁用)—
// WarrantSelector kind badge 同構:實底 vs 框線 + ink 強度。
const KIND_CLASS = {
  call: "text-ink border-line-strong bg-ink/10",
  put: "text-ink-muted border-line-strong",
} as const;

// 「資料日 MM-DD」badge 文案(SC-2;payload date = YYYY-MM-DD)
function fmtDateBadge(iso: string): string {
  return iso.slice(5);
}

function netClass(v: number): string {
  // SC-5:淨買超 = bull(紅)/ 淨賣超 = bear(綠),台股慣例
  if (v > 0) return "text-bull";
  if (v < 0) return "text-bear";
  return "text-ink-dim";
}

export function WarrantFlowPanel({ symbol, active }: { symbol: string; active: boolean }) {
  const { data, loading, error, refresh } = useWarrantFlow(symbol, active);
  const [expandedBroker, setExpandedBroker] = useState<string | null>(null);
  // 恆存 wrapper(loading / error / data 三態都 mount)— useContainerSize
  // null-ref early-return 陷阱(frontend-conventions)
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useContainerSize(wrapRef);
  const stacked = width > 0 && width < 640;

  // 換標的:展開列歸零(舊標的殘留會誤導)
  useEffect(() => setExpandedBroker(null), [symbol]);

  return (
    <div ref={wrapRef} data-testid="warrant-flow-panel" className="h-full flex flex-col overflow-hidden">
      {!symbol ? (
        <Centered>請先搜尋標的後檢視權證分點</Centered>
      ) : error ? (
        error === "no_data" ? (
          <Centered>近 10 個交易日無分點資料</Centered>
        ) : (
          <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
            {error}
          </div>
        )
      ) : loading && !data ? (
        <Centered>彙整分點資料中,首次載入約需數秒...</Centered>
      ) : data?.empty_reason === "no_warrants" ? (
        <Centered>此標的目前無掛牌權證</Centered>
      ) : data?.empty_reason === "no_volume" ? (
        <Centered>
          {data.as_of_date
            ? `資料日 ${fmtDateBadge(data.as_of_date)} 全部權證零成交`
            : "全部權證零成交"}
        </Centered>
      ) : data ? (
        <FlowBody
          data={data}
          stacked={stacked}
          loading={loading}
          onRefresh={refresh}
          expandedBroker={expandedBroker}
          onToggleBroker={(id) => setExpandedBroker((cur) => (cur === id ? null : id))}
        />
      ) : null}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center text-ink-dim text-sm px-4 text-center">
      {children}
    </div>
  );
}

function FlowBody({
  data,
  stacked,
  loading,
  onRefresh,
  expandedBroker,
  onToggleBroker,
}: {
  data: WarrantFlowPayload;
  stacked: boolean;
  loading: boolean;
  onRefresh: () => void;
  expandedBroker: string | null;
  onToggleBroker: (id: string) => void;
}) {
  return (
    <>
      {/* header:資料日 badge + truncated 註記 + 重新整理 */}
      <div className="shrink-0 px-4 py-2 border-b border-line flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {data.as_of_date && (
          <span
            data-testid="flow-date-badge"
            className="inline-block px-1.5 py-px border border-line-strong text-ink"
          >
            資料日 {fmtDateBadge(data.as_of_date)}
          </span>
        )}
        <span className="text-ink-dim">
          有量權證 {data.total_traded} 檔・分點盤後 T+1
        </span>
        {data.truncated && (
          <span className="text-ink-dim">僅統計成交金額前 {data.analyzed} 檔權證</span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="重新整理權證分點"
          className="ml-auto px-2 py-1 pointer-coarse:min-h-11 border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 transition-colors cursor-pointer"
        >
          重新整理
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* summary(SC-2):認購/認售 badge 中性;買賣金額走 bull/bear */}
        <div
          data-testid="flow-summary"
          className="px-4 py-3 border-b border-line flex flex-wrap gap-x-8 gap-y-2 text-xs"
        >
          {(["call", "put"] as const).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span
                className={cn("inline-block px-1.5 py-px border text-[0.7rem]", KIND_CLASS[k])}
              >
                {KIND_TEXT[k]}
              </span>
              <span className="text-ink-dim">買進</span>
              <span className="text-bull tabular-nums">
                {formatValue(data.summary[k].buy_value)}
              </span>
              <span className="text-ink-dim">賣出</span>
              <span className="text-bear tabular-nums">
                {formatValue(data.summary[k].sell_value)}
              </span>
            </div>
          ))}
        </div>

        {/* 兩欄 top15(SC-3):窄容器疊直 */}
        <div className={cn("px-4 py-3 grid gap-6", stacked ? "grid-cols-1" : "grid-cols-2")}>
          <BranchColumn
            side="buy"
            branches={data.top_buy_branches}
            expandedBroker={expandedBroker}
            onToggleBroker={onToggleBroker}
          />
          <BranchColumn
            side="sell"
            branches={data.top_sell_branches}
            expandedBroker={expandedBroker}
            onToggleBroker={onToggleBroker}
          />
        </div>

        {/* 權證明細表(SC-4) */}
        <div className="px-4 pb-4">
          <div className="text-xs text-ink-dim mb-1.5">權證明細(成交金額降序)</div>
          <table data-testid="flow-warrant-table" className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-line-strong text-ink-dim">
                <th scope="col" className="px-2 py-1.5 text-left font-normal">代號</th>
                <th scope="col" className="px-2 py-1.5 text-left font-normal">名稱</th>
                <th scope="col" className="px-2 py-1.5 text-left font-normal">類型</th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">成交金額</th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">淨買賣超</th>
              </tr>
            </thead>
            <tbody>
              {data.warrants.map((w) => (
                <tr
                  key={w.warrant_id}
                  data-testid="flow-warrant-row"
                  data-warrant-id={w.warrant_id}
                  className="border-b border-line hover:bg-bg-deep transition-colors"
                >
                  <td className="px-2 py-1 text-ink font-medium">{w.warrant_id}</td>
                  <td className="px-2 py-1 text-ink-muted">{w.name}</td>
                  <td className="px-2 py-1">
                    <span
                      data-testid="flow-kind-badge"
                      className={cn(
                        "inline-block px-1.5 py-px border text-[0.7rem]",
                        KIND_CLASS[w.kind],
                      )}
                    >
                      {KIND_TEXT[w.kind]}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right text-ink-muted tabular-nums">
                    {formatValue(w.trading_money)}
                  </td>
                  <td
                    data-testid="flow-warrant-net"
                    className={cn("px-2 py-1 text-right tabular-nums", netClass(w.net_value))}
                  >
                    {formatNet(w.net_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function BranchColumn({
  side,
  branches,
  expandedBroker,
  onToggleBroker,
}: {
  side: "buy" | "sell";
  branches: WarrantFlowBranch[];
  expandedBroker: string | null;
  onToggleBroker: (id: string) => void;
}) {
  const maxAbs = branches.reduce((m, b) => Math.max(m, Math.abs(b.net_value)), 0);
  const isBuy = side === "buy";
  return (
    <div data-testid={isBuy ? "flow-buy-col" : "flow-sell-col"}>
      <div className="text-xs text-ink-dim mb-1.5">{isBuy ? "買超 15 大" : "賣超 15 大"}</div>
      {branches.length === 0 ? (
        <div className="text-xs text-ink-dim py-2">無{isBuy ? "淨買超" : "淨賣超"}分點</div>
      ) : (
        <div className="space-y-px">
          {branches.map((b) => {
            const expanded = expandedBroker === b.broker_id;
            return (
              <div key={b.broker_id}>
                <button
                  type="button"
                  onClick={() => onToggleBroker(b.broker_id)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "收合" : "展開"} ${b.broker_name} 權證明細`}
                  className="w-full flex items-center gap-2 px-1 py-1 pointer-coarse:min-h-11 text-xs hover:bg-bg-deep transition-colors cursor-pointer"
                >
                  <span className="w-24 shrink-0 text-left text-ink truncate">
                    {b.broker_name}
                  </span>
                  <span className="relative flex-1 h-2.5 bg-bg-deep overflow-hidden">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0",
                        isBuy ? "bg-bull/60" : "bg-bear/60",
                      )}
                      style={{ width: `${barRatio(b.net_value, maxAbs) * 100}%` }}
                    />
                  </span>
                  <span
                    data-testid={isBuy ? "flow-buy-amount" : "flow-sell-amount"}
                    className={cn(
                      "w-20 shrink-0 text-right tabular-nums",
                      isBuy ? "text-bull" : "text-bear",
                    )}
                  >
                    {formatValue(b.net_value)}
                  </span>
                </button>
                {expanded && (
                  <div className="pl-3 pr-1 py-1.5 border-l border-line-strong ml-1 mb-1">
                    <table className="w-full text-[0.7rem]">
                      <thead>
                        <tr className="text-ink-dim">
                          <th scope="col" className="pr-3 text-left font-normal">代號</th>
                          <th scope="col" className="pr-3 text-left font-normal">名稱</th>
                          <th scope="col" className="pr-3 text-right font-normal">買進</th>
                          <th scope="col" className="pr-3 text-right font-normal">賣出</th>
                          <th scope="col" className="text-right font-normal">淨額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.warrants.map((w) => (
                          <tr key={w.warrant_id} className="text-ink-muted">
                            <td className="pr-3">{w.warrant_id}</td>
                            <td className="pr-3">{w.name}</td>
                            <td className="pr-3 text-right tabular-nums">
                              {formatValue(w.buy_value)}
                            </td>
                            <td className="pr-3 text-right tabular-nums">
                              {formatValue(w.sell_value)}
                            </td>
                            <td
                              className={cn(
                                "text-right tabular-nums",
                                netClass(w.net_value),
                              )}
                            >
                              {formatNet(w.net_value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WarrantFlowPanel;
