# /doctor — codebase 體檢(唯讀,不改任何檔案)

跑兩邊的健康掃描,彙整成一份「真實訊號」報告。純觀察,不 fix、不 commit。

## 步驟

1. **Frontend**:在 `frontend/` 跑 `npx react-doctor`(吃 npx cache;失敗再 `npx react-doctor@latest`)。
2. **Backend**:在 `backend/` 跑 `ruff check . --select ALL --statistics`。

## 回報判準

- 兩邊分開回報,只列「值得行動」的類別,每類附件數 + 一句為什麼值得看。
- Backend 已知噪音直接過濾不報:S101(測試 assert)、D 系(docstring)、ANN 系(type annotation 全覆蓋)、COM812 等純格式規則——除非某類數字比上次報告明顯暴增。
- 已知刻意寫法不報病:PLC0415(避循環引用的函式內 import)、PLW0603(cache module state)、T201(probe 腳本 print)。
- 歷史基線:上次體檢結論如有留檔在 `docs/specs/doctor/`,對照著報增減;沒有就報當次絕對值。
- 發現值得排的待辦 → 建議寫進 `docs/next-time.md`(徵得同意或依當時指示),不順手改 code。
