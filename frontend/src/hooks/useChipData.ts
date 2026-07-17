import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChipHistoryMajor } from "../lib/api";
import type { ChipHistory, ChipSummary } from "../lib/chip-data";
import { addDays } from "../lib/date-utils";

// 主力線階梯視窗(chip-major-lazy-window):FinMind TradingDailyReport 只接受
// 單日查詢,每個交易日 1 request — 540 日曆日 ≈ 360 requests。初載只抓
// 150 日曆日(≈100 交易日,覆蓋 K 線預設 KLINE_ZOOM_DEFAULT=90 根 + 假期
// 緩衝);使用者拖曳/縮放使可見左界超出覆蓋才升下一檔(150→300→540,可
// 跳檔)。舊行為「fast 成功後自動背景抓 540」已移除 — 每檔新標的省
// ~260 requests,並消滅 fan-out 長時間佔用 rate limiter 的窗口。
// 設計細節:.claude/mod/chip-major-lazy-window/change-spec.md §6。
const MAJOR_FAST_DAYS = 150;
const MAJOR_FULL_DAYS = 540;
const MAJOR_TIERS = [MAJOR_FAST_DAYS, 300, MAJOR_FULL_DAYS] as const;

interface MajorData {
  days: number;
  payload: ChipHistoryMajor;
}

/**
 * Chip overview data hook.
 *
 * Three independent queries:
 * - summary: keyed by symbol + date — refetches on either change
 * - historyBase (candles + institutional + margin): cold ~1.5s
 * - major: 階梯視窗(tier ∈ 150/300/540 日曆日),初載 150 與 base 並行
 *
 * major 的 queryKey 帶檔位,升檔 = 換 key 重抓(backend per-day cache
 * `{symbol}_{d}_major` 讓成本只有增量)。`placeholderData` 在升檔換 key 時
 * 保留前檔資料(subchart 不閃空),並用 payload.symbol guard 防 symbol
 * pivot 閃前一檔股票的資料(同 summary 慣例)。
 *
 * 升檔觸發:`ensureMajorCoverage(可見最左 K 線日期)` — ChipKlineChart 於
 * windowRange 變化時回報。政策:以 payload.last_date 為 anchor(= backend
 * clock.today(),不在前端 new Date()),取能覆蓋 fromDate 的最小檔位;同
 * 檔冪等(拖曳連續事件天然去重)。anchor 未到(初載在途)時記入
 * lastReportRef,major 落地的 effect 補跑 — 封掉「出界回報早於資料落地」
 * 的死區(change-spec R1);ref 帶 symbol 防前一檔股票的舊回報誤升新檔。
 *
 * Date-only changes therefore re-fetch only the summary; the K-line stays
 * visible. `placeholderData` keeps the prior summary on screen while the
 * new one loads — BUT only when the symbol is the same; on symbol pivot
 * we clear, so the panel never flashes the previous symbol's brokers.
 *
 * `loading` is OR of summary + historyBase (NOT major) so the "重新整理"
 * button doesn't stay spinning while the major fan-out populates.
 * `majorLoading` drives the K-line major-subchart 整版 overlay,只在「尚無
 * 任何 major 資料」時亮;升檔在途走 `majorFetching` + 缺料區段 overlay
 * (`majorCoverageStart` 提供已落地覆蓋左界)。
 */
export function useChipData(symbol: string, date: string) {
  const queryClient = useQueryClient();
  const summaryForceRef = useRef(false);
  const historyForceRef = useRef(false);

  const summaryQ = useQuery<ChipSummary, Error>({
    queryKey: ["chip-summary", symbol, date],
    queryFn: async ({ signal }) => {
      const force = summaryForceRef.current;
      summaryForceRef.current = false;
      return api.chip(symbol, date, force, { signal });
    },
    enabled: symbol !== "",
    placeholderData: (prev) => (prev?.symbol === symbol ? prev : undefined),
  });

  // K 線一次抓 540 天歷史(約 360 個 trading days = 1.5 年)讓滾輪縮放純前端
  // slice 沒有 round-trip;gzipped payload ≈ 25-35KB,initial load 仍合理。
  const historyBaseQ = useQuery<ChipHistory, Error>({
    queryKey: ["chip-history", symbol, "base"],
    queryFn: async ({ signal }) => {
      const force = historyForceRef.current;
      return api.chipHistoryBase(symbol, MAJOR_FULL_DAYS, force, { signal });
    },
    enabled: symbol !== "",
  });

  // 檔位 state:derived reset(不用 effect reset — 那會產生「新 symbol +
  // 舊檔位」的中間 render,對新 symbol 直接發大檔位請求)。跨 symbol 殘留
  // (重訪已升檔 symbol 恢復其檔位)是接受的行為,見 change-spec §6.1 R5。
  const [tier, setTier] = useState<{ symbol: string; days: number }>({
    symbol,
    days: MAJOR_FAST_DAYS,
  });
  const majorDays = tier.symbol === symbol ? tier.days : MAJOR_FAST_DAYS;

  const majorQ = useQuery<MajorData, Error>({
    queryKey: ["chip-history", symbol, "major", majorDays],
    queryFn: async ({ signal }) => {
      const force = historyForceRef.current;
      const payload = await api.chipHistoryMajor(symbol, majorDays, force, { signal });
      return { days: majorDays, payload };
    },
    enabled: symbol !== "",
    placeholderData: (prev) => (prev?.payload.symbol === symbol ? prev : undefined),
  });

  // 最後一次可見左界回報(升檔需求),帶 symbol 防跨 symbol 誤升(R1)。
  const lastReportRef = useRef<{ symbol: string; fromDate: string } | null>(null);

  // anchor 抽成字串 dep:majorQ.data 每次落地都是新物件,但 last_date 通常
  // 不變 — 依賴字串讓 applyPolicy / ensureMajorCoverage 的 identity 穩定,
  // chart 的回報 effect 不會在每次資料落地時空轉重跑。
  const majorAnchor = majorQ.data?.payload.last_date;
  const applyPolicy = useCallback(
    (fromDate: string) => {
      if (!majorAnchor) return; // 初載在途 — 由下方補跑 effect 接手
      const needed =
        MAJOR_TIERS.find((t) => addDays(majorAnchor, -t) <= fromDate) ?? MAJOR_FULL_DAYS;
      if (needed > majorDays) setTier({ symbol, days: needed });
    },
    [majorAnchor, majorDays, symbol],
  );

  const ensureMajorCoverage = useCallback(
    (fromDate: string) => {
      lastReportRef.current = { symbol, fromDate };
      applyPolicy(fromDate);
    },
    [symbol, applyPolicy],
  );

  // R1 死區補跑:major 資料落地時,對最後回報的可見左界重跑升檔政策 —
  // 涵蓋「初載在途就 zoom-out(anchor 當時還是 null)」的需求。
  useEffect(() => {
    const rep = lastReportRef.current;
    if (majorQ.data && rep && rep.symbol === symbol) applyPolicy(rep.fromDate);
  }, [majorQ.data, symbol, applyPolicy]);

  const history = useMemo<ChipHistory | null>(() => {
    if (!historyBaseQ.data) return null;
    // 升檔在途 placeholder 提供前檔 rows;尚無任何 major 時 `major: []`
    // 讓 K-line subchart 先渲染(ChipKlineChart 既有 `?? 0` fallback)。
    const majorRows = majorQ.data?.payload.major ?? [];
    return { ...historyBaseQ.data, major: majorRows };
  }, [historyBaseQ.data, majorQ.data]);

  // 已落地檔位的覆蓋左界(升檔在途 = 前檔的)— 缺料區段 overlay 幾何依據。
  const majorCoverageStart = useMemo<string | null>(() => {
    const d = majorQ.data;
    return d ? addDays(d.payload.last_date, -d.days) : null;
  }, [majorQ.data]);

  const summaryLoading = summaryQ.isFetching;
  // historyLoading drives the top "重新整理" spinner; the major fan-out gets
  // its own flags so the global spinner doesn't stay on for seconds.
  const historyLoading = historyBaseQ.isFetching;
  // 整版 overlay:只在「尚無任何 major 資料」時;placeholder 算有資料,
  // 升檔在途不整版蓋(改由 majorFetching + 缺料區段 overlay 表達)。
  const majorLoading = majorQ.data == null && majorQ.isFetching;
  const majorFetching = majorQ.isFetching;
  const error = summaryQ.error ?? historyBaseQ.error ?? majorQ.error;

  return {
    summary: summaryQ.data ?? null,
    history,
    loading: summaryLoading || historyLoading,
    summaryLoading,
    historyLoading,
    majorLoading,
    majorFetching,
    majorCoverageStart,
    ensureMajorCoverage,
    error: error ? error.message : null,
    refresh: () => {
      summaryForceRef.current = true;
      historyForceRef.current = true;
      // cancel-before-refetch(fix/force-refresh-race):in-flight fetch 的
      // refetch() 會被 join 不重跑 queryFn,旗標消費不到 → 先 cancel 讓每個
      // refetch 必然重跑。["chip-history", symbol] 前綴同時涵蓋 base 與 major。
      queryClient.cancelQueries({ queryKey: ["chip-summary", symbol, date] });
      queryClient.cancelQueries({ queryKey: ["chip-history", symbol] });
      summaryQ.refetch();
      historyBaseQ.refetch();
      // major 只重抓當前檔位;settle 後清 force flag(base 讀 flag 不清,
      // 沿用既有時序)。
      majorQ.refetch().finally(() => {
        historyForceRef.current = false;
      });
    },
  };
}
