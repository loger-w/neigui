/**
 * @vitest-environment jsdom
 *
 * IssuerRankPanel — 發行商信任排行收合面板(SC-5)。
 * Mock 走 vi.spyOn(api),不 mock hooks(frontend-testing 慣例)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { IssuerRankPayload } from "../lib/warrant-data";
import { IssuerRankPanel } from "./IssuerRankPanel";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const payload: IssuerRankPayload = {
  as_of_date: "2026-07-10",
  built_from_days: 10,
  n_strata_total: 9,
  issuers: [
    {
      issuer_id: "9800",
      issuer_name: "元大",
      n_warrants: 120,
      n_scored: 95,
      iv_std_median: 0.0082,
      spread_median: 0.021,
      declining_share: 0.05,
      iv_score: 0.25,
      spread_score: 0.31,
      declining_score: 0.42,
      n_strata: 8,
      composite: 0.12,
      rank: 1,
      tier: "front",
    },
    {
      issuer_id: "7777",
      issuer_name: "小樣本",
      n_warrants: 3,
      n_scored: 2,
      iv_std_median: 0.02,
      spread_median: 0.03,
      declining_share: 0.5,
      iv_score: 0.9,
      spread_score: 0.8,
      declining_score: 0.5,
      n_strata: 1,
      composite: 0.6,
      rank: null,
      tier: null,
    },
  ],
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("IssuerRankPanel", () => {
  it("預設收合且不 fetch;展開才抓並列出排行", async () => {
    const spy = vi.spyOn(api, "issuerRank").mockResolvedValue(payload);
    render(<IssuerRankPanel />, { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /發行商排行/ }));
    await waitFor(() => expect(screen.getByText("元大")).toBeTruthy());
    expect(spy).toHaveBeenCalledTimes(1);
    // rank / tier / 三欄改列層內分數(v2;低=佳)
    expect(screen.getByText("前段")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy(); // iv_score 0.25
    expect(screen.getByText("31.0%")).toBeTruthy(); // spread_score
    expect(screen.getByText("42.0%")).toBeTruthy(); // declining_score
    // 原始中位數退居 cell tooltip,不再是表格文字
    expect(screen.queryByText("0.8%")).toBeNull();
    expect(screen.getByText("25.0%").getAttribute("title")).toMatch(/0\.8%/);
    // 計分欄 tooltip 帶覆蓋層數
    expect(screen.getByText("95/120").getAttribute("title")).toMatch(/8 層/);
    // 樣本不足者 tier 顯示 —(不評級),分數欄仍有值
    expect(screen.getByText("小樣本")).toBeTruthy();
    expect(screen.getByText("90.0%")).toBeTruthy(); // 小樣本 iv_score 0.9
  });

  it("面板標注收盤 proxy 口徑與基準日", async () => {
    vi.spyOn(api, "issuerRank").mockResolvedValue(payload);
    render(<IssuerRankPanel />, { wrapper: makeQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /發行商排行/ }));
    await waitFor(() => expect(screen.getByText(/2026-07-10/)).toBeTruthy());
    expect(screen.getByText(/收盤報價推算/)).toBeTruthy();
    // v2 分層口徑取代「未分層」警語
    expect(screen.getByText(/層內取分位/)).toBeTruthy();
    expect(screen.queryByText(/未按價內外/)).toBeNull();
    expect(screen.queryByText(/跨規模比較請保留/)).toBeNull();
    expect(screen.queryByText(/官方評等/)).toBeNull(); // 不得自稱官方評等
  });

  it("not ready(503)→ 友善文案,不裸拋 error code", async () => {
    vi.spyOn(api, "issuerRank").mockRejectedValue(new Error("issuer_rank_not_ready"));
    render(<IssuerRankPanel />, { wrapper: makeQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /發行商排行/ }));
    await waitFor(() => expect(screen.getByText(/尚未就緒/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.queryByText("issuer_rank_not_ready")).toBeNull();
  });

  it("再點一次收合(面板可開可關)", async () => {
    vi.spyOn(api, "issuerRank").mockResolvedValue(payload);
    render(<IssuerRankPanel />, { wrapper: makeQueryWrapper() });
    const btn = screen.getByRole("button", { name: /發行商排行/ });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("元大")).toBeTruthy());
    fireEvent.click(btn);
    expect(screen.queryByText("元大")).toBeNull();
  });

  it("嚴禁方向性文案(TXO domain 鐵則同源)", async () => {
    vi.spyOn(api, "issuerRank").mockResolvedValue(payload);
    render(<IssuerRankPanel />, { wrapper: makeQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /發行商排行/ }));
    await waitFor(() => expect(screen.getByText("元大")).toBeTruthy());
    expect(screen.queryByText(/做多|做空|買進|賣出|建議|推薦/)).toBeNull();
  });
});

describe("IssuerRankPanel review 修正批(Phase 5)", () => {
  it("非預期 error 不裸拋 code,顯示繁中 fallback(CLAUDE.md §3)", async () => {
    vi.spyOn(api, "issuerRank").mockRejectedValue(new Error("warrant_upstream"));
    render(<IssuerRankPanel />, { wrapper: makeQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /發行商排行/ }));
    await waitFor(() => expect(screen.getByText(/排行載入失敗/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.queryByText("warrant_upstream")).toBeNull();
  });
});
