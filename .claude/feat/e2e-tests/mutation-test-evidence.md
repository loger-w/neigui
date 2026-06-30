# Mutation Test Evidence

**Date**: 2026-06-30  
**Question**: 「測試真的有抓痛點嗎,還是 tautological 過綠?」  
**Method**: 故意改壞 3 處 production code → 驗證對應 test 紅 → revert → 驗證 green。

## Result summary

| Mutation | Production change | Predicted test | Actual result | Discriminative? |
|---|---|---|---|---|
| 1 | `routes/options.py:32 _today_str()` `clock.today()` → `date.today()` | `test_options_routes_clock::test_today_str_returns_fake_today` | **RED** with `AssertionError: assert '2026-06-30' == '2026-06-26'` | ✅ Yes |
| 2 | `services/finmind_fake.py` 移除 `if key.get("skip_store"): continue` | 任 `tests_e2e/test_api_*.py` 觸發 `get_finmind()` | **RED** with `assert 503 == 200`(collision raise → ValueError → main.py 503 handler) | ✅ Yes |
| 3a | `ModeSwitch.tsx` label `個股` → `個股X` | `navigation.spec.ts` N1 | **GREEN(false negative!)**— Playwright `name: 'X'` 預設 substring 匹配,`個股` 是 `個股X` 子串 | ⚠️ **Tautology 漏洞被抓到** |
| 3b | `ModeSwitch.tsx` label `個股` → `股票`(完全 rename) | `navigation.spec.ts` N1 | **RED** with click timeout | ✅ Yes |

## /goal 重要 finding(被 mutation test 抓到)

Playwright `getByRole(role, { name: 'X' })` 對 string 是 **substring 匹配**,不是 exact。
原 `name: '個股'` 會被 `'個股X' / '個股_old' / '個股_v2'` 等 prefix-match 過 — **tautology
漏洞**。

**修正**(已 apply):`e2e/helpers/selectors.ts` ROLES.modeSwitch* `name` 從 string
改成 RegExp `/^...$/` exact match。修正後 18 spec 仍全綠,但下次有人改 label 加
suffix,test 立刻紅。

## Phase 7 結構表新增「mutation 教訓」欄

| SC | 痛點測試 | Mutation 驗證 |
|---|---|---|
| SC-2 | `test_fake_finmind_manifest::test_manifest_no_store_key_collision` | Mutation 2 證實:collision check 移除 → all tests_e2e/* 503 |
| SC-4 | `test_options_routes_clock` | Mutation 1 證實:clock 退 wall → 立刻拿到 wall 日期 |
| SC-6 | `navigation.spec.ts` N1 + `selectors.ts` ROLES exact match | Mutation 3a 證實 substring 漏洞;3b 證實 exact match 鎖死 |

## 沒做的 mutation(留 Phase 8.5)

- Frontend hook level mutation(e.g., 拿掉 `useChipData::stale-drop seqRef` race 防護)— 需 race-condition 測試 framework,Phase 8.5 evaluate
- Visual regression mutation(改 colour token)— 需 Linux baseline 才能 diff,等 e2e-update-snapshots workflow 跑後再做
