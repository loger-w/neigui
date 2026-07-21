import { useEffect, useRef, useState } from "react";
import { useBrokerDailyFlows } from "../hooks/useBrokerDailyFlows";
import { useTraderSearch } from "../hooks/useTraderSearch";
import {
  formatAmountZh,
  type FlowStockRow,
  type TraderHit,
} from "../lib/broker-flows-data";
import { cn } from "../lib/utils";

// 分點反查 tab(feat/broker-daily-flows SC-4/5/6):搜尋分點 → 金額買超/
// 金額賣超雙表(分類鍵 = 排序鍵 = net_amount,design R5;bull 紅/bear 綠
// 台股慣例)→ 點列跳轉籌碼總覽並預選該分點。

interface Props {
  active: boolean;
  onPickStock: (stockId: string, stockName: string | null, brokerId: string) => void;
}

// detail.error code → 繁中(review C1/P2SUM-2;未知 code 原樣顯示,對齊
// WarrantFlowPanel 慣例)
const ERROR_TEXT: Record<string, string> = {
  broker_flows_unavailable: "分點資料尚未上料(每交易日約 21:00 更新)",
  broker_not_found: "找不到該分點",
  broker_directory_unavailable: "分點目錄暫時無法取得",
};

export function BrokerFlowsPanel({ active, onPickStock }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selected, setSelected] = useState<TraderHit | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(query.trim()), 200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  // review V1:選定後 query = 「id name」echo,refocus 時不得拿 echo 去查
  // (必然 0 命中 → 誤導性「查無符合分點」+ 白燒一次目錄查詢)
  const selectedEcho = selected ? `${selected.broker_id} ${selected.broker_name}` : "";
  const dropdownActive = open && !!debounced && debounced !== selectedEcho;
  const search = useTraderSearch(dropdownActive ? debounced : "");
  const flows = useBrokerDailyFlows(selected?.broker_id ?? "", active);

  const hits = search.data ?? [];
  const truncated = search.total !== null && search.total > hits.length;

  // review V2:scroll 只在 activeIdx 實際變更時發生(inline ref callback 每
  // render 重跑 detach/attach,會把使用者手動捲動位置拉回)
  const activeItemRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIdx]);

  const pickTrader = (hit: TraderHit) => {
    setSelected(hit);
    setQuery(`${hit.broker_id} ${hit.broker_name}`);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[activeIdx];
      if (hit) pickTrader(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div data-testid="broker-flows-view" className="h-full flex flex-col overflow-hidden">
      {/* 搜尋列 + 選定徽章 */}
      <div className="shrink-0 px-4 py-3 border-b border-line flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-[260px] max-w-full">
          <input
            type="text"
            value={query}
            aria-label="搜尋分點"
            placeholder="搜尋分點名稱或代號..."
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-1.5 text-sm bg-bg border border-line text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          />
          {dropdownActive && (
            hits.length > 0 ? (
              <ul
                role="listbox"
                aria-label="分點搜尋結果"
                className="absolute z-10 top-full left-0 right-0 mt-px max-h-64 overflow-y-auto bg-bg-deep border border-line-strong text-sm"
              >
                {hits.map((h, i) => (
                  <li
                    key={h.broker_id}
                    role="option"
                    aria-selected={i === activeIdx}
                    ref={
                      i === activeIdx
                        ? (el) => {
                            activeItemRef.current = el;
                          }
                        : undefined
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickTrader(h);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "px-3 py-1.5 cursor-pointer",
                      i === activeIdx ? "bg-accent/10 text-ink" : "text-ink-muted",
                    )}
                  >
                    {h.broker_id} {h.broker_name}
                  </li>
                ))}
                {truncated && (
                  // F-2:非 option 提示列 — 不入鍵盤導航(activeIdx 只走 hits),
                  // preventDefault 防點擊觸發 input blur 關 dropdown(review R4)
                  <li
                    role="presentation"
                    onMouseDown={(e) => e.preventDefault()}
                    className="px-3 py-1.5 text-xs text-ink-dim border-t border-line cursor-default"
                  >
                    共 {search.total} 筆,僅列前 {hits.length},請輸入更精確關鍵字
                  </li>
                )}
              </ul>
            ) : (
              // review C1/S4:目錄故障 / 查無結果不得靜默 — 搜尋框下方要有出口
              <div className="absolute z-10 top-full left-0 right-0 mt-px px-3 py-1.5 bg-bg-deep border border-line-strong text-sm text-ink-dim">
                {search.error
                  ? ERROR_TEXT[search.error] ?? search.error
                  : search.loading
                    ? "搜尋中..."
                    : "查無符合分點"}
              </div>
            )
          )}
        </div>
        {selected && (
          <span className="inline-block px-1.5 py-px border border-line-strong text-ink text-xs">
            {selected.broker_id} {selected.broker_name}
          </span>
        )}
        {flows.data && (
          <span className="text-xs text-ink-dim">資料日 {flows.data.as_of_date.slice(5)}</span>
        )}
        {flows.data && flows.data.stock_count > 60 && (
          <span className="text-xs text-ink-dim">
            共 {flows.data.stock_count} 檔,各列前 30
          </span>
        )}
        {selected && (
          <button
            type="button"
            onClick={flows.refresh}
            disabled={flows.loading}
            aria-label={flows.loading ? "資料載入中" : "重新整理分點資料"}
            aria-busy={flows.loading || undefined}
            className="ml-auto px-3 py-1.5 pointer-coarse:min-h-11 text-xs border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 transition-colors cursor-pointer"
          >
            重新整理
          </button>
        )}
      </div>

      {flows.noTradingDay && flows.data && (
        <div className="shrink-0 px-4 py-1.5 text-xs text-ink-muted bg-accent/[0.06] border-b border-line">
          {flows.data.requested_date} 尚無資料,顯示 {flows.data.as_of_date}
        </div>
      )}
      {flows.error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {ERROR_TEXT[flows.error] ?? flows.error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!selected ? (
          <Centered>搜尋分點名稱或代號,檢視該分點當日買賣超股票</Centered>
        ) : flows.loading && !flows.data ? (
          <Centered>載入分點買賣超資料中...</Centered>
        ) : flows.data ? (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <FlowTable
              title="金額買超"
              tone="bull"
              rows={flows.data.buy_top}
              emptyText="無買超"
              testId="broker-flows-buy"
              brokerId={flows.data.broker_id}
              onPickStock={onPickStock}
            />
            <FlowTable
              title="金額賣超"
              tone="bear"
              rows={flows.data.sell_top}
              emptyText="無賣超"
              testId="broker-flows-sell"
              brokerId={flows.data.broker_id}
              onPickStock={onPickStock}
            />
          </div>
        ) : null}
      </div>
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

function FlowTable({
  title,
  tone,
  rows,
  emptyText,
  testId,
  brokerId,
  onPickStock,
}: {
  title: string;
  tone: "bull" | "bear";
  rows: FlowStockRow[];
  emptyText: string;
  testId: string;
  brokerId: string;
  onPickStock: Props["onPickStock"];
}) {
  return (
    <section data-testid={testId} className="min-w-0">
      <h3
        className={cn(
          "text-sm font-medium mb-2",
          tone === "bull" ? "text-bull" : "text-bear",
        )}
      >
        {title}
      </h3>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-ink-dim text-sm border border-line">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-dim border-b border-line-strong">
                <th className="text-left font-normal py-1.5 pr-2">代號 / 名稱</th>
                <th className="text-right font-normal py-1.5 px-2">買進(張)</th>
                <th className="text-right font-normal py-1.5 px-2">賣出(張)</th>
                <th className="text-right font-normal py-1.5 px-2">買賣超(張)</th>
                <th className="text-right font-normal py-1.5 pl-2">金額</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.stock_id}
                  role="button"
                  tabIndex={0}
                  aria-label={`檢視 ${r.stock_name || r.stock_id} 籌碼總覽`}
                  onClick={() => onPickStock(r.stock_id, r.stock_name || null, brokerId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onPickStock(r.stock_id, r.stock_name || null, brokerId);
                    }
                  }}
                  className="border-b border-line cursor-pointer hover:bg-accent/[0.06] focus:bg-accent/[0.06] focus:outline-none"
                >
                  <td className="py-1.5 pr-2">
                    <span className="text-ink">{r.stock_id}</span>{" "}
                    <span className="text-ink-muted">{r.stock_name || r.stock_id}</span>
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums text-ink-muted">
                    {r.buy_lots.toLocaleString("en-US")}
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums text-ink-muted">
                    {r.sell_lots.toLocaleString("en-US")}
                  </td>
                  <td
                    className={cn(
                      "text-right py-1.5 px-2 tabular-nums",
                      r.net_lots > 0 ? "text-bull" : r.net_lots < 0 ? "text-bear" : "text-ink-dim",
                    )}
                  >
                    {r.net_lots.toLocaleString("en-US")}
                  </td>
                  <td
                    className={cn(
                      "text-right py-1.5 pl-2 tabular-nums",
                      tone === "bull" ? "text-bull" : "text-bear",
                    )}
                  >
                    {formatAmountZh(r.net_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
