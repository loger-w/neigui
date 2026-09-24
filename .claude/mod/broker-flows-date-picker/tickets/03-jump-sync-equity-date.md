# 03: 跳轉同步個股頁日期 + 收尾文件(🟢)

**What to build:** 已選日期下點股票跳個股頁 → 個股頁日期 = 該筆資料日(回退時為實際資料日);最新模式跳轉行為不變(W5)。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `onPickStock` 第 4 參數:已選日期 → as_of_date;最新 → null(RTL 既有斷言加第 4 參數 null,事前標「該變」)
- [ ] App 接線:非 null 日期同步個股頁日期且不被 auto-snap 覆寫
- [ ] e2e 新 E# 後半:跳轉後個股頁日期欄位 = 2026-06-25
- [ ] changelog 0.50.0 entry(changelog-conventions)
- [ ] `docs/next-time.md`:FinMind trader-only path 歷史深度待 probe
