# Change Spec — mod/root-color-scheme-dark(小活分流:CSS + index.html,無 API、無 migration)

> 來源:user 跑 `/code-review`(2026-09-25)對 mod/date-field-dark-calendar 的發現 #7 —
> 整站只有深色(`<html class="dark">`)卻未在 root 宣告 `color-scheme`,只替 DateField 補特例屬治標;
> 原 skill 理由「放 :root 會改捲軸」不成立(`* { scrollbar-color }` 已明確指定)。user 選「深色改整站宣告」。

## 決策
- `:root { color-scheme: dark }`(index.css)+ `<meta name="color-scheme" content="dark">`(index.html,
  CSS 載入前即生效,消除白閃)。
- 移除 `.date-field-input { color-scheme: dark }`(color-scheme 為繼承屬性,改由 root 繼承);
  月曆圖示 `invert(0.35)` 保留(dark 下圖示為淺色的前提不變)。
- 測試 seam:沿用既議定的 N7(e2e),擴充斷言 `html` computed color-scheme = dark。
- **事前標「該變」**:`changelog.test.ts`「最新版本是 vX」0.50.1 → 0.50.2(PATCH,fix / global);
  N7 標題 / 痛點註解改寫(範圍由 DateField 擴為整站)。

## 原生控制項盤點(grep 完整)
| 控制項 | 位置 | 預期 |
|---|---|---|
| `<select>` | OptionsHeader(合約)、WarrantSelector(發行商篩選) | 展開清單轉深;收合箭頭可能轉淺 |
| number(可見上下鈕) | ChipBubbleView ×2、MarketVolumeRatioPanel | 上下鈕轉深 |
| number(已隱藏上下鈕) | number-field、RangeSelector | 不變 |
| checkbox | ui/checkbox(原生 sr-only) | 不變 |
| date | DateField | 不變(已 dark) |

### 實作期追記(review 後實測,Playwright Chromium 149)
| 項目 | 結果 |
|---|---|
| CSS 載入前畫布底色 | before 白 (255,255,255) → after 深 (18,18,18)(meta 生效,白閃消除;`evidence/preCSS_canvas_*.png`) |
| 預設鍵盤焦點框(outline:auto,無自訂焦點樣式的按鈕等) | **會變**:黑白雙層框由「黑外圈為主」→「白外圈為主」,在深色頁面上更明顯(a11y 改善;`evidence/focus_ring_before_after.png`)— 補列預期變化 |
| 一般文字反白 | 不變(兩種 scheme 皆 (4,55,160)) |
| `<select>` 展開清單 | **盤點預期有誤**:清單底色**改前就已是深色**(沿用 select 自身 bg / 字色);只有選中列由藍底白字 (25,103,210)/白 5.37:1 → 淺藍底深灰字 (153,200,255)/(59,59,59) 6.43:1(對比未降;`evidence/controls_before_after.png`)。changelog 不宣稱清單轉深 |
| number 上下鈕 | 淺色鈕 (252,252,252) → 深色鈕 (44,44,44)(同上圖下半) |
| Safari 捲軸 | 未驗證(本機無 Safari;Safari 不支援 `scrollbar-color` 時捲軸會隨 dark 轉深) |
| Firefox 月曆圖示 | 未驗證(e2e 無 firefox project;依規格推論隨 dark 轉淺色) |
| visual baseline | CI e2e 以 `--grep-invert @visual` 排除,無比對;`<select>` 箭頭 / 焦點框可能改變 V2/V5 → merge 後觸發 `e2e-update-snapshots` workflow 重產 |

**事前標「該變」補記**:N7 再改標題(收斂為實際斷言範圍)+ 加 meta 斷言(review Std-4 / Spec-c)。

## 既有行為白名單
- W1 捲軸外觀不變(thin、thumb = line-strong、track 透明)。
- W2 收合 `<select>` 的底色 / 邊框 / 字色不變(箭頭色屬預期變化)。
- W3 自製 checkbox、number-field、RangeSelector 外觀不變。
- W4 DateField 收合外觀、月曆彈窗維持現況(深色)。
- W5 文字輸入框(搜尋框等)底 / 字 / placeholder 不變;文字反白色需實測記錄。
- W6 各頁面版面 / 配色(token 驅動部分)不變。

## Out of scope
- 自製日期元件 / 選取段反白(next-time 既有條目)。
