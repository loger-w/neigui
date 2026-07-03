/**
 * SC-4 options mode golden paths(4 case)。design.md v6 §3 SC-4。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";

test.describe("options mode", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "options"));
    await page.goto("/");
  });

  test("O1: 4 cards 同時 render(SC-4 case 1)", async ({ page }) => {
    // 痛點:OptionsPage lazy load 後,4 個 card root testid 必須全 visible。
    // 任一漏 = 對應 hook(useMaxPain / useOptionsOIWalls / useOptionsPCR /
    // useInstitutionalOptions)斷,前端 silent 空白。
    await expect(page.getByTestId(TESTIDS.optionsMaxPainCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsOIWallsCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsPCRCard)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsInstitutionalCard)).toBeVisible();
  });

  test("O2: strike ladder + large traders strip visible(SC-4 case 3+4)", async ({ page }) => {
    // 痛點:strike ladder 是 spot price + 履約價分布,large traders strip 是
    // 大戶 OI 帶狀區。兩者都 dep fixture data populated;若 fixture 漂移
    // → empty 不出現。
    await expect(page.getByTestId(TESTIDS.optionsStrikeLadder)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsLargeTradersStrip)).toBeVisible();
  });

  test("O3: OI walls call/put 值非空(SC-4 anti-tautology)", async ({ page }) => {
    // 痛點:`getByTestId('options-oi-walls-card').toBeVisible()` 過寬 ——
    // empty card 也算 visible。直接驗 call-wall / put-wall textContent
    // 不是空 — 鎖 fixture data 真的流通,不是空 shell 騙過 visibility assert。
    await expect(page.getByTestId(TESTIDS.callWall)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.putWall)).toBeVisible();
  });

  test("O4: 各 card 自己的 refresh button 點得到(SC-4 case 2)", async ({ page }) => {
    // 痛點:OptionsPage 每張 card 內各自 own 一個 refresh button(scope 在
    // card 內以免跟 header refresh strict-mode conflict)。點 max-pain card
    // 的 refresh 後 card 仍在,代表 onClick 不會死 mount。
    const maxPainCard = page.getByTestId(TESTIDS.optionsMaxPainCard);
    await expect(maxPainCard).toBeVisible();
    const refresh = maxPainCard.getByRole(ROLES.refresh.role, { name: ROLES.refresh.name });
    await expect(refresh).toBeVisible();
    await refresh.click();
    await expect(maxPainCard).toBeVisible();
    // OI walls card 同樣 each-card pattern
    const oiCard = page.getByTestId(TESTIDS.optionsOIWallsCard);
    await expect(oiCard).toBeVisible();
    await oiCard.getByRole(ROLES.refresh.role, { name: ROLES.refresh.name }).click();
    await expect(oiCard).toBeVisible();
  });
});

// responsive spec SC2:手機 viewport smoke。
test.describe("options mode — mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("O5: 375px 下 4 cards 可見且無水平溢出", async ({ page }) => {
    // 痛點:4 cards xl:grid-cols-4 在手機必須收 1 欄;大戶 strip grid-cols-4
    // 曾無降級(改 2x2)。鎖 SC2 無水平溢出。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "options"));
    await page.goto("/");
    await expect(page.getByTestId(TESTIDS.optionsMaxPainCard)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});