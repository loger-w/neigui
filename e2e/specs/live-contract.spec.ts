/**
 * SC-11 真打 FinMind upstream contract 3 tests(hard cap by live-guard.ts)。
 * design.md v6 §3 SC-11。
 *
 * LIVE TESTS HARD CAP: 3 — helpers/live-guard.ts globalSetup 階段機械化
 * fs.readFileSync + regex 數 `test(`,> 3 throw。
 *
 * 痛點:e2e:live 燒 FinMind quota + token expiry 易紅。沒 cap,新功能 PR
 * 易順手加 live test 導致 CI 越來越脆 + cost 失控。本 cap 強制 brainstorm
 * 升 SC 才能解。
 */
import { test, expect } from "@playwright/test";

test.describe("@live upstream contract", () => {
  test.beforeAll(() => {
    if (process.env.FAKE_FINMIND === "1") {
      throw new Error("e2e:live 不可在 FAKE_FINMIND=1 下跑 — unset 或設 'real' 再試");
    }
  });

  test("L1: equity chip 真打回應 schema", async ({ request }) => {
    // 痛點:FinMind upstream contract drift — 若 TaiwanStockInstitutionalInvestors
    // 改欄位名,frontend chip-data.ts 解析錯。本 test 真打 1 次抓 drift。
    const r = await request.get("/api/chip/2330?date=2026-06-26");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({
      symbol: expect.any(String),
      institutional: expect.objectContaining({
        foreign: expect.objectContaining({ net: expect.any(Number) }),
        dealer: expect.objectContaining({ net: expect.any(Number) }),
        trust: expect.objectContaining({ net: expect.any(Number) }),
      }),
    });
  });

  test("L2: options max_pain + 期貨情緒 真打回應 schema", async ({ request }) => {
    // 痛點:TaiwanOptionDaily upstream schema drift(strike_price / call_put 等)。
    const r = await request.get("/api/options/max_pain?contract=TXO202607");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({
      contract: "TXO202607",
      current: expect.any(Object),
    });
    // options-page-v2 SC-4/5:TaiwanFuturesDaily(MTX) +
    // TaiwanFuturesInstitutionalInvestors schema drift 防線。live cap=3
    // 不開新 test(,併入本 test(quota +2 request)。
    const retail = await request.get("/api/options/retail_mtx?date=2026-06-26");
    expect(retail.status()).toBe(200);
    const retailBody = await retail.json();
    expect(retailBody).toHaveProperty("series");
    if (retailBody.current != null) {
      expect(retailBody.current).toMatchObject({ ratio: expect.any(Number) });
    }
    const ff = await request.get("/api/options/foreign_futures?date=2026-06-26");
    expect(ff.status()).toBe(200);
    const ffBody = await ff.json();
    if (ffBody.current != null) {
      expect(ffBody.current).toMatchObject({
        long_oi: expect.any(Number),
        short_oi: expect.any(Number),
        net_oi: expect.any(Number),
      });
    }
  });

  test("L3: market snapshot 真打回應 schema", async ({ request }) => {
    // 痛點:taiwan_stock_tick_snapshot upstream schema drift。
    const r = await request.get("/api/market/snapshot");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("sectors");
    expect(body).toHaveProperty("leaderboards");
    // mod/market-today-only:EOD 四欄(breadth/sector_breadth/
    // sector_volume_ratio/sector_amount_share)隨管線移除退役,改今日三欄
    // 存在性(值可 null — 降級語意見 change-spec §1 SC-5)。
    expect(body).toHaveProperty("index_strength");
    expect(body).toHaveProperty("cap_tiers");
    expect(body).toHaveProperty("sector_rotation");
    expect(body).toHaveProperty("universe_size");
    if (body.sector_rotation != null) {
      expect(Array.isArray(body.sector_rotation.industries)).toBe(true);
    }
  });
});
