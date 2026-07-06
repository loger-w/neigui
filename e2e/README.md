# neigui E2E

Playwright + fixture-mode FinMind, fully isolated npm root(不污染 `frontend/` deps tree)。

## 先決條件
- Python 3.12 venv(backend lifespan / pytest 跑)
- Node 22+
- Chromium browser(`npx playwright install chromium`)

## 跑法

### 平時(fake-mode,離線)
```bash
cd e2e && npm install
npx playwright install chromium
npm test
```
backend 用 `FAKE_FINMIND=1 FAKE_TODAY=2026-06-26 CHIP_DATA_DIR=./e2e/.cache` 啟,
讀 `backend/tests_e2e/fixtures/*.json`,完全不打 FinMind。

### 真打 FinMind(本機 opt-in,SC-11)
```bash
cd e2e && npm run test:live
# 需 backend/.env 有真實 FINMIND_TOKEN
# 跑 specs/live-contract.spec.ts 內 @live tagged 的 3 tests(hard cap)
```

## Visual baseline bootstrap

Visual regression baseline 只在 **Linux CI** 生成(Win32 dev 字型差異會誤紅)。

### 第一次或更新 baseline
GitHub Actions:trigger `e2e-update-snapshots` workflow_dispatch → auto-PR with new PNGs。

### Win32 本機驗證
```bash
docker run --rm -v $(pwd):/work -w /work mcr.microsoft.com/playwright:v1.49.0-jammy \
  bash -c "cd e2e && npm ci && npx playwright install chromium && npm run test:update-snapshots"
```

## 架構

- `playwright.config.ts`:fake-mode default,Chromium-only,`workers: 1`,`fullyParallel: false`(backend singleton + cache 序列跑較穩)。webServer 自動 spawn backend + frontend。
- `playwright.live.config.ts`:live-mode extend,只跑 `@live` tagged tests。
- `helpers/global-setup.ts`:probe `/api/_meta/mode` 防 reuseExistingServer 撞 dev server 真 backend(F6)+ live-guard hard cap 3 tests。
- `helpers/clock.ts`:`installFixtureClock(page)` 凍 browser 時鐘到 `2026-06-26T13:30:00+08:00`(F8 + R2-P0-3 配對 backend FAKE_TODAY)。
- `helpers/visual.ts`:`skipOnWin32()`(字型差異)+ `VISUAL_THRESHOLD`。
- `helpers/live-guard.ts`:fs.readFileSync + regex 數 `test(` 次數,> 3 throw(R4-P1 / R5-P1 fixed)。
- `helpers/selectors.ts`:TESTIDS + ROLES 集中宣告 + footer enforcement statement(R2-P2-3)。

設計來源:`.claude/feat/e2e-tests/design.md` v6。
