# 新 session review prompt — feat/market-monitor

> **使用方式**:開新 Claude session,把下面「## Prompt(paste this)」整段貼到第一則訊息。所有檔案路徑都是絕對路徑,fresh session 不需任何前置 context。

---

## Prompt(paste this)

```
我有一個 `feat/market-monitor` branch 已完成 11-phase /feat 流程,28 commits,
SC-1..5 全有對應 test。已經跑過一輪 code-review(10 findings,9 accepted + 1 reject)
+ Phase 6 real-env 補了 2 個 bug(指數混入 / 中文名缺)。

請你用「冷讀者 + 對抗驗證」視角獨立 audit 這個 branch:catch every real
bug + 任何被 review-round-1 / Phase 6 漏掉的 correctness 問題 + scope creep
+ Phase 6 gap 是否真的可以 defer。不要照單全收前一輪結論。

## Project repo

`C:\side-project\trash-cmoney`(已在 feat/market-monitor branch)

## 必讀(按順序)

1. **branch artifacts**(設計脈絡 + 已知決策):
   - `C:\side-project\trash-cmoney\.claude\feat\market-monitor\brainstorm.md`
     SC-1..5 + 7 edge + 14 out-of-scope。每條 SC 帶「驗證方式」可逐條對。
   - `C:\side-project\trash-cmoney\.claude\feat\market-monitor\design.md`
     v3 architecture + 雙 endpoint vs 單 endpoint 取捨 + treemap library
     選擇 + 市值缺失 strategy + 收盤後 polling。v1→v2→v3 changelog 含 12
     條 finding 的 fix mapping。
   - `C:\side-project\trash-cmoney\.claude\feat\market-monitor\phase-7-evidence-table.md`
     5 SC 結構表(file:line / test count / evidence path / regression)。
   - `C:\side-project\trash-cmoney\.claude\feat\market-monitor\code-review-round-1.json`
     **已 accepted 過的 10 條 finding(R1-R10)**;**不要重複報告同樣問題**,
     focus on 漏的或 fix 不徹底的。R6 是唯一 reject(error code 字串不一致),
     看 reject reason 是否合理。
   - `C:\side-project\trash-cmoney\.claude\feat\market-monitor\real-env-verification.md`
     Phase 6 backend curl 證明 + UI 視覺 infra_fail 標明。

2. **project rules**:
   - `C:\side-project\trash-cmoney\CLAUDE.md`
     §2 Python 風格 / §3 React 風格 / §4 跨檔契約 / §9 Lessons Learned
     (含本次 8.5 沉澱的 7 條新 lessons)。

3. **diff**(實際改動,~28 commits):
   - `git -C C:\side-project\trash-cmoney log --oneline main..feat/market-monitor`
     看 commit topology。
   - `git -C C:\side-project\trash-cmoney diff main...feat/market-monitor`
     看完整 diff。也可 per-file 細看。

## 主要新增 / 修改檔案(供你選擇深讀)

**Backend**:
- `backend/services/finmind_realtime.py`(412 行新增 + Phase 4/6 fix)
  - fetch_market_snapshot pipeline(asyncio.gather + stale fallback)
  - _dedup_sector_map deterministic two-pass sort + 10-stock override
  - _compute_leaderboards 4 sorted lists + name_map + volume_ratio
  - _group_by_sector market_value desc + cap 30 + median fallback
  - _build_name_map(Phase 6 新增,從 TaiwanStockInfo)
  - stock_universe filter(Phase 6 新增,排除指數 001/002)
  - _max_tick_date(處理 Z UTC + microseconds)
- `backend/services/trading_session.py`(51 行新)
  - is_in_session(now, last_tick) 純函式
- `backend/routes/market.py`(56 行新)
- `backend/main.py` modify(register router)
- `backend/tests/test_finmind_realtime.py`(376 行,34 tests)
- `backend/tests/test_trading_session.py`(113 行,11 tests)
- `backend/tests/test_market_routes.py`(191 行,8 tests)

**Frontend**:
- `frontend/src/lib/heatmap-svg.tsx`(293 行新)
  - squarified treemap algorithm(Bruls et al. 1999)
  - colorForChange 9-bin bull=紅 / bear=綠
- `frontend/src/lib/market-types.ts`(43 行)
- `frontend/src/lib/market-api.ts`(26 行;bypass __apiGet 直接 fetch)
- `frontend/src/hooks/useMarketSnapshot.ts`(52 行;forceRefreshRef +
  cancelQueries + retry: 1 + refetchInterval callback)
- `frontend/src/components/MarketPage.tsx`(60 行)
- `frontend/src/components/MarketHeader.tsx`(67 行)
- `frontend/src/components/MarketHeatmap.tsx`(96 行)
- `frontend/src/components/MarketLeaderboard.tsx`(141 行)
- `frontend/src/components/ModeSwitch.tsx` modify(union+按鈕加 market)
- `frontend/src/App.tsx` modify(lazy MarketPage + 3-way ternary +
  handleSymbolPick reuse handlePick)
- `frontend/src/lib/heatmap-svg.test.ts`(15 tests)
- `frontend/src/lib/market-api.test.ts`(4 tests)
- `frontend/src/hooks/useMarketSnapshot.test.ts`(6 tests)
- `frontend/src/components/MarketHeatmap.test.tsx`(8 tests)
- `frontend/src/components/MarketLeaderboard.test.tsx`(9 tests)
- `frontend/src/components/MarketPage.test.tsx`(3 tests)
- `frontend/src/components/ModeSwitch.test.tsx`(modify,+2 tests)
- `frontend/src/lib/changelog.ts`(0.17.1 → 0.18.0 entry)

## 怎麼跑(建議用 Workflow,recall-biased)

ultracode 開啟,請用 `Workflow` 編排:

- **Phase 1: parallel finders**(8 angles × 6 candidates,fan-out
  per superpowers code review skill):
  - A 線性 diff 掃(每行 hunk + 圍住 function 全讀)
  - B 移除行守恆性(每行被 DELETE/REPLACE 的 invariant 哪裡重建?)
  - C 跨檔 caller 追(改的 function 被誰呼,新 precondition / return shape
    / exception 是否 breaks?)
  - D Reuse(新 code 有沒有 re-implement 既有 helper?— grep
    backend/services/finmind.py / frontend/src/lib/api.ts)
  - E Simplification(redundant state / copy-paste 變體 / deep nesting /
    dead code)
  - F Efficiency(冗餘運算 / 序列改並行 / closure-captured large env)
  - G Altitude(special case 補釘 vs 應該深層 generalize)
  - H Conventions(quote CLAUDE.md 規則 + quote 違反行)
  
- **Phase 2: per-finding adversarial verify**(N=3 skeptics each refute 預設,
  ≥2 refuted → drop)

- **Phase 3: completeness critic**(獨立 agent 問「什麼 modality / SC / phase
  沒被前面 cover?例如 Phase 6 UI 視覺 deferred 是否合理?盤後 endpoint 真實
  payload 你看過嗎?」)

## **特別注意這幾條**(已知 high-risk 區):

1. **`finmind_realtime.py` 的 stock_universe filter**(Phase 6 加的)— 用
   `r.get("stock_id") in primary_sector` 過濾指數,但這也會把任何 TaiwanStockInfo
   未及更新的「新上市股」一起 drop。是否該 fallback「保留 stock_id 為純數字
   且 ≥ 4 位數」?或加 log?

2. **squarified treemap 算法**(`lib/heatmap-svg.tsx`)— 我在 Phase 3
   初次寫 colW 公式錯一次被 test 抓到。現在 colW = sum / rect.h。請用
   adversarial 角度看:極端 aspect ratio(2000×10)/ 840 tiles / 部分 null
   market_value 邏輯是否真的全 cover?有沒有 sum=0 但 row 非空的 edge?

3. **TanStack Query refresh() + cancelQueries + polling**(`useMarketSnapshot.ts`
   Phase 4 R8 fix)— 我加了 cancelQueries 解 polling/refresh race,但這
   會 cancel 任何 in-flight queryFn 包含初始 mount fetch。User mount 時
   立刻按 refresh 會不會 cancel 第一次正當 fetch?

4. **App.tsx handleSymbolPick reuse handlePick + useCallback([])**(Phase 4 R3 fix)
   `useCallback([], handleSymbolPick)` 捕的 handlePick 是 first-render closure,
   裡面的 setter 都 React-stable 所以 functional OK,但 `eslint-disable-next-line
   react-hooks/exhaustive-deps` 是常見 anti-pattern source。是否該用 ref
   pattern 而非 disable?

5. **Phase 6 UI 視覺 deferred 是否合理** — RTL component test 涵蓋 logic +
   data-fill-bin attr 鎖 bull/bear 方向,但**沒有任何 real screenshot 證明
   一條真實漲跌幅 row 在 production CSS / Tailwind class 解析後實際是紅或綠**。
   `text-red-500` / `text-green-500` class 在 Tailwind 4 + @theme token 設定
   下可能 resolve 成別的色。Phase 6 evidence 寫「盤中視覺待補」,你覺得這算
   可接受 gap 嗎?

6. **Backend `routes/market.py` httpx catch dead code**(R5 documented):我
   保留了「明顯不會 fire」的 httpx tuple catch,理由是「defensive 防 service
   未來 leak」。但這個 test 是 `test_snapshot_returns_502_on_httpx_timeout`
   mock 整個 service 強制 raise httpx 來通過 — 不反映真實 path。這算「假
   test」嗎?

## 不要重複的工作

- 不用報 code-review-round-1.json 已 accept 的 R1-R10(都已 fix + 有
  regression test)
- 不用報 design-review-round-{1,2,3} 已修的 F1-F11 + B1-B4 + L1-L4 + C1-C5
- 不用報 ModeSwitch / heatmap-svg test 覆蓋率(已有 23+15+8 cases)
- 不用報 brainstorm.md SC `gzip 前` typo(已 amend 為 gzip 後)

## 輸出格式(嚴格 JSON)

```json
[
  {
    "id": "X1",
    "severity": "P0" | "P1" | "P2",
    "verdict": "CONFIRMED" | "PLAUSIBLE",
    "category": "correctness" | "regression" | "scope" | "convention" | "completeness",
    "file": "path/to/file.ext",
    "line": 123,
    "summary": "1 句話陳述問題",
    "failure_scenario": "具體 input/state → wrong output/crash",
    "fix_hint": "短一句怎麼修(可選)",
    "addressed_by_round_1": null | "Rx-partial" | "Rx-different"
  }
]
```

P0 = 必修(correctness bug / 違反 CLAUDE.md 鐵則)
P1 = 應修(maintenance / readability / 漏的 edge)
P2 = 可改進(nice-to-have)

每條 finding 必須具體可 actionable,不要寫「應該更詳細」這種模糊建議。
無新問題 → `[]`。Findings 上限 12 條(質 > 量;若超過代表 review 失焦)。

## 完成後請也回答這 3 個 yes/no

a. 「Phase 6 UI 視覺 deferred 到下個交易日盤中」是否真的可接受?(`yes / no /
   conditional + 理由`)
b. 「整個 branch 可以 merge 到 main」嗎?(`yes / no / fix-Xs-first`)
c. 「對外 push + PR」前還有什麼必做的?(可空陣列)

---

請開始。建議單一 Workflow 跑 8 finder × 6 candidates → 1-vote verify →
completeness critic → 整合。
```

---

## 給你(原 session 主)的補充說明

### 為什麼這份 prompt 這樣設計

1. **冷讀者導向**:前 3 段都是「請獨立 audit」「不要照單全收」「focus on
   漏的」。避免新 session 變成「verify 我已經做的事」(confirmation bias)。

2. **絕對路徑 + 已知決策清單**:fresh session 沒任何 context,所有路徑都
   要絕對 + 把已 accept 的 finding 列出讓它 skip 重工。

3. **5 high-risk 主動點名**:這幾條我自己也不太篤定,點明讓 reviewer 知道
   重點要 challenge 哪裡(`stock_universe filter` / `treemap algo` /
   `cancelQueries race` / `useCallback closure` / `視覺 gap` /
   `dead httpx catch`)。其中 #5 特別重要 — Tailwind 4 + @theme token 我
   還沒真實看過 production render,只靠 RTL `class.includes` 鎖。

4. **明確 NOT-redo 清單**:把 design / implementation / code-review 1 已 fix
   的 finding 列出,新 session 不會重做相同工作。

5. **Workflow 編排建議**:給出 8-angle 並 adversarial verify + completeness
   critic 的 pattern,對齊 superpowers code-review skill。

6. **單一 JSON output schema + 3 yes/no**:結構化結果可直接行動;3 個 yes/no
   一句話答收尾建議(merge ready? PR ready? blockers?)。

### 你應該預期的結果

如果 fresh session 認真做:
- 0-3 條真 P0(漏的 bug)→ 必須回來修
- 5-10 條 P1/P2(legitimate 觀點差異 / 小 nit)→ 你選擇接 / reject
- 對 #5 視覺 gap 的判斷可能是 `conditional` — RTL class 鎖 + 下個交易日補
  截圖

如果完全沒新 P0 → branch 真的 ready to merge / push。

### 我這 session 收尾

工作樹乾淨,28 commits 都在 `feat/market-monitor`。已 commit:
- `5c94ae7` docs(claude-md): Phase 8.5 sediment(最後一 commit)
- `99d176b` chore(changelog): bump 0.18.0
- `7abc72f` chore(artifacts)
- 以上之前都是 [red] / [green] / [refactor] / 🔴 fix

選 3「保留 branch 等 fresh review」最一致 — 新 session review + 下個交易日
盤中視覺截圖兩件可以一起在另一輪做完再 merge。
