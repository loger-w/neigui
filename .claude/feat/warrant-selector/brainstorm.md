# Brainstorm — 權證選擇器(盤中版)equity mode 新 tab「權證」

- **Date**: 2026-07-11
- **來源**: `docs/specs/warrant-selector/spec.md`(2026-07-11 盤中版,user 拍板)→ /auto HARD-GATE 替代條件成立(規格來自 user 拍板文件),本檔為 spec 的 SC gate 化 + Phase 0 spike 定案補充,不重開已拍板決策。
- **Scope**: **L**(跨前後端、新資料流 MIS、預估 >15 檔)
- **cycle-count**: [see state.json]
- `[auto-default: goal_efficiency_mode=true | reason: L 級 >15 檔 + /auto 同啟,逐檔三 commit 會爆 commit 數;wave batch commit + body 列 SC-N]`

## 已拍板(不重問)

盤中為主場景、收盤後 MIS 最後快照續用;EOD 快照基底 + MIS 盤中層;估價 = 昨日 IV 評價法(主)+ 同標的 IV 百分位(輔),HV 溢價率不做;差槓比預設排序鍵;分點展開 on-demand 單發;認購/認售 badge 不用紅綠;嚴禁方向性文案。

## Phase 0 spike 定案(2026-07-11 實測)

| # | 結論 |
|---|---|
| S-1 | MI_INDEX `type=0999` = 認購(不含牛證,07-09 實測 26,843 rows)、**`type=0999P` = 認售(不含熊證,2,310 rows)**。目標表 = tables[] 中 **fields 數 = 20** 那張(勿硬編 index;牛熊證表結構不同且 out of scope)。**非交易日 = `stat:"OK"` 但全表空**(07-10 颱風假實測)→ 需向前回退找最近交易日。Response bytes 為正確 UTF-8(mojibake 只是 console 假象)。 |
| S-2 | **行使比例 = t187ap37_L「最新標的履約配發數量(每仟單位權證)」/ 1000**,鐵證:同 row 備註明寫「調整後行使比例0.0070」對上欄值 `7.00`。TPEx `tpex_warrant_issue` 的 ER key **今日實測無 leading space**(`'Latest ExerciseRatio'`,spec 曾記 `' Latest ExerciseRatio'`)→ normalize 用 **stripped-key lookup 容錯**。兩源 ratio 分布一致(0.001–1.0)。 |
| S-3 | 環境實為 py3.13.13;`daytrade_fee.py::_ssl_context()`(關 VERIFY_X509_STRICT)全部 probe 通過,照抄。 |
| S-4 | t187ap37_L 36,278 rows **含已到期**(最後交易日 min=2026-05-28)與上限/下限型(牛熊)少量 rows → universe = **MI_INDEX(0999+0999P)代號 ∩ 條款表**,自然排除牛熊與已到期;另加最後交易日 ≥ as_of 防禦。日期為**緊湊民國**(`1150710`,非斜線)→ `_roc_compact_to_iso`。 |
| S-5 | 每日各一發,UA 帶著即可(twse-tpex-conventions:非 FinMind 零配額、低頻無限流壓力)。 |
| S-6 | MIS 批次:**140 OK / 145「參數不足」/ 300 HTTP 414** → `MIS_BATCH_SIZE = 100`(留 headroom)。20 連發 batch-100 全 200 無限流(週六量測,盤中行為為殘餘風險)。**otc_ 權證覆蓋 40/40 全通**,五檔 a/b/f/g 欄齊。最重標的 2330 = 921 檔 = 10 批 ≈ 1–4s。**常數:backend cooldown = 10s、前端 refetchInterval = 15s**。 |
| S-7 | 並發 dedup 走 `daytrade_fee.py::_run_once` 同構(local 複製),pytest 鎖並發行為(見 SC-8 測試)。 |
| 補 | 市場乾淨分割:TPEx 權證標的全為上櫃股(325 檔,2330/2317/2454 = 0)、TWSE 權證標的無上櫃股 → per-underlying index 兩市場 union 即可,單一標的實務上只落一邊。TPEx quotes join key:`tpex_warrant_daily_quts.Code` ↔ `tpex_mainboard_daily_close_quotes.SecuritiesCompanyCode`,`LatesAskPrice` typo 原樣。 |

## SC(成功條件 + 驗證方式)

- **SC-1** equity mode 出現「權證」tab(overview/bubble 之後第三個),沿用當前標的,切標的即重抓。
  驗證:e2e `e2e/specs/equity.spec.ts` 新 E#(fake fixture 下切 tab + 切標的斷言表格內容變);DevTools 截圖 `docs/specs/warrant-selector/screenshots/`。
- **SC-2** 表格列出該標的全部權證(上市+上櫃 union),欄位:代號、名稱、類型、市場、履約價、價內外 %、剩餘天數、行使比例、現價(z/mid)、最佳買賣價量、IV、理論價、估價差 %、IV 百分位、實質槓桿、價差比、差槓比;預設差槓比升序。
  驗證:backend pytest 欄位計算數值鎖(fixture 取 probe 真實 payload 縮樣);RTL 斷言欄 header 與預設排序;BS/IV 教科書案例 pytest 鎖數值(`test_bs.py`,例:S=100,K=100,T=1,r=1.6%,σ=20% 的 call/put 理論價 6 位小數)。
- **SC-3** 盤中自動更新:交易時段 TanStack `refetchInterval`(15s 常數,對齊 backend cooldown 10s),收盤後停輪詢 + 顯示「最後更新 HH:MM」;盤後開頁直接顯示最後快照。
  驗證:vitest hook 測試(交易時段內 refetchInterval=15000、時段外 false);backend cooldown pytest(10s 內重複請求回同 cache、`_run_once` 並發 dedup);量法 = 測試斷言常數與行為,不靠人工計時。
- **SC-4** 篩選器:認購/認售 toggle、剩餘天數下限、價內外範圍、委買量>0 開關、估價差範圍、IV 百分位上限;全 client-side。
  驗證:`lib/warrant-utils.ts` 純函式 vitest(每個 filter 一測)+ RTL 整合一測。
- **SC-5** 估價標籤(偏貴/合理/偏便宜)與差槓比標色用中性色階,不用紅綠;無任何方向性文案。
  驗證:RTL `expect(screen.queryByText(/做多|做空|賣出|買進|建議|滿倉/)).toBeNull()` + data-testid 正向 assertion 鎖 badge variant(非 bull/bear token)。
- **SC-6** 點 row 展開 FinMind 分點買賣超(T+1 單發,不 fan-out),顯示「資料日 = T-1」標註。
  驗證:backend pytest(`data_id` 必填、`end_date` 留空、cache per warrant_id+date);RTL lazy 展開測試;e2e fake fixture 展開斷言。
- **SC-7** 標的無權證 → 「此標的無掛牌權證」繁中空狀態。
  驗證:RTL 空狀態測試 + e2e(fake fixture 用無權證標的)。
- **SC-8** `refresh=true` 慣例沿用;EOD 快照 cache 固定檔名 `latest` + `_cache_version`;上游回空不覆寫非空 cache。`[amendment 2026-07-11: design-review R1 — no_trading_day flag 不適用本功能(MI_INDEX 收盤後發布,交易日盤中 build 必回退昨日,回退是常態),基準日語意由 as_of_date 承載,前端顯示「快照基準日」;快照 payload 不發 no_trading_day key,pytest 鎖此行為]`
  驗證:backend pytest(refresh 跳 cache、cache version bump 失效、空回不覆寫 — 照 daytrade_fee 兩道保護測試樣板;盤中回退時 payload 無 no_trading_day key)。
- **SC-9** 完成 gate:`pytest -q` + `ruff check .` + `npm test`(vitest)+ `npm run build` + e2e `npm test` 全綠 + DevTools 截圖入 `docs/specs/warrant-selector/screenshots/`。
  驗證:各指令 exit 0 + 測試數字記錄於 automated-verification.md;截圖檔案存在。

## Edge cases(≥3)

1. **非交易日 EOD**(MI_INDEX stat OK 全空)→ 向前回退找最近交易日,`as_of_date` 承載基準日 `[amendment 2026-07-11: R1/R2-2 — 不發 no_trading_day flag,盤中回退是常態]`。
2. **零成交權證**:TWSE 價格欄空字串 / TPEx Close `"---"` / MIS `z="-"` → P 用 mid=(bid+ask)/2;bid/ask 皆無 → 計算欄位全 null 但**不擋列出**。
3. **重設型(Reset=Y / 類別含重設型)**:列出但 IV/greeks/估價 null + 備註 icon。
4. **IV 反解不收斂**(價格低於內在價值、deep ITM/OTM)→ null,不炸表。
5. **MIS 髒點**:價量字串尾綴 `_`、`z="-"`、五檔 `-` → normalize 各一測。
6. **TPEx ER key 有無 leading space 皆可解**(stripped-key lookup)。
7. **已到期權證殘留條款表** → universe 交集 + 最後交易日過濾雙防。
8. **權證掛牌但條款表尚無**(新掛牌 race)→ 該檔 skip + logger.warning,不炸整表。
9. **同組 IV 百分位樣本 < 5 檔** → 百分位 null。

## e2e 歸屬定案(e2e-conventions 判準表)

- equity mode UI 新 tab → **`e2e/specs/equity.spec.ts` 新 E# specs**(tab 切換、表格資料級 assertion、篩選、空狀態)。
- 新 backend routes(`/api/warrants/*`)→ `backend/tests_e2e/test_api_warrants.py` contract test。
- TWSE/TPEx/MIS 直抓 = 非 FinMind → service 內 `FAKE_FINMIND=="1"` 分支讀 `tests_e2e/fixtures/warrants/` **子目錄**(原始 upstream shape 縮樣,normalize 路徑 e2e 實跑);分點展開 = FinMind dataset `TaiwanStockWarrantTradingDailyReport` → flat fixture + **MANIFEST 條目與 fetch method 同 commit**。
- fixture 日期對齊 FAKE_TODAY;寫死日期前驗星期。
- `@live` 不需要(非 FinMind 主資料流;分點為既有 FinMind client 慣例)。

## Out of scope(v1)

牛熊證/展延型;全市場掃描(未鎖標的);IV 歷史曲線/回測;歷史日期快照回放;即時 IV 曲面重建(盤中估價固定用昨日 IV);MIS 之外的即時源(provider 抽象保留)。

## 殘餘風險(Known Risks 候選)

- MIS 限流曲線量測於週六(盤外);盤中真實負載下可能有未觀測的限流 → cooldown 10s + 批次序列送出保守設計,常數具名可調。
- MIS 非官方無文件,schema 可能無預警變動 → quote provider 抽象 + normalize 髒點測試護欄。
- 估價差「偏貴/合理/偏便宜」門檻常數實作期以真實分布校準(`[auto-default: ±10% 初值 | reason: spec 授權實作期校準,具名常數可調]`)。
