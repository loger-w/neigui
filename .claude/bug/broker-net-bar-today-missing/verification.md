# Verification — fix/broker-net-bar-today-missing(2026-08-18)

## 自動化 gate(auto-verify;來源 .claude/harness.json)

| step | command | cwd | result | exit |
|---|---|---|---|---|
| pytest | `python -m pytest -q` | backend/ | 729 passed, 1 skipped(baseline 721;+8 新測試,含 review round 1/2 補強;最終 HEAD 8ae899d) | 0 |
| ruff | `ruff check .` | backend/ | All checks passed | 0 |
| vitest | `npm test` | frontend/ | 101 files / 1091 passed(changelog 版本 pin 更新後 14/14) | 0 |
| build | `npm run build` | frontend/ | tsc -b + vite build ✓ | 0 |
| e2e(regression 抽樣,非必跑) | `npx playwright test specs/equity.spec.ts`(ports 8011/5181) | e2e/ | 41 passed / E10 全套負載 flake(spec 註解已記錄同型 flake ×3)→ 單跑 1 passed | 0 |

## 真實環境(SC-4;2026-08-18 17:35–17:43,secid_agg 尚未補齊當天的窗口內)

- 直打 FinMind(probe_secid.py 2330):daily_report 今日 4,920 rows;secid_agg 1440/1360/9268
  end_date=today 最後一天皆 2026-08-17 → 紅(重現)。
- 修後 backend(:8000 real):`GET /api/chip/2330/broker_history?ids=1440,1360&refresh=true`
  → `brokers.1440[-1] = {date: 2026-08-18, buy 2430, sell 287, net 2143}`,
  `brokers.1360[-1] = {2026-08-18, 1364, 3160, -1796}`;
  `GET /api/chip/2330?date=2026-08-18` 同分點 buy/sell/net 完全一致。
- UI(:5175 dev,籌碼總覽 2330,勾選「美林」):左圖「分點 (1) +2,143 張 · 20日 +9,679 張」
  且 2026-08-18 位置出現紅柱 → `evidence/SC-4-overview-2330-1440-today-bar.png`。
- 重走重現步驟:同一頁面 / 同一分點,當天柱已顯示,不再需要等隔天。

## 反向驗證(/bug 專屬 gate)

第一輪:`git revert --no-commit 28c56dc` → `pytest tests/test_broker_history.py` →
**1 failed(test_fetch_broker_history_fills_today_from_daily_report_when_secid_agg_lags)/ 22 passed**
→ `git revert --abort` → 23 passed。
最終(review 兩輪修完後):`git revert --no-commit 8ae899d ac86bda 28c56dc` → **3 failed
(SC-1 補列 / dup ids / refresh 透傳)/ 25 passed** → abort → 28 passed。紅測試確實抓到 bug。

## Review 後 real-env 複測(backend 以最終 HEAD 重啟)

`GET /api/chip/2330/broker_history?ids=1440,1360,1440&refresh=true`(含重複 id)→ 1.05s;
1440 / 1360 各恰 1 筆 2026-08-18 列,值同前(2143 / -1796)。

## Blast radius

`fetch_broker_history` 唯一 caller = `routes/chip.py:147`(主 tree;`.claude/worktrees/*` 為其他
流程分支副本不動);FAKE_FINMIND 模式 `FakeFinMindClient` override `_get`,`fetch_chip_summary`
走 fixture,e2e equity 41/42 綠(E10 為既知負載 flake)。未改功能抽樣:summary / brokers_window
(右側面板)real-env 值不變;泡泡圖 tab 不經 broker_history。
