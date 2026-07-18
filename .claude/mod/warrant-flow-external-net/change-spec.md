# change-spec — /mod warrant-flow-external-net

2026-07-18。拍板:docs/prompts-backlog.md B2(口徑 (b))+ 本日對話三題(summary = 成交額+外部淨額;用語 =「外部淨額」;整體設計核可)。前置:`current-state.md`(同目錄)。

## 1. 成功條件(可驗收)

- **SC-A(口徑正確)**:真實 2330 查詢,明細表「外部淨額」非全零(≥1 檔 |值|>0);抽 3 檔與 probe 腳本(scratchpad `probe_flow_metrics2.py`,同資料日)獨立計算值一致。unit = 元;量法 = API response vs probe 輸出逐檔對照。
- **SC-B(summary 口徑)**:每 kind `trade_value` = header「有量權證 N 檔」**同一集合**(mapped 到本標的且 money>0 的 `traded`,未 cap;不含 unmapped 權證形狀檔)之 Σ Trading_money;`external_net` = Σ analyzed 內非 null 權證之 external_net(該 kind 全 null → null)。fixtures 手算數字鎖(unit = 元)。
- **SC-C(null 紀律)**:報表空 / brand 抽取失敗 / 無 HO seat → 該權證 `external_net: null`;UI 顯示「—」(ink-dim);**絕不以 0 冒充**。單元測試逐條款鎖。
- **SC-D(白名單保留)**:§2 白名單全數行為不變,對應既有測試不紅。
- **SC-E(gate)**:pytest + ruff + vitest + build + e2e(E# 必跑,e2e-conventions 判準:equity mode UI 欄位語意變更)+ chrome-devtools 真實截圖入 `docs/specs/warrant-broker-flow/screenshots/`。

## 2. 不能破壞的既有行為白名單

1. `top_buy_branches` / `top_sell_branches` 數值、排序、top15 截斷、展開明細內容(branch 層 `net_value` 語意不變)。
2. 三種空態:`no_warrants` / `no_volume` 文案、404 `no_data`(近 10 交易日無資料)。
3. `no_trading_day` 條款(僅顯式 date 且回退時貼,不烙 cache)。
4. fetch 層零改動:候選日回退、probe-first、TaskGroup fan-out、inflight dedup(含 refresh key 隔離)、R15 空 dump 條款、retention cleanup。
5. `truncated` 註記插值(「僅統計成交金額前 N 檔權證」)。
6. kind badge 零紅綠;無方向性文案(做多/做空/賣選/滿倉 queryByText null 鎖)。
7. hook 介面 `{ data, loading, error, noTradingDay, refresh }`;`api.warrantFlow` 簽名。
8. 疊直/並排 responsive 分支(640 斷點)。

## 3. Backward compat / migration

- 前後端同 repo 原子切換(單 PR),無外部 API consumer(route passthrough)。
- `_CACHE_VERSION` 1→2:舊 result cache 自失效重建,**零 migration**;dump cache(`flow_prices_*`)shape 未變不 bump(版本欄在 result 與 dump 各自檔內 — dump 檔 `_cache_version` 同一常數,bump 會連 dump 一起作廢:接受,成本 = 每日 1 次重抓,換取單一版本常數的簡單性)。
- changelog:MINOR bump(使用者可感欄位語意變更),entry 於 Phase 4 依 changelog-conventions 撰寫。

## 4. Out of scope

- (a) 分點淨流動欄(拍板未採,不夾帶)。
- HO 量占比降級守衛(v1 不做 → Known risk R-2)。
- 快照歷史化、branch 層語意改動、覆蓋率視覺化、alias 自動發現。
- 順手 refactor(`_run_once` 複本收斂等 → 已在 next-time)。

## 5. Known risks

- **R-1 alias 表維護**:新發行商(華南/康和/永昌…)未入表 → 該發行商權證恆 null(不錯配,安全降級);log 計數可觀測。中信/元富/兆豐 HO 精確名未經真實樣本驗證(probe top30 未含),上線後抽驗,錯 → 修表一行。
  - 2026-07-18 已收割(fix/warrant-ho-alias-verify):中國信託 6160 / 兆豐 7000 實測相符;元富因 2026-04-06 併入台新證券(存續)改為 `("台新", "元富")` — 下方 §實作 alias 區塊為拍板當時快照,現行以 `services/warrant_flow.py` 為準。
- **R-2 無量占比守衛**:若某 brand 的 HO 名恰與他券商分點名衝突(理論上精確名 + 4 碼 id 下不可能),external_net 會錯值而非 null。接受:精確名單匹配已極嚴。
- **R-3 報表部分上料**:實測 ~10% 權證 T+1 報表空 → null(「—」),使用者會看到部分列缺值 — by design,不是 bug。
- **R-4 truncated 文案半真(接受)**:「僅統計成交金額前 N 檔權證」僅指涉外部淨額/分點排行(analyzed 口徑),`trade_value` 是全量 — 文案不精確,已知並接受,不另加範圍說明(白名單 5 逐字保留優先)。
- **R-5 HO id 長度檢查無鑑別力(reviewer R6)**:分點 id 也是 4 碼(`980C`)、HO id 含字母(`9B00`/`9A00`)→ `isdigit` 不可用;**seat 精確名單匹配是唯一鑑別**,`len == 4` 僅防異常資料,R-2 論證以名單匹配為準。

---

# Diff 級 spec(Phase 3)

分類:本次無 🔵;主體是一個對外契約 🔴(backend+frontend+e2e 同步),changelog 為隨附 chore。

## D1. `backend/services/warrant_flow.py` 🔴

1. 新增 module 常數:

```python
# HO(總公司造市)seat 精確名 alias;brand 不在表 → external_net null(R-1)
_ISSUER_ALIASES: dict[str, tuple[str, ...]] = {
    "元大": ("元大",), "凱基": ("凱基",), "統一": ("統一",), "富邦": ("富邦",),
    "群益": ("群益", "群益金鼎"), "台新": ("台新證券", "台新"),
    "永豐": ("永豐金", "永豐"), "國泰": ("國泰綜合", "國泰"),
    "國票": ("國票綜合", "國票"), "中信": ("中國信託", "中信"),
    "元富": ("元富",), "兆豐": ("兆豐",),
}
```

   HO 判定:seat 名 ∈ {alias, alias+"證券" for alias in aliases}(**精確名單匹配是唯一鑑別**;`len(trader_id) == 4` 僅防異常資料,見 R-5)。
2. 新增 `_issuer_brand(name: str, underlying_name: str) -> str | None`:
   - 前綴容錯:從 `underlying_name` 全長往下試到 2 字,首個 `name.startswith(prefix)` 成立者切除;全不成立 → None。
   - 餘串取首個匹配 `[0-9A-Z]` 之前的連續字元為 brand(regex `^[^0-9A-Z]+`);**brand ∉ `_ISSUER_ALIASES` → None**(白名單防錯配)。
3. `_aggregate(reports, winfo, money, trade_value_by_kind)` 改動:
   - 簽名加 `trade_value_by_kind: dict[str, float]`(get_flow 從**未 cap 的** `traded` 全量算)。
   - per-warrant:聚合時同步累計該權證 HO seats 的 net(brand 依 `winfo[wid]` 的 `name`/`underlying_name`;stub/快照缺欄用 `.get`)。
   - `warrant_rows[].net_value` → **`external_net: float | None`** = `-round(ho_net, 2)`;null 條款:該權證 rows 空、brand None、或無 HO row。
   - `summary` 新 shape:`{"call": {"trade_value": float, "external_net": float | None}, "put": {...}}`;external_net = Σ 非 null(全 null → None),四捨五入 2 位。
   - branch 聚合邏輯與輸出**逐字不動**(白名單 1)。
4. `_empty_payload`:summary 鍵同步為 `{"trade_value": 0.0, "external_net": None}`。
5. `_CACHE_VERSION = 2`。
6. `get_flow`:cap 前先算 `trade_value_by_kind`(用 `winfo[sid]["kind"]`),傳入 `_aggregate`;其餘流程不動。

## D2. `backend/tests/test_warrant_flow.py` 🔴+🟢

- 🔴 stub 升級:`_w()` 加 `underlying_name="台積電"`(名稱維持「台積凱基61購01」式縮寫 → 直接覆蓋前綴容錯路徑);`REPORTS_D1` seat 改真實命名 + 加 HO rows(id 不與分點衝突):
  - `030011`(凱基):`920A 凱基台北`(原 9200 兩列改 id/名)、`9800 元大`(原 元大-總公司 改名)、`9600 富邦`(原 富邦-建國 改名;net 0 列保留)、**新增 `9200 凱基` HO 列**。
  - `030012`(元大):`920A 凱基台北`、**`9800 元大` 即 HO**(改名後天然成為 030012 的 HO;030011/03001P 視角它只是外部 seat — 鎖 per-warrant brand scoping)。
  - `03001P`(國泰):`5850 統一`(原 統一-台北 改)、`9800 元大`;**無「國泰綜合」seat → external_net null**(鎖 no-HO 條款)。
  - `test_aggregation_values` 依新 rows 手算重鎖:summary(trade_value 全量、external_net)、branch 值(維持「該紅的紅在數值,結構 assertion 不變」)、`warrants[].external_net`。
- 🟢 新測試:
  1. 報表空權證 → external_net null(dump 有量、fan-out 回 0 rows)。
  2. brand 不在 alias 表(如「華南」)→ null。
  3. summary external_net:kind 內全 null → None;部分 null → 只加非 null;**含 no_volume 空態 summary 新鍵 assertion(延伸 test_empty_no_volume)**(reviewer R8)。
  4. trade_value 不受 cap 影響(cap 測試延伸:cap 外權證金額仍入 trade_value)。
  5. `test_e2e_fixture_consistency` 改寫:守恆(每權證 Σnet≈0)+ `920A 凱基台北` 淨買 > 0(E14 存活)+ 各權證 HO row 存在。
- 既有其餘測項(候選日/cache/fan-out/NTD/retention/錯誤)**不該紅**。

## D3. e2e fixtures rotation 🔴(`backend/tests_e2e/fixtures/`)

- `TaiwanStockWarrantTradingDailyReport_03001{1,2,P}.json`:seat 命名真實化(同 D2 命名),每檔**補 HO row 使守恆成立**(Σ buy value == Σ sell value per warrant,對齊 RE-1 真實世界性質),並維持:`凱基台北` 跨 fixture 聚合淨買 > 0(E14)、元大側淨賣(E14 sell col)。
- FAKE 快照側(mi_index/t187ap37 fixtures)**不動**:權證名縮寫由前綴容錯吸收;`030011→台積凱基61購01`(凱基)、`030012→台積元大61購02`(元大)、`03001P→台積國泰61售01`(國泰)brand 皆可抽。
- `warrants/price_day.json` 不動。

## D4. `backend/tests_e2e/test_api_warrants.py` 🔴

`test_flow_happy_path_shape_and_values`:summary 新 shape 手算(trade_value = price_day 三檔 Trading_money 按 kind;external_net 按 rotation 後 fixture)、`warrants[0]` 斷言 `external_net` 鍵與值、shape 鍵集不變(頂層鍵名單不動)。其餘 flow 測試不該紅。

## D5. `frontend/src/lib/warrant-flow-data.ts` 🔴

```ts
export interface WarrantFlowSideValue { trade_value: number; external_net: number | null; }
export interface WarrantFlowWarrantRow { ...; external_net: number | null; }  // net_value 移除
```

`WarrantFlowBranch` / `WarrantFlowBranchWarrant` 的 `net_value` **不動**。`barRatio/formatValue/formatNet` 不動。

## D6. `frontend/src/components/WarrantFlowPanel.tsx` 🔴

- summary:每 kind 改「成交額 {formatValue(trade_value)}(中性 ink)+ 外部淨額 {formatNet(external_net)}(netClass bull/bear;null → "—" ink-dim)」;區塊尾加一行 ink-dim 說明「外部淨額:排除發行商造市(總公司)席位後之分點淨買賣,— 為無法對映」。
- 明細表:欄頭「淨買賣超」→「外部淨額」;cell null → "—"(ink-dim),非 null 沿 netClass/formatNet;`data-testid="flow-warrant-net"` 保留(語意仍 net,降 selector churn)。
- branch 兩欄、展開、空態、truncated、refresh 按鈕 JSX 不動。

## D7. `frontend/src/components/WarrantFlowPanel.test.tsx` 🔴+🟢

- 🔴 mk() payload 升級新 shape;SC-2 改鎖「成交額/外部淨額 + 數字」;SC-4 欄頭「外部淨額」;SC-5 net 色 assertion 沿用(改讀 external_net 值)。
- 🟢:null → 「—」呈現(summary 與明細表兩處);說明行存在;外部淨額 null 時不套 bull/bear。

## D7b. `frontend/src/hooks/useWarrantFlow.test.ts` 🔴(reviewer R1)

mk() builder 的 summary 字面量升級新 shape(純型別連動,無行為 assertion 變動)。`tsconfig.app.json` include 全 `src`,不改則 `npm run build` TS error。歸 commit 2。

## D8. e2e 🔴(`e2e/specs/equity.spec.ts` E14、`e2e/helpers/selectors.ts`)

- E14:seat 名 assertion 依 rotation 更新(`凱基台北`/`元大`);金額 assertion 依新 fixture 手算更新;**加**資料級 assertion:summary 外部淨額具體數字 + 明細表首列 external_net 值(或「—」案例);selectors 增 `flowSummary: "flow-summary"`(既有 testid 收編)。
- NTD2 / 其他 spec 不動。

## D9. `docs/specs/warrant-broker-flow/spec.md`(docs 同步,chore — 不入三類;reviewer R5)

SC-2 → 「資料日 badge + 認購/認售 成交額+外部淨額」;SC-4 → 欄位「…成交金額、外部淨額(— = 無法對映)」;SC-5 補「外部淨額沿 bull/bear;null 中性」。加一段 §RE-1 說明恆等式與口徑變更(註明 2026-07-18 /mod)。

## D10. `frontend/src/lib/changelog.ts` 🟢(chore commit)

MINOR bump(0.34.4 → 0.35.0);entry 文字 Phase 4 依 changelog-conventions 撰寫。

## Commit 切分(順序)

1. 🔴 `fix(warrants): flow 外部淨額口徑 — backend 聚合 + 契約 + 測試`(D1+D2+D3+D4)
2. 🔴 `fix(frontend): flow 明細表/summary 外部淨額 UI + 型別`(D5+D6+D7+D7b)
3. 🔴 `fix(e2e): E14 外部淨額資料級 assertion + fixture rotation 對齊`(D8;fixture 檔在 commit 1 若 backend 測試依賴則併 1,以測試綠為準切)
4. 🟢 `chore(frontend): changelog 0.35.0`(D10)+ docs 同步(D9 併此或獨立 chore(docs))

## 既有測試紅名單(該紅)

- `test_warrant_flow.py`:`test_aggregation_values` / `test_aggregation_skips_bad_rows` / `test_report_date_filter` / `test_empty_no_warrants` / `test_e2e_fixture_consistency`。(`test_empty_no_volume` **不會紅** — 現況未 assert summary,reviewer R2;no_volume 路徑的 summary 新鍵改由 D2 🟢-3 延伸覆蓋)
- `test_api_warrants.py`:`test_flow_happy_path_shape_and_values`。
- `WarrantFlowPanel.test.tsx`:SC-2 / SC-4 / SC-5(部分)。
- `useWarrantFlow.test.ts`:型別層紅(tsc,見 D7b)。
- `equity.spec.ts` E14(seat 名與金額)。

**不該紅**:上述以外全部(特別是 flow 的候選日/cache/NTD/fan-out 測項、branch 排行 assertion、warrant-flow-data.test.ts、App.test.tsx)。

---

Phase 5 自評(2026-07-18):/code-review medium,6 finder(haiku)→ 0 P0/P1;3 P2 全 reject(panel null-format 二份複本未達三份門檻、kind_sum list-index 微、_ho_seat_names 重複建 set 微秒級);2 candidate 結構性 REFUTED(winfo KeyError 不可達、net_value 零殘留 consumer)。
self_review_head: 7b139d693078104c2a1bd1bde801493ba7cd781d
