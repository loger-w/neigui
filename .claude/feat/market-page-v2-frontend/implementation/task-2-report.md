# Task 2 report: market-format / breadth-svg / sector-breadth-svg 純函式 + 測試

TDD 三對 red/green,依序:market-format(SC-10)→ breadth-svg(SC-3)→ sector-breadth-svg(SC-5)。

## 1. market-format.ts / market-format.test.ts(SC-10)

### Red(commit `16ad269`)

```
❯ npx vitest run src/lib/market-format.test.ts
 FAIL  src/lib/market-format.test.ts [ src/lib/market-format.test.ts ]
Error: Cannot find module './market-format' imported from
C:/side-project/trash-cmoney/frontend/src/lib/market-format.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

### Green(commit `e0538b2`)

```
❯ npx vitest run src/lib/market-format.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

10 tests:eodLabel(非 null / null 兩態)、lotsToWan(換算 + 0 邊界)、pctText(0/1 位小數)、
signedPctPoints(正/負/零/null 四態)。所有 pinned 值(`lotsToWan(409858)="41.0"`、
`signedPctPoints(0.0015567)="+0.16"` 等)照 spec 逐一斷言通過。

## 2. breadth-svg.tsx / breadth-svg.test.ts(SC-3)

### Red(commit `2ca88b7`)

```
❯ npx vitest run src/lib/breadth-svg.test.ts
 FAIL  src/lib/breadth-svg.test.ts [ src/lib/breadth-svg.test.ts ]
Error: Cannot find module './breadth-svg' imported from
C:/side-project/trash-cmoney/frontend/src/lib/breadth-svg.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

### Green(commit `399ffe3`)

```
❯ npx vitest run src/lib/breadth-svg.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

14 tests 涵蓋失敗測試清單全 8 項(部分拆成多個 `it`):null 斷線分 2 段(pts 長度 [2,1])、
全 null → []、暖機序列(128 筆前 38 null,slice(60) 後全非 null / 1 段 / 60 pts)、
sliceWindow 尾端 60 與 len<n 原樣、valueDomain includeZero true/false、y 反轉映射
(max→pad、min→h-pad)、退化 domain → h/2、len===1 → x=w/2、zeroLineY pinned
`series=[{value:10}], h=50, pad=4 → 46`、zeroLineY 全 null → null、polylinePoints 格式。

## 3. sector-breadth-svg.tsx / sector-breadth-svg.test.ts(SC-5)

### Red(commit `c71eaaf`)

```
❯ npx vitest run src/lib/sector-breadth-svg.test.ts
 FAIL  src/lib/sector-breadth-svg.test.ts [ src/lib/sector-breadth-svg.test.ts ]
Error: Cannot find module './sector-breadth-svg' imported from
C:/side-project/trash-cmoney/frontend/src/lib/sector-breadth-svg.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

### Green(commit `06367a0`)

```
❯ npx vitest run src/lib/sector-breadth-svg.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

9 tests:classifyBin 四檔 + 嚴格 `>` 邊界(0.71→strong / 0.7→mid / 0.5→weak / 0.3→cold /
0→cold)、layoutCells 44 rows in 800×600 全在界內(ε=0.5)、n=0 → []、w=0 → []、
cell 帶 bin+sector+pct 透傳(前 3 筆實值:半導體 0.8→strong、金融 0.5→weak、
航運 0.2→cold)。

## 4. 完成前 gate

```
❯ npx tsc -b
(no output — clean)

❯ npm test
 Test Files  48 passed (48)
      Tests  461 passed (461)
   Duration  6.02s
```

461/461 通過(高於「428+」門檻),`npx tsc -b` 無輸出(clean)。`git status --short`
確認 working tree 乾淨,無 6 個交付檔以外的異動。

## 5. Concerns / 備註

- `buildSegments` / `zeroLineY` 的 x/y mapping 用「全序列 index / length」而非
  「segment-local index / length」— 這點在 spec 的公式(`x_i = pad + i * (w - 2*pad) / (len - 1)`,
  `len` = 輸入序列長度)已明確,以 `[null,5,7,null,3]` 測試鎖定(2 段,而非把兩段各自
  重新從 0 index 映射),避免日後誤「優化」成 segment-local 映射。
- `layoutCells` 的 `w/h ≤ 0 → []` 分支同時處理 `w<=0` 與 `h<=0`(spec 原文只點名
  `w=0` 測項),兩者行為一致所以未各自另立測試,屬安全的合理延伸而非未鎖行為。
