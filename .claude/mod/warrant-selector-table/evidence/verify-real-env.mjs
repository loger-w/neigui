// Phase 7 真實環境驗證(DevTools MCP 被另一 session 占用 → playwright chromium 替代)
// 對象:localhost:5173(vite)→ localhost:8000(真 FinMind backend)
import { chromium } from "@playwright/test";

const evidence =
  "C:/side-project/neigui/.claude/worktrees/warrant-selector-table/.claude/mod/warrant-selector-table/evidence";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleBad = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    consoleBad.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => consoleBad.push(`pageerror: ${e.message}`));
const apiReqs = [];
page.on("request", (r) => {
  if (r.url().includes("/api/")) apiReqs.push(r.url());
});

await page.goto("http://localhost:5173/");
await page.getByPlaceholder(/搜尋代號/).fill("2330");
await page.getByRole("option").first().click();
await page.getByRole("button", { name: /^權證$/ }).click();
await page.getByTestId("warrant-row").first().waitFor({ timeout: 120000 });

// SC-1 對齊
await page.screenshot({ path: evidence + "/SC-1_th-alignment.png" });
const alignLeft = await page
  .locator("thead th", { hasText: "代號" })
  .evaluate((el) => getComputedStyle(el).textAlign);
const alignRight = await page
  .locator("thead th", { hasText: "履約價" })
  .evaluate((el) => getComputedStyle(el).textAlign);

// SC-2 發行商下拉
const issuerOpts = await page.getByLabel("發行商篩選").locator("option").allTextContents();
const rowsBefore = await page.getByTestId("warrant-row").count();
await page.getByLabel("發行商篩選").selectOption({ index: 1 });
await page.waitForTimeout(400);
const rowsFiltered = await page.getByTestId("warrant-row").count();
await page.screenshot({ path: evidence + "/SC-2_issuer-filter.png" });
await page.getByTestId("filter-reset-btn").click();
await page.waitForTimeout(400);
const rowsReset = await page.getByTestId("warrant-row").count();
const issuerAfterReset = await page.getByLabel("發行商篩選").inputValue();

// SC-3 展開列只剩 IV
await page.getByRole("button", { name: /展開明細/ }).first().click();
await page.waitForTimeout(5000);
const brokersDetailCount = await page.getByTestId("warrant-brokers-detail").count();
const ivChartCount = await page.getByTestId("warrant-iv-chart").count();
await page.screenshot({ path: evidence + "/SC-3_expanded-iv-only.png" });

// W2 權證分點流向頁不受影響(cache 已由 curl 暖過)
await page.getByRole("button", { name: /^權證分點$/ }).click();
await page.getByTestId("flow-date-badge").waitFor({ timeout: 180000 });
await page.screenshot({ path: evidence + "/W2_flow-page-intact.png" });

const brokersReqs = apiReqs.filter((u) => u.includes("/brokers"));
console.log(
  JSON.stringify(
    {
      alignLeft,
      alignRight,
      issuerOpts,
      rowsBefore,
      rowsFiltered,
      rowsReset,
      issuerAfterReset,
      brokersDetailCount,
      ivChartCount,
      brokersReqs,
      consoleBad,
    },
    null,
    2,
  ),
);
await browser.close();
