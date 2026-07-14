# Brainstorm — warrant-broker-flow(權證買賣超分點)

**Date**: 2026-07-14
**規格來源**: `docs/specs/warrant-broker-flow/spec.md`(user 拍板 2026-07-11)→ /auto 契約:brainstorm user-approval HARD-GATE 由拍板文件替代,本檔為 spec + Phase 0 spike 的落地整理。
**Scope**: **L**(跨前後端;backend service+route+tests、frontend hook+panel+lib、e2e ≥ 8 檔)
**cycle-count**: [see state.json]

---

## 1. Goal

盤後檢視「該標的最近可得日被買/賣多少權證、哪幾檔、哪些分點、多少金額」:equity mode 新 tab「權證分點」,淨買超/淨賣超各 top 15 分點,點分點展開其進出權證明細,頂部認購/認售 summary。

## 2. Phase 0 spike 結果(2026-07-14 上午實測)

| # | 問題 | 結果 | 對設計的影響 |
|---|---|---|---|
| tier | 07-13 memory 警告帳號降級 Free | **已回復 Sponsor**:`user_info` level=3、limit=6000/hr;權證分點 dataset 正常回資料 | 阻斷解除;配額計算照 6000/hr |
| L-1 | 當日分點資料當晚何時可得 | T-1(07-13)資料 T+1 上午 10:35 已可得;T+0 當日 0 rows(上午測,「當晚」時點無法此刻直測) | 設計改「自適應」:候選日從 **today(T+0)** 起試,fan-out 前先用成交金額最大權證做 1-request 可得性 probe,0 rows → 回退前一日;空日不寫 cache。晚間若上料自動吃到,不依賴未知時點 `[auto-default: 自適應回退 | reason: 消除 L-1 未知依賴,成本 ≤2 requests/冷查詢]` |
| L-2 | cap 150 覆蓋率(2330 級) | 2330 當日有量權證 **477 檔**;金額覆蓋:cap 150 = 91.79%、**cap 200 = 95.69%**、cap 250 = 97.92%;其餘 top-10 標的 cap 200 皆 ≥ 99.5%;全市場有量 >200 檔的標的僅 7 個 | **cap 150 → 200**(spec §7 L-2 校準條款「前 150 檔應涵蓋 >95%,必要時調常數」授權;證據 = 07-13 全市場 dump)`[auto-default: WARRANT_FLOW_CAP=200 | reason: 150 不達 spec 自訂 95% 門檻,200 最壞 95.69%;200 req = 3.3% 時配額]` |
| L-3 | 條款快照缺漏(unmapped) | 全市場有量 13,528 檔中 **118 檔 unmapped(0.87%)**,sample 全為字尾 B/X/T 型(牛熊證/展延型 — warrant-selector 快照 universe 由 MI_INDEX 0999/0999P 交集,結構性排除牛熊證)+ 可能含新掛牌缺口 | unmapped 權證**無法歸屬標的**(缺對映即不知 underlying)→ `unmapped_count` 為**全市場層級**資訊欄(入 payload + log,UI 不顯示、不擋)`[auto-default: unmapped_count=全市場口徑 | reason: per-underlying 歸屬邏輯上不可得]`;牛熊證納入 → out of scope(需擴 warrant-selector universe,跨 feature)寫 next-time |

其他盤點:`services/warrant_brokers.py`(per-warrant 分點 fetch + cache)、`fetch_warrant_trading_daily_report`、條款快照 `warrants.get_snapshot()`、App.tsx `warrants` tab 的 `active` gate pattern、`useWarrantBrokers` hook 全部已在(warrant-selector 遺產),本 feature 是其上的聚合層。

## 3. 成功條件(SC)

- **SC-1** equity mode 新 tab「權證分點」(位於既有「權證」tab 右側 `[auto-default: 排第四、權證家族相鄰 | reason: spec 寫「總覽/泡泡圖右側」時 warrants tab 尚未存在]`);**切到 tab 才發請求**(TanStack `enabled`);首次載入顯示繁中進度文案(含「彙整分點資料中」字樣)。
  驗證:vitest(active gate:未 active 不 fetch、active 才 fetch)+ e2e E#(切 tab 出資料)+ devtools 截圖。
- **SC-2** 頂部 summary:資料日 badge(格式「資料日 MM-DD」)+ 認購買/賣金額、認售買/賣金額四數字。
  驗證:vitest(badge 文字 + 四數字 render)+ 截圖。
- **SC-3** 「買超 15 大 / 賣超 15 大」並排兩欄:分點名 + 金額比例水平 bar + 金額;點分點展開其權證明細(代號/名稱/買賣金額);容器寬 < 斷點時兩欄疊直(`useContainerSize`)。
  驗證:vitest(top15 排序、展開互動、疊直 class)+ e2e E#(展開)+ 截圖(寬窄兩張)。
- **SC-4** 權證明細表:成交金額降序;欄位 = 代號、名稱、類型、成交金額、淨買賣超。
  驗證:vitest(排序 + 欄位)。
- **SC-5** 色彩紀律:淨買超 = bull(紅)/ 淨賣超 = bear(綠);認購/認售 badge 不用紅綠;不寫方向性文案;色彩 binding 用 data-testid + 正向 assertion 鎖住。
  驗證:vitest(`data-testid` 上 assert `text-bull`/`text-bear` class;`queryByText(/做多|做空|賣選|滿倉/)` null)。
- **SC-6** `truncated: true` 時 UI 註記「僅統計成交金額前 {analyzed} 檔權證」(**cap=200**,spike L-2 校準;文案數字由 payload `analyzed` 插值,消除與 FLOW_CAP 雙源)。`[amendment 2026-07-14: design review R9 — 硬編 200 會在 cap 再校準時漏改]`
  驗證:pytest(>200 檔觸發 truncated)+ vitest(插值註記 render)。
- **SC-7** 空狀態兩文案分開:標的無掛牌權證 / 該日全部權證零成交(皆繁中)。
  驗證:vitest 兩條(payload 區分來源)。
- **SC-8** `no_trading_day` / `refresh=true` / cache(key = stock_id + date,`_cache_version`)慣例沿用;date 預設最近可得日(自適應回退,見 spike L-1)。
  驗證:pytest(回退鏈、cache 命中、refresh 跳 cache、no_trading_day flag)。
- **SC-9** 完成 gate:`pytest -q` + `ruff check .`(backend)+ `npm test` + `npm run build`(frontend)+ e2e `npm test`(實跑)+ chrome-devtools 截圖入 `docs/specs/warrant-broker-flow/screenshots/`。
  驗證:各指令 exit 0 + 截圖檔存在。

## 4. Edge cases

1. 標的無掛牌權證(快照 `by_underlying` 無 key)→ SC-7 文案 A。
2. 有掛牌但該日全零成交(交集空)→ SC-7 文案 B。
3. price dump 有量但分點報表未上料(T+0 晚間邊界)→ 可得性 probe 0 rows → 回退前一日;**空日結果不寫 cache**(避免當日稍晚上料後永遠讀到空)。
4. unmapped 權證(牛熊證/新掛牌)→ 不入統計;`unmapped_count`(全市場口徑)入 payload + log。
5. 單向交易 row(buy=0 或 sell=0)= 常態,正常聚合。
6. fan-out 中途 FinMind 失敗(402/429/5xx)→ 整包 fail 走 502 error contract,**不 cache 部分結果**(細節 Phase 1)。
7. `refresh=true` = user 主動重燒 fan-out(最多 ~201 requests),沿站內慣例不加額外防抖(切 tab 才載入已是意圖 gate)。
8. 分點 rows 對同分點多價位多筆 → 按 `securities_trader_id` 聚合(金額 = Σ price×股數)。
9. 窄容器(側欄/手機)兩欄疊直。

## 5. e2e 歸屬定案(e2e-conventions 判準表)

| 改動 | 歸屬 | 動作 |
|---|---|---|
| equity mode 新 tab UI/flow | `e2e/specs/equity.spec.ts`(E#) | 新增 describe「權證分點 tab」:切 tab 載入 + summary + top15 + 展開明細 |
| 新 backend endpoint `/api/warrants/{stock_id}/flow` | `backend/tests_e2e/test_api_warrants.py` | contract test 必補(shape + detail.error) |
| `no_trading_day` 行為 | `e2e/specs/no-trading-day.spec.ts`(NTD#) | grey zone 預設需要:週末凍鐘下資料日 badge 顯示回退日 |
| FinMind 新查詢形狀(TaiwanStockPrice date-only) | FAKE fixture + MANIFEST 條目 | 與 fetch method 同 commit(MANIFEST gate 順序耦合);縮樣 fixture |
| `@live` L# | 不加 | dataset 本身(warrant report)warrant-selector 已接;查詢形狀變化由 FAKE + pytest 覆蓋即可 `[auto-default: 不加 L# | reason: 無新 dataset,date-only price dump 若 schema 漂移會在 market_breadth 先炸]` |

## 6. Out of scope(v1 不做)

- 盤中即時流向(無資料源)
- 分點 → 權證逆查(FinMind 實測判死)
- 跨日累計 / 趨勢圖(next-time)
- 與主力券商面板交叉高亮(next-time)
- **牛熊證納入流向統計**(需擴 warrant-selector 快照 universe;next-time,spike L-3 定量:全市場有量 0.87% 檔數)
- unmapped 權證的 per-underlying 歸屬(邏輯不可得)

## 7. 開放決策(Phase 1 處理)

- 全市場 price dump 的 service 落點與 cache key(檢查 `market_breadth` 既有 fetch 可否共用;讀 `market-pipeline` skill)
- flow 聚合 service 落點(傾向新檔 `services/warrant_flow.py`,spec §5.1 寫 warrants.py 但該檔已 517 行且屬 TWSE/TPEx 直抓域;偏離為實作選擇非方向性)
- fan-out 併發模式(gather + TokenBucket;沿 chip fan-out 樣板)
- per-warrant 明細 cache 與 `warrant_brokers._cache_path` 的共用/隔離
