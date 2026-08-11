# Phase 7 verification — bubble-volume-profile

2026-08-11。對照 brainstorm.md SC gate(含 amendments)逐條核。
自動化基準:round 2 全綠(pytest 689 / ruff / build / vitest 1038 / e2e 67)。

| SC | 實作 | 測試(名 + pass) | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 每價位水平量能條(比例/對齊/z-order) | `chip-bubble-svg.tsx:26`(buildVolumeProfile)、`:617-628`(bars 計算)、`:714-733`(render 層) | vitest `chip-bubble-svg.test.tsx`:「同價位跨分點聚合…」「SC-1: 每個價位一條 rect…」(含 65.6/32.8 絕對值)「SC-1: 條垂直置中…」「SC-1: z-order…」「edge: 60 檔價位…」「edge: 單一價位…」— 檔內 48/48 pass | `docs/specs/bubble-volume-profile/screenshots/SC-4-volume-profile-unselected.png` | vitest 全量 1038 pass(未改測試零紅) |
| SC-2 不影響既有互動(pointer-events none / 非紅綠非 accent) | `chip-bubble-svg.tsx:715`(g pointerEvents=none)、`:104-106`(profileFill 中性色) | vitest「SC-2: 量能層 pointer-events=none…」pass;既有 hitTest / brush / crosshair 測試 39 條全綠零修改 | real-env 點泡泡選取鏈正常(real-env JSON check 4) | e2e E23/E24/E29/E38-E41 全綠(泡泡互動既有 spec) |
| SC-3 恆全量計算不隨過濾變(+amendment 分母全量 max) | `chip-bubble-svg.tsx:610-620`(volumeProfile 全量 + clip 只決定畫不畫) | vitest「SC-3: selectedBrokers / priceRange 過濾下…不變」「edge: broker-axes fallback…分母仍為全量 max」pass | `SC-3-volume-profile-broker-selected.png`(選取後條形逐條相同) | 同列 e2e 泡泡互動 spec 全綠 |
| SC-4 畫面可指認(左緣灰調條、對齊價位、不遮泡泡) | 同 SC-1 | —(截圖類 SC) | 截圖:未選態 + 已選態兩張,fix 波後重拍;左上 brush hint 與頂條相距 30px+ 無疊字 | **待 user 過目**(操作路徑見收尾回報) |
| SC-5 e2e E42 資料級 | `e2e/specs/equity.spec.ts:414-436` | e2e E42 pass(rect 數 1 + 寬度幾何值 (svg寬-72)×0.2) | e2e round 2 全套 67 passed | 全套即 regression |
| amendment C-P2-1 邊界 clamp | `chip-bubble-svg.tsx:719-724` | vitest「edge: 條繪製範圍 clamp…」(height=80)pass | 涵蓋於截圖(常態幾何) | — |

失敗分流:無 FAIL 列。SC-4 的 user 過目為收尾回報義務,非 gate 缺口
(core-flow §7 UI SC 例外:「截圖: <路徑> + user 過目」)。

Regression 抽樣(real-env):籌碼總覽 tab(K 線 OHLC + 三大法人真值)、
右欄 PriceBarSvg — 均 PASS(real-env-verification-round-1.json)。
