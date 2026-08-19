import { useMemo } from "react";
import { api } from "../lib/api";
import type { ChipBubbleData, ChipBubbleWindowData } from "../lib/chip-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

/**
 * days = 1(預設)走既有 /bubble;days > 1 走 /bubble_window 的 N 日聚合。
 * days 進 queryKey → 切天數自動 refetch,且各天數獨立 cache。
 */
export function useChipBubble(symbol: string, date: string, days: number = 1) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<
    ChipBubbleData | ChipBubbleWindowData
  >({
    queryKey: ["chip-bubble", symbol, date, days],
    queryFn: async (force, { signal }) =>
      days > 1
        ? api.chipBubbleWindow(symbol, date, days, force, { signal })
        : api.chipBubble(symbol, date, force, { signal }),
    enabled: symbol !== "",
  });

  // [review F1] windowMeta 必須是 referentially stable:App 的 bubbleDayMarks
  // useMemo 以它為依賴,每 render 重建物件會讓那層 memo 永遠 miss,連帶
  // BubbleChartSvg 的 memo 也每次重繪(brush 拖曳每幀都吃)。值本身不變。
  const windowMeta = useMemo(
    () =>
      data && days > 1 && "window_days" in data
        ? {
            windowDays: data.window_days,
            actualDays: data.actual_days,
            // SC-4:每日開 / 收標示的槽位定義(App 用它與 history.candles 取交集)。
            tradingDates: data.trading_dates,
          }
        : null,
    [data, days],
  );

  return {
    data: data ?? null,
    windowMeta,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
