# prompts-backlog.md — next-time 任務的可執行 prompt

> 2026-07-17 自 docs/next-time.md 的可執行條目設計;開新 session 直接複製對應區塊當 goal。
> 用掉的 prompt 連同 next-time 對應條目一起刪;條目狀態若已變(例如已被別的流程順路解掉),以 next-time.md 為準先核對再開工。

---

## A. 立即可開

(上一批 A1-A3 已於 2026-07-17/18 全數完成並刪除:A1 = fix/tpex-warrant-iv-empty、A2 = fix/warrants-snapshot-partial-empty、A3 = chore/backlog-a3-cleanup)

### A4. 中信/元富/兆豐 HO alias 實測補驗(消 mod/warrant-flow-external-net Known risk R-1,~15 分鐘)

```
/bug warrant flow 外部淨額 — 中信/元富/兆豐三家發行商的 HO seat 精確名未經真實樣本驗證(docs/next-time.md「中信/元富/兆豐 HO seat 精確名未驗證」條;alias 表現值:中國信託/元富/兆豐,按命名慣例推定):錯 → 該三家權證外部淨額恆 null(安全降級但白丟資料)。

Phase 1 實證(probe,~6 requests,照 finmind-conventions Bearer header):從 warrants_snapshot_latest.json 的 by_underlying["2330"] 各抽該三家發行、近日有量的權證 1-2 檔,打 TaiwanStockWarrantTradingDailyReport(data_id + start_date 單日),列出全部 4 碼 id + 名稱屬 brand 家族的 seat,確認總公司席位精確名與 id。參考樣板:scratchpad probe_flow_metrics2.py(上一輪已驗:元大9800/凱基9200/台新證券9B00/永豐金9A00/統一5850/富邦9600/群益9100/國泰綜合8880/國票綜合7790)。
Phase 2 修法:名不符 → services/warrant_flow.py `_ISSUER_ALIASES` 對應行補正(一行級);相符 → 零改動,只把 next-time 條目收割刪除 + 在該條註記實測結果。
驗收:三家各至少 1 檔權證 external_net 非 null(real-env curl /api/warrants/2330/flow?refresh=true 抽驗)+ pytest 全綠;next-time 條目刪除。
注意:這是驗證優先的小任務,別擴 scope(量占比守衛、alias 自動發現都已拍板 out of scope)。
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

(原 B2「flow 淨買賣超口徑」已由 mod/warrant-flow-external-net 執行完畢刪除,2026-07-18;拍板紀錄與 probe 實證全文遷至 `.claude/mod/warrant-flow-external-net/change-spec.md` 與 `docs/specs/warrant-broker-flow/spec.md` §3)

### B2. flow 外部淨額時序化(觸發:用了幾天單日快照後,想看趨勢再貼)

```
/feat warrant flow 外部淨額時序:權證分點 tab 目前只有單日快照(mod/warrant-flow-external-net 落地),把 summary 的認購/認售外部淨額拉成 per-day 時序(如近 20 交易日雙線圖),回答「外部人這陣子在持續加碼還是撤退」。

拍板點(brainstorm Phase 0 必談,一次帶齊):
1. 資料成本策略:冷抓一日 = 1 dump + cap 200 報表 fan-out ≈ 201 req → 20 日冷建 ≈ 4000 req(配額 6000/hr,幾乎吃滿一小時)。候選:(i) 只從既有 warrant_flow_<stock>_<date> result cache 累積(30 天 retention,零新增請求,但只有查過的日子有資料 → 圖有洞);(ii) 背景逐日補建 + 進度回饋(貴但完整);(iii) 混合 — cache 有的先畫、缺日惰性補。我傾向 (iii),但 (ii)/(iii) 的配額佔用要你點頭。
2. 時序落點:新 panel 區塊(flow tab 頂部)vs 併入既有 WarrantIvHistory 式展開 — UI 位階你挑。
3. 只做 summary 級雙線(認購/認售)v1,per-warrant 時序 out of scope — 同意與否。
注意:每日值直接取 result cache payload 的 summary.external_net,口徑零重算;null 日(該日全 kind null)畫斷點不補 0(SC-C 紀律延伸)。e2e 歸屬照 e2e-conventions(新 UI 區塊,大概率 E# 加 spec)。
```

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
