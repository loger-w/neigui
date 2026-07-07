# Probe evidence — futures datasets(2026-07-07)

一次性 probe(scratchpad script,Bearer header),對 2026-07-03(Fri)各打 1 日:

## TaiwanFuturesDaily / MTX — HTTP 200,28 rows
keys: `close, contract_date, date, futures_id, max, min, open, open_interest, settlement_price, spread, spread_per, trading_session, volume`

關鍵事實:
- `after_market` session rows 的 `open_interest` **全為 0** → total_oi 必須只取 `trading_session == "position"`。
- `contract_date` 含**週合約**(`202607W2`)與月合約(`202607`…)→ MTX 有週小台。

## TaiwanFuturesInstitutionalInvestors / MTX、TX — HTTP 200,各 3 rows
keys: `date, futures_id, institutional_investors, long_deal_amount, long_deal_volume, long_open_interest_balance_amount, long_open_interest_balance_volume, short_deal_amount, short_deal_volume, short_open_interest_balance_amount, short_open_interest_balance_volume`

關鍵事實:
- 法人名稱欄 = `institutional_investors`,值 = `外資 / 自營商 / 投信`(與 options institutional 同 schema)。
- OI 欄 = `long_open_interest_balance_volume` / `short_open_interest_balance_volume`。
- **商品層級**資料(per futures_id,無 contract_date 欄)→ 涵蓋該商品全部到期月(含週合約)。
- 樣本值(TX 外資):long 6,178 / short 87,230 → 淨空 81,052 口(量級 sanity 合理)。

## 對 PLAN 的修正結論
1. `parse_retail_mtx` 的 total_oi:`trading_session == "position"` 且 `contract_date` 匹配 `^\d{6}(W\d)?$`(**含週合約**、排除價差如 `202607/202608`)— 法人資料是商品層級,分母漏週合約會讓 retail 高估或為負。
2. 加 sanity guard:`retail_long < 0 OR retail_short < 0` → 該日 drop + warning `retail_mtx_negative_retail`(聚合口徑不符的偵測線)。
3. KR-2(欄位未驗證)→ **resolved**;W0 的 committed probe script 照此重現。
