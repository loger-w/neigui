# refactor/options-p2-reuse — 批 A(options review P2 reuse 收割)

來源:docs/next-time.md「From /feat options-page-v2」P2 reuse 批次(2026-07-07 review 遺留)。
/auto 模式;退出條件 = 既有測試前後皆全綠。行為絕對不變。

## Phase 1|Why

同一格式化 / 聚合邏輯散落多處,任一處改格式必漏改其他處;user 排程收割 review 債,
options 區當前無並行改動(衝突窗口最小)。fmtSigned 條目已拍板踢出(兩處行為真不同:
全數字 vs k 縮寫,合併必動一邊顯示 → 違反行為不變;寫回 next-time 帶觸發條件)。

## Phase 2|測試覆蓋盤點(test-inventory)

| 目標 | 現有覆蓋 | 缺口(characterization 需求) |
|---|---|---|
| fmtPct 4 份(3 卡)| OIWalls / MaxPain 有元件測試但**未鎖 % 輸出**;PCR **無測試檔** | OIWalls:區間寬度 4.5% / 平均寬度 5.2%;MaxPain:hit_rate 三個 %;PCR:新測試檔鎖 mean/std(已是 %)與 hit_positive(小數 ×100)變體選擇 |
| 距現價 %(conclusion vs MaxPainCard)| conclusion 上方/下方/重合全覆蓋;卡片僅「下方 2.3%」 | 卡片「與現價幾乎重合」分支(spot 21505 vs maxPain 21500)|
| finmind_futures 聚合 | happy 鎖「自營/投信忽略」+ 真實 probe fixture ×2 | 足夠,不補 |
| RangeMapSvg spot 插入 | 中段插入 + spot null 已鎖 | spot 高於最高 strike → spot 列在最上(unshift 分支)|

實際發現(修正 next-time 描述):fmtPct 是**兩種變體 ×4 份** — OIWalls.fmtPct ==
PCR.fmtPct(輸入已是百分比,`p.toFixed`);MaxPain.fmtPct == PCR.fmtRatio(輸入小數,
`(p*100).toFixed`)。合併 = lib 兩個具名 export,零行為變。
[auto-default: 兩變體各保留、不統一輸入單位 | reason: 統一單位 = 動 payload 判讀,越線成 mod]

## Phase 3|步驟(每步單獨綠、純 🔵;step 0 為 🟢 characterization 獨立 commit)

- **Step 0(🟢)** characterization:OIWallsCard % 輸出、MaxPainCard hit_rate % + 重合分支、
  新 OptionsPCRCard.test.tsx(變體選擇鎖)、range-svg spot 頂端 unshift 邊界。跑 vitest 綠。
- **Step 1(🔵)** 新 `frontend/src/lib/options-format.ts`:`fmtPct`(輸入已是 %)+
  `fmtPctFraction`(輸入小數);三卡刪 local 版改 import(PCR.fmtRatio → fmtPctFraction)。
- **Step 2(🔵)** `options-conclusion.ts` export `maxPainDistance(spot, maxPain)`
  (diff / NEAR_COINCIDENT / 方向 / toFixed(1) 共用核心);maxPainSentence 與
  OptionsMaxPainCard 改用之。0.0005 門檻單一來源化。
- **Step 3(🔵)** backend `_inst_by_date(rows_inst, institutions=_INSTITUTIONS)` 加參數;
  `parse_foreign_futures` 聚合迴圈改 `_inst_by_date(rows_inst, ("外資",))`。
- **Step 4(🔵)** RangeMapSvg spot 插入:loop 內兩個 invariant 條件 hoist,
  改 `findIndex` 一次求插入點 + splice/unshift,語意逐 case 等價(含 spot≥top+1 unshift、
  spot 低於全部 strike 時無 spot 列)。

每步 diff < 100 行,無 reviewer dispatch(非大型)。

## E2E 判準

純結構重構、渲染輸出零變(characterization + 既有測試鎖)→ 豁免必跑,commit 註明。
