/**
 * installFixtureClock — 凍 Playwright browser clock 到 fixture 日期。
 *
 * 配對 backend `FAKE_TODAY=2026-06-26`(R2-P0-3 / R3-P1-CLOCK-ROUTES)。
 * 解決 TanStack Query refetchInterval 干擾 test(brainstorm E5 / F8)。
 *
 * 痛點:不凍 browser clock,polling-based hook(useMarketSnapshot 60s /
 * useOptionsSpot)會持續 refetch,assertion 中途撞 race。
 */
import type { Page } from "@playwright/test";

const FAKE_NOW_ISO = "2026-06-26T13:30:00+08:00";

export async function installFixtureClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(FAKE_NOW_ISO) });
}
