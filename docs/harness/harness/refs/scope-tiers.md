# S / M / L 規模分流(/feat + /mod 合一)

## /feat(寫 `state.json.scope`)

- **S**:單檔 / 無新資料流 / 無新依賴 / 不在 hot path、安全邊界、共用 util、對外 API
  → 跳 Phase 1 文件化,Phase 2 0 輪 review
- **M**:2-4 檔 → 完整流程(Phase 1 預設 1 輪 + P0 觸發限縮加輪;Phase 2 固定 1 輪)
- **L**:≥ 5 檔、跨前後端 / 跨服務,或鑑權 / 加密 / 金流 / 對外 API 任何單檔改動
  → 同 M 的輪數(2026-07-26 起 M/L 輪數統一,L 的差異在 /auto 慎用與風險面把關)
- **風險升級**:碰到高風險面無視檔案數一律升 L

**hot path 判準**:有 profile 證據,或專案文件 / skill 點名的路徑才算;無證據視為不在。

## /mod

- **S**(單檔 / 無對外 API / 無 migration):Phase 3 可簡化為 spec 內嵌 commit message,
  0 輪 review
- **M**(2-4 檔):完整流程,Phase 3 1 輪 review
- **L**(≥ 5 檔 / 對外 API / migration / 多 caller):完整流程,Phase 3 max 2 輪;
  **慎用自主模式**(caller map + backward compat 對齊價值高)
