---
name: twse-tpex-conventions
description: TWSE/TPEx 官方端點直抓慣例(非 FinMind、零配額)。接 TWSE RWD / OpenAPI 或 TPEx OpenAPI 端點、處理民國日期、月批次 cache、TPEx TLS/無歷史限制、寫直抓 service 的 FAKE 層時先讀。樣板 = services/daytrade_fee.py(2026-07-11 /feat daytrade-borrow-fee 沉澱)。
---

# TWSE / TPEx 直抓慣例

樣板檔:`backend/services/daytrade_fee.py`(券差)。權證選擇器(`docs/specs/warrant-selector/spec.md`)同路線,實作時沿用本檔全部條目。

## 端點層級(兩種 TWSE,別搞混)

- **TWSE OpenAPI**(`openapi.twse.com.tw/v1/...`):有 swagger(`/v1/swagger.json`,143 paths)、無參數、只回最新。
- **TWSE RWD**(`www.twse.com.tw/rwd/zh/...`):官網內部 JSON API,**無 swagger**、可帶 date 參數可回溯;`stat != "OK"` = 無資料(不是錯誤,回空即可)。月批次端點(BFIF8U)date 給任一天回整月。
- **TPEx OpenAPI**(`www.tpex.org.tw/openapi/v1/...`):有 swagger(`/openapi/swagger.json`,225 paths);**一律只回當月/最新,無歷史參數** — 歷史資料 cache 即唯一副本(見 cache 節)。
- 皆非 FinMind:不占 6000 req/hr 配額;低頻(每日一發/市場)無限流壓力,UA header 帶著即可、不需 backoff。

## TLS(2026-07-11 實測定案)

- **TPEx 憑證缺 Subject Key Identifier,py3.13 預設 `VERIFY_X509_STRICT` 直接拒驗**(`Missing Subject Key Identifier`)。
- 解法 = `_ssl_context()` 樣板:`ssl.create_default_context()` 後 `ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT` — 憑證鏈 + hostname 驗證完整保留,**禁止 `verify=False`**;truststore 不需要(零依賴方案實測 200)。

## 資料髒點(normalize 必測清單)

- 民國日期**兩格式**:TWSE `"115/07/01"`(斜線)/ TPEx `"1150701"`(緊湊,前段年可 3 位)→ `_roc_slash_to_iso` / `_roc_compact_to_iso` 樣板。
- TWSE:代號/名稱右 padding 空白、千分位 `"25,000"`、費率帶 `%`;TPEx:**欄名帶 leading space**(`" LendingVolume"`、warrant issue 的 `" Latest ExerciseRatio"`)原樣對 key、費率無 `%` 同單位、官方欄名 typo(`LatesAskPrice`)原樣用。
- 壞 row skip + `logger.warning`,單筆髒不炸整表。

## 月批次 cache 語意(utils.cache + `_cache_version`)

- key = 市場 + 月;payload 帶 `fetched_on`(`clock.today()`,不是 wall-clock)。
- **當月跨日 stale、過去月不朽**;refresh 跳 cache 但有兩道例外保護(TPEx 資料不可重抓,cache 是唯一副本):
  1. TPEx 過去月 → **無視 refresh 一律回 cache**;
  2. 通用:上游回空且既有 cache 非空 → **不覆寫**。
  兩道都有 pytest 鎖(`test_tpex_past_month_refresh_serves_cache` / `test_empty_raw_does_not_overwrite_nonempty_cache`),新直抓 service 照抄。
- inflight dedup 沿 `finmind.py::_run_once` 同構(shield + refcount)local 複製,route 層配 `run_with_disconnect`(cancel-chain)。

## FAKE 層(e2e;細節見 skill `e2e-conventions`)

- 非 FinMind 資料源 FAKE_FINMIND 三層架構管不到 → service 內 `FAKE_FINMIND=="1"` 分支讀 `tests_e2e/fixtures/<service>/` **子目錄**(MANIFEST gate 只掃 flat `*.json`,子目錄天然隔離);fixture 存**原始 upstream shape** 縮樣讓 normalize 路徑被 e2e 實跑;檔缺 → 視同空月不炸。
