/**
 * @vitest-environment jsdom
 *
 * useBrokerDailyFlows — 分點反查 hook(useWarrantFlow 同構:active gate +
 * useForceRefreshQuery;noTradingDay 對齊跨檔契約)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { BrokerFlowsPayload } from "../lib/broker-flows-data";
import { useBrokerDailyFlows } from "./useBrokerDailyFlows";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<BrokerFlowsPayload>): BrokerFlowsPayload => ({
  broker_id: "9600",
  broker_name: "富邦",
  requested_date: "2026-07-17",
  as_of_date: "2026-07-17",
  no_trading_day: false,
  stock_count: 2,
  fetched_at: "2026-07-17T21:30:00",
  buy_top: [
    { stock_id: "2330", stock_name: "台積電", buy_lots: 500, sell_lots: 100, net_lots: 400, net_amount: 400_500_000 },
  ],
  sell_top: [
    { stock_id: "2412", stock_name: "中華電", buy_lots: 0, sell_lots: 7777, net_lots: -7777, net_amount: -933_240_000 },
  ],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useBrokerDailyFlows", () => {
  it("active=false 或 brokerId 空 → 不 fetch(active gate)", () => {
    const spy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    renderHook(() => useBrokerDailyFlows("9600", false), { wrapper: makeQueryWrapper() });
    renderHook(() => useBrokerDailyFlows("", true), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("active + brokerId → 抓一次,暴露 data / noTradingDay", async () => {
    const spy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    const { result } = renderHook(() => useBrokerDailyFlows("9600", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.data?.buy_top[0]?.stock_id).toBe("2330");
    expect(result.current.noTradingDay).toBe(false);
  });

  it("no_trading_day=true 透傳為 noTradingDay", async () => {
    vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(
      mk({ no_trading_day: true, as_of_date: "2026-07-16" }),
    );
    const { result } = renderHook(() => useBrokerDailyFlows("9600", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.noTradingDay).toBe(true);
  });

  it("refresh() 使下一發帶 refresh=true", async () => {
    const spy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    const { result } = renderHook(() => useBrokerDailyFlows("9600", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy.mock.calls[0]?.[1]).toBe(false);
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toBe(true));
  });

  it("API 失敗 → error 終態", async () => {
    vi.spyOn(api, "brokerDailyFlows").mockRejectedValue(new Error("broker_flows_unavailable"));
    const { result } = renderHook(() => useBrokerDailyFlows("9600", true), {
      wrapper: makeQueryWrapper(),
    });
    // TanStack v5 retry backoff:waitFor 放寬 timeout(frontend-testing)
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toBe("broker_flows_unavailable");
    expect(result.current.loading).toBe(false);
  });
});
