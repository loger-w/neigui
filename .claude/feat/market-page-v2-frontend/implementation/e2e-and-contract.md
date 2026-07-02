# implementation: e2e + backend contract(SC-11)

對應:SC-11。design v3 §13。判準表:market mode UI → market.spec.ts M#;backend route shape → tests_e2e + live-contract L#;視覺 → visual V# baseline。

## 1. backend/tests_e2e/test_api_market.py 追加(🟢;不動既有 3 test)

```python
async def test_market_snapshot_v2_keys(client):
    """痛點:P5 前端 4 個新 panel 依賴 4 個 EOD 欄位 + universe meta;後端 drop
    任一 key 前端 panel 全滅。FAKE fixture 無全市場 window → 值允許 null,
    只鎖存在性(值 shape 由 frontend market-types.test.ts contract lock)。"""
    r = await client.get("/api/market/snapshot")
    assert r.status_code == 200
    body = r.json()
    for k in ("universe_size", "excluded_count", "breadth",
              "sector_breadth", "sector_volume_ratio", "sector_amount_share"):
        assert k in body, f"market snapshot missing v2 key {k}: {list(body.keys())}"
```

## 2. e2e/helpers/selectors.ts 追加

(同 commit 更新檔頭 FOOTER ENFORCEMENT 註解的 root testid 計數「10」→ 新總數,I3-4。)

```ts
  // market v2 panels(feat/market-page-v2-frontend)
  marketUniverseBanner: "market-universe-banner",
  marketBreadthPanel: "market-breadth-panel",
  marketSectorBreadthHeatmap: "market-sector-breadth-heatmap",
  marketSectorAmountShare: "market-sector-amount-share",
  marketSectorVolRatio: "market-sector-vol-ratio",
  marketClassicToggle: "market-classic-toggle",
```

## 3. e2e/specs/market.spec.ts 追加 M4-M6(既有 M1-M3 不動)

```ts
test("M4: v2 panels 空狀態渲染不 crash(SC-11b)", async ({ page }) => {
  // 痛點:FAKE_FINMIND 缺全市場 TaiwanStockPrice window + TAIEX fixture,
  // 四個 EOD 欄位必 null → panel 走「資料暫缺」降級。此 spec 鎖「null 不炸頁」
  // (契約事實 2:頁級 error 不得 key 在四欄)。populated fixture 列 next-time(D-3)。
  await expect(page.getByTestId(TESTIDS.marketBreadthPanel)).toBeVisible();
  await expect(page.getByTestId(TESTIDS.marketSectorBreadthHeatmap)).toBeVisible();
  await expect(page.getByTestId(TESTIDS.marketSectorAmountShare)).toBeVisible();
  await expect(page.getByTestId(TESTIDS.marketSectorVolRatio)).toBeVisible();
  await expect(page.getByTestId(TESTIDS.marketUniverseBanner)).toBeVisible();
});

test("M5: 經典檢視預設展開,舊 heatmap/leaderboard 可見(D-2,M1 顯性防回歸)", async ({ page }) => {
  // 痛點:layout 重組把舊 panel 收進折疊區,若預設收合 M1 靜默失效。
  await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
  await expect(page.getByTestId(TESTIDS.marketLeaderboard)).toBeVisible();
});

test("M6: 折疊 toggle → 舊 panel hidden → 再點恢復(SC-9 hidden 慣例)", async ({ page }) => {
  // 痛點:hidden attribute 慣例(保留 mount)— 若誤用條件 render,重展開會
  // 重新 mount 重抓資料。assert hidden 而非 detached。
  await page.getByTestId(TESTIDS.marketClassicToggle).click();
  await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeHidden();
  await page.getByTestId(TESTIDS.marketClassicToggle).click();
  await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
});
```

(beforeEach 沿用既有 describe 的 installFixtureClock + mode=market。)

注意:M4 依賴「FAKE fixture 下 `/api/market/snapshot` 200 且四欄 null」— 若 backend 在 FAKE 下對 v2 欄位 raise → 契約 bug,停下回報(不動 backend)。

## 4. e2e/specs/live-contract.spec.ts L3 追加 assert(@live)

```ts
    // v2 四欄存在性(值可 null — EOD 降級獨立);known_gaps shape
    expect(body).toHaveProperty("breadth");
    expect(body).toHaveProperty("sector_breadth");
    expect(body).toHaveProperty("sector_volume_ratio");
    expect(body).toHaveProperty("sector_amount_share");
    expect(body).toHaveProperty("universe_size");
    if (body.breadth != null) {
      expect(Array.isArray(body.breadth.known_gaps)).toBe(true);
      expect(Array.isArray(body.breadth.mcclellan_series)).toBe(true);
    }
```

## 5. visual.spec.ts V3 baseline

V3 spec 本體不動(仍截 market mode top-of-page);layout 大改 → baseline PNG 必變。Phase 5 跑 `cd e2e && npm run test:update-snapshots` 重生,diff 進 commit。

## 失敗測試清單對應

- backend v2 keys test:對 main(未動)本來就綠(P1-P4 已 ship)→ **此 test 無紅相位,屬 characterization**(backend 不在本輪改動範圍,合法)
- M4-M6:MarketPage 改動前全紅(testid 不存在)→ 實作後綠(標準紅綠)
- L3 追加:@live 本機驗,CI 不跑
