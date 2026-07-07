/**
 * options mode golden paths — options-page-v2 四層結構(2026-07-07 改寫)。
 * 對應 .claude/feat/options-page-v2/brainstorm.md SC-6~SC-10。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";

test.describe("options mode", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.addInitScript(() => {
      localStorage.setItem("mode", "options");
      // FAKE fixture 只有月選 202607 rows;頁面預設合約是最近週選
      // (202607W1)會拿到空資料 → 釘住月選讓 data-path assertion 有效。
      localStorage.setItem("opt:contractId", "TXO202607");
    });
    await page.goto("/");
  });

  test("O1: 首屏四層 root 全 visible(SC-6/7/8/9)", async ({ page }) => {
    // 痛點:重排後首屏 = 結論列 + 區間地圖 + 溫度計 + 收合層 toggle。
    // 任一漏 = 對應資料通路斷,前端 silent 空白。
    await expect(page.getByTestId(TESTIDS.optionsConclusion)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsRangeMap)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsThermometer)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.advancedToggle)).toBeVisible();
  });

  test("O2: 結論列生成句子且溫度計四格有判讀(SC-6/8 anti-tautology)", async ({ page }) => {
    // 痛點:結論列「資料不足」fallback 也算 visible — 必須驗 fixture data
    // 真的流通成句(含「TX」與牆數字),四格 tile 齊。
    const conclusion = page.getByTestId(TESTIDS.optionsConclusion);
    await expect(conclusion).toBeVisible();
    await expect(conclusion).toContainText("TX");
    await expect(conclusion).not.toContainText("結論生成資料不足");
    await expect(page.getByTestId(TESTIDS.thermoTile)).toHaveCount(4);
    await expect(page.getByTestId(TESTIDS.optionsThermometer)).toContainText("小台散戶");
  });

  test("O3: RangeMap 牆標記非空(SC-7 anti-tautology + 後端權威值)", async ({ page }) => {
    // 痛點:牆改吃後端 oi_walls payload — 若 as_of 防禦誤觸發或 payload
    // 斷線,牆標記整組消失但 RangeMap 仍 visible。鎖 data-wall 標記存在。
    await expect(page.locator("[data-wall='call']").first()).toBeVisible();
    await expect(page.locator("[data-wall='put']").first()).toBeVisible();
    // Max Pain ▼ 標記同鎖(mp payload 通路)
    await expect(page.getByTestId("rangemap-maxpain").first()).toBeVisible();
  });

  test("O4: 進階統計展開 → 四卡 + NET 對照表 + refresh 可點(SC-9)", async ({ page }) => {
    // 痛點:收合層用 hidden attribute 保留 DOM — 展開前四卡不可見、
    // 展開後全 visible;卡內 refresh 點擊不死 mount。
    await expect(page.getByTestId(TESTIDS.optionsMaxPainCard)).toBeHidden();
    await page.getByTestId(TESTIDS.advancedToggle).click();
    await expect(page.getByTestId(TESTIDS.optionsMaxPainCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsOIWallsCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsPCRCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsInstitutionalCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsNetTable)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.callWall)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.putWall)).toBeVisible();
    const maxPainCard = page.getByTestId(TESTIDS.optionsMaxPainCard);
    const refresh = maxPainCard.getByRole(ROLES.refresh.role, { name: ROLES.refresh.name });
    await refresh.click();
    await expect(maxPainCard).toBeVisible();
  });

  test("O6: RangeMap OI/成交量 toggle 切換(SC-7)", async ({ page }) => {
    // 痛點:toggle 是普通 button role=tab;預設 OI,點成交量後 aria-selected 轉移。
    const oiTab = page.getByRole("tab", { name: "OI" });
    const volTab = page.getByRole("tab", { name: "成交量" });
    await expect(oiTab).toHaveAttribute("aria-selected", "true");
    await volTab.click();
    await expect(volTab).toHaveAttribute("aria-selected", "true");
    await expect(oiTab).toHaveAttribute("aria-selected", "false");
  });
});

// responsive spec SC2:手機 viewport smoke。
test.describe("options mode — mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("O5: 375px 下首屏 root 可見且無水平溢出", async ({ page }) => {
    // 痛點:溫度計 grid-cols-2 在手機收 2 欄;整頁不得水平溢出。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "options"));
    await page.goto("/");
    await expect(page.getByTestId(TESTIDS.optionsConclusion)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsThermometer)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
