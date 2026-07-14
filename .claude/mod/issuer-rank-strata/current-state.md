# current-state — mod/issuer-rank-strata(2026-07-14)

Phase 1 現況盤點。目標:發行商排行 v2 — per-warrant 指標改在(moneyness band × 天期 band)
分層內比較後再聚合,修正 v1「組合結構 × 造市品質」混合訊號(元大 positive control 未過)。

## 1. v1 現況(backend/services/warrant_issuers.py)

### 演算法(compute_issuer_rank,L390-506,純函式零 IO)

```
window = archives[-10:](TWO_WEEK_FILES)
seen_wids = window 內出現過的全部 wid
per wid:
  resolve_issuer(三層:官方對映+標的 guard → 名稱解析 → None)→ 無解析不計
  排除:近到期(ltd - as_of ≤ 21 日曆日)/ 兩週窗有效 ivb 點 < 8
  _warrant_metrics → (ivb std, spread 日值中位數)  # spread 日值 R5 三防護
per issuer:
  iv_std_median / spread_median(scored 檔中位數)
  declining_share = declining / labeled(label≠insufficient;insufficient 不入分母)
全市場正規化(v2 要改的核心):
  eligible = n_scored ≥ 5 且三指標齊 → min-max bounds 只在 eligible 上取
  composite = 3/7·norm(iv_std) + 2/7·norm(spread) + 2/7·norm(declining)(低者佳)
  rank / tier(ceil 三分位 front/mid/back)只發給 eligible;其餘 null
輸出 {_cache_version, as_of_date, built_from_days, issuers:[...]}
```

### v2 所需輸入已全部在函式簽名內(不需改 signature、不需新資料源)

- `archives` 日檔 shape:`{date, terms_approx, warrants: {wid: {b, a, c, s, ivb, iva}}}`
  — `s` = 該日標的收盤(daily archive 與 backfill 兩條線都寫入)
- `terms_by_wid`(來自 warrants.get_snapshot flatten):`strike / exercise_ratio / kind /
  last_trading_date / underlying_id / name / is_reset` 齊備
- moneyness 公式(對齊 warrant_quotes.py:187):
  `(s - strike)/strike` if call else `(strike - s)/strike`(正 = 價內)
- 剩餘天期:`last_trading_date - as_of_date`(v1 近到期排除已在用同式)

## 2. Caller map(全部 literal 引用,無動態用法;grep 21 檔確認)

### compute_issuer_rank 直接 caller
| Caller | 位置 | v2 影響 |
|---|---|---|
| `get_issuer_rank()` | warrant_issuers.py:546 | 唯一生產 caller;RANK_FILE cache 檔 `_CACHE_VERSION=2` 需 bump |
| pure-function 測試 ×~18 | tests/test_warrant_issuers.py:271-676 | 大量該紅/該調:小 fixture(1-6 檔)分層後落 <MIN_SAMPLE 層 |

### rank payload 消費端(欄位契約)
| 消費者 | 讀的欄位 | v2 影響 |
|---|---|---|
| `routes/warrants.py:51` rank endpoint | 整包 passthrough | 不動(payload 直出) |
| `get_issuer_tier_cached()`(warrant_issuers.py:558)→ warrants.py:518 selector 列 merge | `issuers[].issuer_id/.tier` | 欄位名不變即不動(白名單:15s 輪詢熱路徑) |
| frontend `lib/api.ts` → `useIssuerRank` → `IssuerRankPanel` | as_of_date / built_from_days / issuers 全欄位(IssuerRankRow 型別) | 既有欄位不減;標注文字改(Panel L47-49) |
| e2e E17(equity.spec.ts:198)| 「基準日 2026-06-26」「元大」「1.8%」「收盤報價推算」「0/1」 | **該變**:FAKE fixture 3 檔分層後全層樣本不足 → 數字斷言與顯示會變 |
| tests_e2e/test_api_warrants.py:189-216 | rank contract(3 發行商、030011 不計分、rank/tier null)| **該變**(同上) |
| IssuerRankPanel.test.tsx / useIssuerRank.test.ts / WarrantSelector.test.tsx | UI 行為 + 「收盤報價推算」文字 | 標注改寫處同步;「收盤報價推算」字樣保留則 E17/RTL 該斷言不紅 |

### 對照層(map)consumer — 本次全部不動(白名單)
`get_issuer_map` / `get_issuer_map_cached` / `get_issuer_lexicon_cached` / `resolve_issuer`
/ MAP_FILE cache / cooldown / stale-serve / `_spawn_map_bg`;merge 端 warrants.py:508-531。

## 3. 現況 vs 目標對照

| 面向 | 現況(v1) | 目標(v2) |
|---|---|---|
| 正規化母體 | 全市場 eligible 發行商的三指標中位數 min-max | (moneyness band × 天期 band)層內比較後聚合 |
| 排行語義 | 組合結構 × 造市品質混合(元大被深價外 penny 墊高 → back) | 純造市品質(同品質不同組合 → 相近排名) |
| compute signature | 4 參數 | 不變(輸入已齊) |
| payload | 三指標 + composite + rank + tier | 既有欄位不減;可能 + strata 摘要 |
| RANK_FILE 版本 | `_CACHE_VERSION=2` | bump(payload 語義/欄位變) |
| UI 標注 | 「未按價內外/天期分層…跨規模比較請保留」 | 拿掉/改寫 + 分層口徑一句 |
| e2e / api e2e | E17 資料級斷言(3 檔 fixture) | 該變:fixture 擴充或斷言改寫(spec 標記) |

## 4. Backward compat 面

- API:欄位只增不減(selector 的 issuer_name/issuer_tier 契約、rank 既有欄位)。
- Cache:RANK_FILE bump 即失效重建,無 migration;MAP_FILE 不動(版本共用 `_CACHE_VERSION`
  常數 — **注意**:map 與 rank 共用同一個 `_CACHE_VERSION=2`,bump 會連 MAP_FILE 一起作廢
  (7 天 cache 重抓一次,zero-配額源,可接受;或拆成兩個版本常數 — Phase 2 決策)。
- 回滾 = revert commits;新 cache 檔孤立無害。

## 5. Baseline(2026-07-14,branch 開出前 pre-push 實跑)

- backend:`python -m pytest -q` → **752 passed, 1 skipped**;`ruff check .` 全過
- frontend:`npm test` → **788 passed(83 檔)**;`npm run build` 過
- e2e:未跑 baseline(E17 屬「該變」,Phase 4 同步調整後跑)

## 6. 已知坑(從任務書 + 上輪 change-spec §6.2 帶入)

- e2e FAKE fixture 僅 3 檔權證 → 分層後全層樣本不足;E17 + tests_e2e rank 斷言屬「該變」
- 權證代號跨年回收:任何按 wid join 的新邏輯必走 resolve_issuer(v1 已做,v2 沿用同一路徑)
- uvicorn 預設無 INFO log:覆蓋率/分層統計驗證走離線腳本直呼函式
- 元大 positive control 判準:研究依據 = 元大隱波不降承諾 → 合理預期前段;仍後段時
  必須能從層內數字解釋,不許調權重湊答案
