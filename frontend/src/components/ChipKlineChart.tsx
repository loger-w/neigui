import { useCallback, useMemo, useRef, useState } from "react";
import type { ChipHistory } from "../lib/chip-data";
import { KlineChartSvg } from "../lib/chip-kline-svg";
import { InstBarSvg, MarginLineSvg } from "../lib/chip-inst-bar-svg";
import { BrokerAggBarSvg } from "../lib/chip-broker-agg-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import { useBrokerHistory } from "../hooks/useBrokerHistory";

interface Props {
  history: ChipHistory | null;
  symbol: string;
  selectedDate: string;
  selectedBrokerIds: Set<string>;
  onPickDate: (date: string) => void;
  onClearAllBrokers: () => void;
}

export function ChipKlineChart({
  history, symbol, selectedDate, selectedBrokerIds, onPickDate, onClearAllBrokers,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useContainerSize(containerRef);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const brokerHistory = useBrokerHistory(symbol, selectedBrokerIds);

  const derived = useMemo(() => {
    if (!history) return null;
    const { candles, institutional, margin, major } = history;
    const instByDate = new Map(institutional.map((d) => [d.date, d]));
    const majorByDate = new Map((major ?? []).map((d) => [d.date, d]));
    const marginByDate = new Map(margin.map((d) => [d.date, d]));
    return {
      candles,
      majorNet: candles.map((c) => majorByDate.get(c.date)?.major_net ?? 0),
      foreignNet: candles.map((c) => instByDate.get(c.date)?.foreign_net ?? 0),
      trustNet: candles.map((c) => instByDate.get(c.date)?.trust_net ?? 0),
      dealerNet: candles.map((c) => instByDate.get(c.date)?.dealer_net ?? 0),
      marginChange: candles.map((c) => marginByDate.get(c.date)?.margin_change ?? 0),
      shortChange: candles.map((c) => marginByDate.get(c.date)?.short_change ?? 0),
      marginBalance: candles.map((c) => marginByDate.get(c.date)?.margin_balance ?? 0),
      shortBalance: candles.map((c) => marginByDate.get(c.date)?.short_balance ?? 0),
    };
  }, [history]);

  const brokerAggSeries = useMemo(() => {
    if (!derived) return [] as number[];
    const dateNet = new Map<string, number>();
    for (const arr of brokerHistory.series.values()) {
      for (const d of arr) {
        dateNet.set(d.date, (dateNet.get(d.date) ?? 0) + d.net);
      }
    }
    return derived.candles.map((c) => dateNet.get(c.date) ?? 0);
  }, [derived, brokerHistory.series]);

  const handleClickIndex = useCallback(
    (i: number) => {
      if (!derived) return;
      onPickDate(derived.candles[i].date);
    },
    [onPickDate, derived],
  );

  if (!derived) {
    return (
      <div
        ref={containerRef}
        className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm"
      >
        請搜尋股票代號以載入K線圖
      </div>
    );
  }

  const {
    candles, majorNet, foreignNet, trustNet, dealerNet,
    marginChange, shortChange, marginBalance, shortBalance,
  } = derived;

  const selectedIndex = (() => {
    if (!selectedDate) return null;
    const i = candles.findIndex((c) => c.date === selectedDate);
    return i >= 0 ? i : null;
  })();

  const w = width || 600;
  const totalH = height || 500;

  const showBrokerRow = selectedBrokerIds.size > 0;
  const gap = 6;
  // K-line takes 3.5 parts; remainder split across sub-charts.
  // Total = 3.5 + 5 (or 6 if broker row visible).
  const totalParts = 3.5 + (showBrokerRow ? 6 : 5);
  const klineH = Math.round((totalH - gap) * (3.5 / totalParts));
  const subCount = showBrokerRow ? 6 : 5;
  const subH = Math.floor((totalH - gap - klineH) / subCount);
  const lastSubH = totalH - gap - klineH - subH * (subCount - 1);

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col overflow-hidden relative"
    >
      <div style={{ height: klineH, minHeight: 0 }}>
        {klineH > 0 && (
          <KlineChartSvg
            candles={candles}
            width={w}
            height={klineH}
            hoverIndex={hoverIndex}
            onHoverIndex={setHoverIndex}
            selectedIndex={selectedIndex}
            onClickIndex={handleClickIndex}
          />
        )}
      </div>
      <div
        style={{
          height: gap, minHeight: gap, background: "#14110c",
          borderTop: "1px solid #2e2a22", borderBottom: "1px solid #2e2a22",
        }}
      />
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={majorNet} width={w} height={subH}
            label="主力買賣超" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={foreignNet} width={w} height={subH}
            label="外資" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={trustNet} width={w} height={subH}
            label="投信" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div className="border-t border-line/50" style={{ height: subH, minHeight: 0 }}>
        {subH > 0 && (
          <InstBarSvg
            data={dealerNet} width={w} height={subH}
            label="自營商" hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      <div
        className="border-t border-line/50"
        style={{ height: showBrokerRow ? subH : lastSubH, minHeight: 0 }}
      >
        {(showBrokerRow ? subH : lastSubH) > 0 && (
          <MarginLineSvg
            marginData={marginChange}
            shortData={shortChange}
            marginBalanceData={marginBalance}
            shortBalanceData={shortBalance}
            width={w}
            height={showBrokerRow ? subH : lastSubH}
            label="融資融券"
            hoverIndex={hoverIndex}
            selectedIndex={selectedIndex}
          />
        )}
      </div>
      {showBrokerRow && (
        <div
          className="border-t border-line/50 relative"
          style={{ height: lastSubH, minHeight: 0 }}
        >
          {lastSubH > 0 && (
            <BrokerAggBarSvg
              data={brokerAggSeries}
              width={w}
              height={lastSubH}
              label={`分點 (${selectedBrokerIds.size})`}
              hoverIndex={hoverIndex}
              selectedIndex={selectedIndex}
            />
          )}
          <button
            type="button"
            onClick={onClearAllBrokers}
            className="absolute right-2 top-1 text-xs text-ink-dim hover:text-bear cursor-pointer"
          >清除</button>
        </div>
      )}
    </div>
  );
}
