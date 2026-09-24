# 01: api / hook 預先加上日期參數(🔵 prefactor)

**What to build:** 分點反查的 api 方法參數順序對齊同檔 sibling 慣例 `(id, date?, refresh?, options?)`,hook 增尾端選用 `date`(預設 null = 不帶 date)。使用者可見行為零變化。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] date 缺省時請求 query 與現況逐字相同(W1)
- [ ] 既有 frontend 測試全綠;僅 `useBrokerDailyFlows.test.ts` refresh 參數索引 `[1]→[2]`(事前標「該變」)
- [ ] 純重構 commit,不混行為 / 新功能
