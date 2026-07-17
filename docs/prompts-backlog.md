# prompts-backlog.md — next-time 任務的可執行 prompt

> 2026-07-17 自 docs/next-time.md 的可執行條目設計;開新 session 直接複製對應區塊當 goal。
> 用掉的 prompt 連同 next-time 對應條目一起刪;條目狀態若已變(例如已被別的流程順路解掉),以 next-time.md 為準先核對再開工。

---

## A. 立即可開

### A3. 順手雜項(chore,一次清掉)

```
兩個一分鐘級雜項,不走完整流程,直接開 chore 分支處理後 PR:
1. docs/next-time.md 刪 stale 條目「chip 主力 540d 全量改拖曳觸發」(已由 mod/chip-major-lazy-window 於 2026-07-16 完成 merge,條目沒刪)。
2. repo 根目錄 untracked node_modules/:先 grep 根目錄 package.json 是否存在、有無任何引用,確認是誤跑 npm 的殘留後刪除;若根目錄本就不該有 node_modules,順手在 .gitignore 補一行並在 commit message 說明。
```

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

### B2. flow 淨買賣超口徑(需 user 先拍板,拍完填入再貼)

```
/mod warrant flow 明細表「淨買賣超」欄與 summary 買/賣對口徑重設計:RE-1 守恆恆等式 — 全分點報表下單權證跨全分點 net ≡ 0、每 kind 買==賣(2330 實測精確 0.0),現行欄位恆為零無資訊量。

條目:docs/next-time.md「From /feat warrant-broker-flow」[需 user 拍板] 條。
我拍板採用口徑:[選一,拍板後填入]
  (a) per-warrant「分點淨流動」= Σ 正 net,量測換手集中度
  (b) 發行商造市 seat 反向 net(散戶/主力 vs 造市商,需權證名 → 發行商 seat 對映 heuristic)
  (c) 砍欄位,summary 改「認購/認售成交額」兩數字
注意:動口徑 = 對外契約 + SC 改寫,Phase 1 現況表要列 flow payload 所有 consumer;e2e 歸屬依 e2e-conventions 判準(UI 欄位語意變更,大概率要動 spec)。
```

### B3. options + chip-bubble 積欠 P2/P3 收割(觸發:下次想排 /refactor 時)

```
/refactor 收割兩批積欠的 review P2/P3(純結構,行為不變):
批 A — docs/next-time.md「From /feat options-page-v2」P2 reuse 批次 5 條:fmtSigned(options-range-svg vs OptionsNetTable,注意行為微異要先 characterization)、fmtPct ×3、距現價 % 計算(含 0.0005 門檻)、finmind_futures _inst_by_date vs parse_foreign_futures 聚合重複、RangeMapSvg spot 插入迴圈 hoist。
批 B — 「From /mod chip-bubble-intraday-overlay」的視覺/命名/測試補強清單(F-P3-9 色票進 chip-theme、F-P3-10/13/14/15 命名微簡化、F-P2-4 + F-P3-16~20 測試補強;測試補強標 🟢 與 🔵 分開 commit)。
紀律:兩批分開評估是否同分支;fmtSigned 行為微異處若合併需改行為 → 那條升級成 /mod 或當場排除,不硬併。每步單獨綠;Phase 2 先盤測試覆蓋。
```

---

## 未製 prompt 的類別(理由)

- **複本收斂類**(popover / 原生 select / combobox / RefreshButton / equity tab 鈕 / drift label 對映 / backend `_run_once` 複本組):觸發條件是「第 N 份複本出現」— 屆時人在寫新元件的流程裡,流程自帶 cat next-time,不需預製。
- **harness Batch 1-4**:等 user 想整理 harness 時一次談(含兩處需 user 手動/裁決)。
- **flake / spec 文字同步 / e2e 債 / 微優化**:各自掛明確重評估門檻,事件驅動。
