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

  return {
    data: data ?? null,
    windowMeta:
      data && days > 1 && "window_days" in data
        ? {
            windowDays: data.window_days,
            actualDays: data.actual_days,
            // SC-4:每日開 / 收標示的槽位定義(App 用它與 history.candles 取交集)。
            tradingDates: data.trading_dates,
          }
        : null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
