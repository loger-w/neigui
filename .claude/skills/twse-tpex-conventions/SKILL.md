---
name: twse-tpex-conventions
description: TWSE/TPEx/MIS 官方端點直抓慣例(非 FinMind、零配額)。接 TWSE RWD / OpenAPI、TPEx OpenAPI、MIS 盤中報價端點,處理民國日期、月批次/最新快照 cache、TPEx TLS、寫直抓 service 的 FAKE 層時先讀。樣板 = services/daytrade_fee.py(月批次)+ services/warrants.py(最新快照,2026-07-11 /feat warrant-selector 沉澱)。
---

# TWSE / TPEx / MIS 直抓慣例

樣板檔:`backend/services/daytrade_fee.py`(月批次 cache)/ `backend/services/warrants.py`(最新快照 cache + 多源 join)/ `backend/services/warrant_quotes.py`(MIS 盤中層)/ `backend/services/warrant_iv_history.py`(歷史回溯 backfill + per-day immutable archive,2026-07-11 warrant-iv-drift 沉澱)。

## 端點層級(別搞混)

- **TWSE OpenAPI**(`openapi.twse.com.tw/v1/...`):有 swagger(`/v1/swagger.json`,143 paths)、無參數、只回最新。
- **TWSE RWD**(`www.twse.com.tw/rwd/zh/...`):官網內部 JSON API,**無 swagger**、可帶 date 參數可回溯;`stat != "OK"` = 無資料(不是錯誤,回空即可)。月批次端點(BFIF8U)date 給任一天回整月。
  - **MI_INDEX 特例**(2026-07-11 warrant-selector 實測):非交易日/盤中未發布是 **`stat:"OK"` 但全表空**(不是 stat != OK)→ 需向前回退找最近交易日;tables[] 取目標表**用 fields 數比對**(權證 = 20 欄),勿硬編 index(牛熊證表 index 不同、欄構不同)。權證 type:`0999` 認購(不含牛證)/ `0999P` 認售(不含熊證)/ 牛熊展延 = 0999C/B/X/Y 另表。
  - **RWD response bytes 是正確 UTF-8**:Windows console 印出 mojibake 是 stdout cp950 假象,不是資料編碼問題(probe 時 `PYTHONIOENCODING=utf-8` 免誤判)。
  - MI_INDEX **歷史** payload 的 row[19](標的收盤價/指數)2026-03-10 實測 29,540/29,540 全有值 — 歷史標的價可直接由權證表取得,不需另抓(warrant-iv-drift R-3 解除)。
- **TPEx OpenAPI**(`www.tpex.org.tw/openapi/v1/...`):有 swagger(`/openapi/swagger.json`,225 paths);**一律只回當月/最新,無歷史參數** — 歷史資料 cache 即唯一副本(見 cache 節)。
  - **但 TPEx 舊站 php 有歷史**(2026-07-11 warrant-iv-drift 實測翻新「TPEx 歷史不可得」認知):`.../web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=<民國Y/MM/DD>&se=EW` 回溯 ≥3 年(權證行情 17 欄含最後買/賣價)。shape = `{date: 西元緊湊 echo, stat: 小寫 "ok", tables: [{fields, data}]}`;**欄序由 fields stripped 名稱對照解,勿硬編 index**(舊年份量欄名「張數→千股」變體);**取表前必四欄名齊備 guard** — 缺欄 `fields.index()` 的 ValueError 非 httpx 例外,會穿透只 catch httpx 的逐日迴圈炸整段(code-review CR-A1 實證);echo date 不符指定日視為空;`se=EW` 混含 ETF → 以條款 universe 交集過濾。樣板 `warrant_iv_history.py::parse_wn1430`。
- **TWSE MIS**(`mis.twse.com.tw/stock/api/getStockInfo.jsp`,盤中五檔):非官方無文件。`ex_ch=tse_XXXX.tw|otc_XXXX.tw`(上市/上櫃前綴),**批次上限 ~140 檔(URL 長度,實測 145 回「參數不足」、300 回 414)→ 常數取 100**;20 連發 batch-100 零限流(週六量測);收盤後回最後盤中快照(盤後場景零分支);`otc_` 權證覆蓋完整。髒點:`z="-"` 無成交、五檔 `a`/`b`(價)`f`/`g`(量)`_` 分隔帶尾綴、`-` 佔位;`d`+`t` 給日期時間、`tlong` ms epoch 只當排序鍵。
- 皆非 FinMind:不占 6000 req/hr 配額;低頻無限流壓力,UA header 帶著即可、不需 backoff。

## TLS(2026-07-11 實測定案)

- **TPEx 憑證缺 Subject Key Identifier,py3.13 預設 `VERIFY_X509_STRICT` 直接拒驗**(`Missing Subject Key Identifier`)。
- 解法 = `_ssl_context()` 樣板:`ssl.create_default_context()` 後 `ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT` — 憑證鏈 + hostname 驗證完整保留,**禁止 `verify=False`**;truststore 不需要(零依賴方案實測 200)。

## 資料髒點(normalize 必測清單)

- 民國日期**兩格式**:TWSE RWD `"115/07/01"`(斜線)/ TWSE OpenAPI(t187ap37_L)與 TPEx `"1150701"`(緊湊,前段年可 3 位)→ `_roc_slash_to_iso` / `_roc_compact_to_iso` 樣板。**同 payload 可混西元緊湊**(TPEx warrant issue 的 `ExpiryDate="20260818"` vs `Date="1150626"`)。
- TWSE:代號/名稱右 padding 空白、千分位 `"25,000"`、費率帶 `%`、零成交價格欄空字串;TPEx:費率無 `%` 同單位、`Close="---"` 零成交、`CapPrice="    "` 空白 = 無、官方欄名 typo(`LatesAskPrice`)原樣用。
- **TPEx 欄名 leading space 有無不定**(2026-07-11 翻新:`" Latest ExerciseRatio"` spec 記載有、當日實測無)→ 一律 **stripped-key lookup**(`k.strip() == key` 比對),不賭原樣。
- **權證行使比例換算**:t187ap37_L「最新標的履約配發數量(每仟單位權證)」**/ 1000**(鐵證:官方備註「調整後行使比例0.0070」對上欄值 7.00);t187ap37_L **含已到期權證** → universe 用行情代號 ∩ 條款代號 + 最後交易日過濾。
- 壞 row skip + `logger.warning`,單筆髒不炸整表。

## Cache 語意(utils.cache + `_cache_version`,兩種 pattern)

- **月批次**(daytrade_fee):key = 市場 + 月;**當月跨日 stale、過去月不朽**。
- **最新快照**(warrants):**固定檔名 `*_latest.json`**(讀取端不需先知道 as_of 是哪天 — as_of 是 fetch 後才知道的值,日期入檔名會卡讀取端)+ module-level mem 層(大 payload 不每 request 重讀檔)+ **build backoff**(`_last_build_attempt` + 60s 窗;失敗/空回不得被前端輪詢放大成重試風暴;refresh 豁免)。
- payload 帶 `fetched_on`(`clock.today()`,不是 wall-clock);refresh 跳 cache 但兩道例外保護(TPEx 資料不可重抓,cache 是唯一副本):
  1. TPEx 過去月 → **無視 refresh 一律回 cache**(月批次限定);
  2. 通用:上游回空且既有 cache 非空 → **不覆寫**。
  皆有 pytest 鎖(`test_tpex_past_month_refresh_serves_cache` / `test_empty_raw_does_not_overwrite_nonempty_cache` / `test_build_backoff_within_window`),新直抓 service 照抄。
- inflight dedup 沿 `finmind.py::_run_once` 同構(shield + refcount)**local 複製**(跨模組共用私有函式禁止 — 小 helper 一律 local 複製,2026-07-11 code-review 定案),route 層配 `run_with_disconnect`(cancel-chain)。
- 多 service 疊層時(快照 + 盤中層)build 入口共用**單一 `_run_once` key**,兩 endpoint 首開併發合流單次 build。

## FAKE 層(e2e;細節見 skill `e2e-conventions`)

- 非 FinMind 資料源 FAKE_FINMIND 三層架構管不到 → service 內 `FAKE_FINMIND=="1"` 分支讀 `tests_e2e/fixtures/<service>/` **子目錄**(MANIFEST gate 只掃 flat `*.json`,子目錄天然隔離);fixture 存**原始 upstream shape** 縮樣讓 normalize 路徑被 e2e 實跑;檔缺 → 視同空月/空表不炸;日期參數化的 fetch(MI_INDEX)FAKE 分支**無視 date**(fixture 對齊 FAKE_TODAY,回退迴圈 i=0 即命中)。
