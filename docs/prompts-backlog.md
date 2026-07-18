# prompts-backlog.md — next-time 任務的可執行 prompt

> 2026-07-17 自 docs/next-time.md 的可執行條目設計;開新 session 直接複製對應區塊當 goal。
> 用掉的 prompt 連同 next-time 對應條目一起刪;條目狀態若已變(例如已被別的流程順路解掉),以 next-time.md 為準先核對再開工。

---

## A. 立即可開

(上一批 A1-A4 已於 2026-07-17/18 全數完成並刪除:A1 = fix/tpex-warrant-iv-empty、A2 = fix/warrants-snapshot-partial-empty、A3 = chore/backlog-a3-cleanup、A4 = fix/warrant-ho-alias-verify — 中信/兆豐推定相符,元富因券商合併改對映台新證券 9B00)

---

## B. 條件觸發時用

### B1. EOD retry 放大器(觸發:prd 再現「配額貼上限 + 大盤分頁開著」)

```
/bug prd EOD retry 放大器實證與修復(設計風險升級,docs/next-time.md「From /mod chip-major-lazy-window Phase 2 probe」條目):`eod_pending` 時前端每 15s poll(useMarketSnapshot),每次 poll 會重觸發失敗的 EOD 背景計算(finmind_realtime.py::_ensure_eod_task 的 done_callback 自移除 → 下一請求重試);402 期間失敗日不落 cache → 每輪重抓,以配額再生速率持續燒、把 user_count 釘在 6000 上限。

現在的觸發情境:[填:何時觀測到、user_count 數值、大盤分頁狀態]
Phase 1 實證方法(照 finmind-conventions「在場證明」判讀法):user_info sampler(不計配額,可任意頻率)+ 開大盤分頁 + 人工把配額推近上限,觀測 user_count 是否釘住;關分頁應停。
候選修法(條目原載):EOD task 失敗後加 backoff 標記(如 60s 內不重觸發)— 注意別破壞「失敗時下一請求自然重試」的既有契約(_ensure_eod_task docstring),backoff 是節流不是禁止。
驗收:實證情境下 user_count 不再釘上限;正常路徑(EOD 成功)行為不變(pytest 全綠)。
```

(原 B2「flow 淨買賣超口徑」已由 mod/warrant-flow-external-net 執行完畢刪除,2026-07-18;拍板紀錄與 probe 實證全文遷至 `.claude/mod/warrant-flow-external-net/change-spec.md` 與 `docs/specs/warrant-broker-flow/spec.md` §3)

(原 B2「flow 外部淨額時序化」已由 feat/warrant-flow-net-history 執行完畢刪除,2026-07-18:拍板 (iii) 混合 + K=3 bounded backfill + `backfill` param 隔離 refresh 語意;design/評審全文在 `.claude/feat/warrant-flow-net-history/`)

### B3. options + chip-bubble 積欠 P2/P3 收割(觸發:下次想排 /refactor 時)

```
/refactor 收割兩批積欠的 review P2/P3(純結構,行為不變):
批 A — docs/next-time.md「From /feat options-page-v2」P2 reuse 批次 5 條:fmtSigned(options-range-svg vs OptionsNetTable,注意行為微異要先 characterization)、fmtPct ×3、距現價 % 計算(含 0.0005 門檻)、finmind_futures _inst_by_date vs parse_foreign_futures 聚合重複、RangeMapSvg spot 插入迴圈 hoist。
批 B — 「From /mod chip-bubble-intraday-overlay」的視覺/命名/測試補強清單(F-P3-9 色票進 chip-theme、F-P3-10/13/14/15 命名微簡化、F-P2-4 + F-P3-16~20 測試補強;測試補強標 🟢 與 🔵 分開 commit)。
紀律:兩批分開評估是否同分支;fmtSigned 行為微異處若合併需改行為 → 那條升級成 /mod 或當場排除,不硬併。每步單獨綠;Phase 2 先盤測試覆蓋。
```

### B4. 明細表補「分點淨流動」輔欄(觸發:看外部淨額時想分辨「單邊進出貨 vs 當沖來回」再貼)

```
/mod warrant flow 明細表加輔欄「分點淨流動比率」= Σ 正 net / 總買進金額(0-100%,拍板時的候選 (a),當時明確遞延「/mod brainstorm 再議」— .claude/mod/warrant-flow-external-net/change-spec.md Out of scope 條):高 = 分點單邊進出貨(有人在建/出部位)、低 = 同分點來回當沖(無方向)。與外部淨額互補:外部淨額給方向、淨流動比率給「這方向是真部位還是當沖噪音」。

2026-07-18 probe 樣本(2330 top30):多數 80-100%、當沖票 48-62%,鑑別度靠低值 outlier — brainstorm 先拍「值不值得佔一欄」(可能答案是不值得,砍掉這個 prompt 也是合法結論)。
實作面(若拍板做):_aggregate per-warrant 累計 Σ max(0, seat net) 一行級;報表空 → null 同 SC-C;中性色欄(比率無方向,不套 bull/bear);契約加欄位 = 對外契約改動,SC/e2e 照 e2e-conventions 判準。
```

---

## 未製 prompt 的類別(理由)

- **複本收斂類**(popover / 原生 select / combobox / RefreshButton / equity tab 鈕 / drift label 對映 / backend `_run_once` 複本組):觸發條件是「第 N 份複本出現」— 屆時人在寫新元件的流程裡,流程自帶 cat next-time,不需預製。
- **harness Batch 1-4**:等 user 想整理 harness 時一次談(含兩處需 user 手動/裁決)。
- **flake / spec 文字同步 / e2e 債 / 微優化**:各自掛明確重評估門檻,事件驅動。
