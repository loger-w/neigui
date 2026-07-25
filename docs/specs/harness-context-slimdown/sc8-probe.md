# SC-8 前置 gate 實測 — `skillOverrides` 對 plugin skill 無效(FAIL)

- 量測日期:2026-07-25
- 對應 spec:`design.md` v12 §1 SC-8 / §4.1 / §7 步驟 0
- 環境:Claude Code 2.1.220;`superpowers@claude-plugins-official` user-scope 6.2.0(在役)
- 判定:**FAIL** → §4.1 主線(機械關閉 SDD)作廢,走備案

---

## 量法

黑箱實測,遵守 §2.3 審視紀律(禁止逆向工程 harness 內部實作)。每個條件改一次
`~/.claude/settings.json` 的 `skillOverrides`,開一個 headless session 問它自己的
available-skills 清單:

```
claude -p --model haiku --output-format json \
  "List every skill available to you whose name contains the substring '<needle>'.
   Output the names only, one per line, nothing else.
   If there are none, output the single word NONE."
```

腳本每輪結束一律從備份還原 `settings.json`,並印出還原後的值。

**主證據 = 模型自報的清單。** `--output-format json` 附帶的 `cache_creation` /
`cache_read` 只當輔助訊號,且**只證明得了「prompt 有沒有變」,證明不了「變了多少」**
—— 實測 quantization 明顯(見下方 P1/P2 的 ctx 反而不降),不可拿來當 bytes 級量尺。

---

## 第一輪:兩種 key 格式(spec 步驟 10 要求的兩種)

| 條件 | `skillOverrides` 追加 | 探針回報 | ctx |
|---|---|---|---|
| C0-control-before | 無 | `superpowers:subagent-driven-development` | 40,189 |
| A-prefixed-key | `superpowers:subagent-driven-development` → `user-invocable-only` | 仍列出 | 40,183 |
| B-bare-key | `subagent-driven-development` → `user-invocable-only` | 仍列出 | 40,183 |
| C0-control-after | 無 | 仍列出 | 40,183 |

B 與 C0-after 的 `cache_creation = 0` / `cache_read = 40,183` —— system prompt 與前一次
**逐位元組相同**,亦即 B 那次的設定對 prompt 毫無作用。

**但這一輪單獨看是不可採信的**,因為它分不開兩個假說:

- **H-a**:`skillOverrides` 對 plugin skill 無效(想證的)
- **H-b**:headless `-p` 模式整個忽略 `skillOverrides`(若成立,第一輪等於沒量到東西)

直接拿第一輪下結論,就是本 spec §2.3 點名的**配置外推**錯型。

---

## 第二輪:陽性對照(分辨 H-a / H-b)

拿一個**已知在清單裡的專案 skill**(`e2e-conventions`,來自 `.claude/skills/`)下同樣的
override。若探針看得到它消失 → 管道敏感,H-b 排除。

| 條件 | `skillOverrides` 追加 | 探針 needle | 回報 | ctx |
|---|---|---|---|---|
| P0-e2e-control | 無 | `e2e` | `e2e-conventions` | 40,183 |
| **P1-e2e-user-invocable-only** | `e2e-conventions` → `user-invocable-only` | `e2e` | **NONE** | 40,188 |
| **P2-e2e-off** | `e2e-conventions` → `off` | `e2e` | **NONE** | 40,182 |
| P3-sdd-prefixed-off | `superpowers:subagent-driven-development` → `off` | `subagent` | 仍列出 | 40,183 |
| P4-sdd-bare-off | `subagent-driven-development` → `off` | `subagent` | 仍列出 | 40,183 |
| P5-sdd-fullyqualified | `superpowers@claude-plugins-official:subagent-driven-development` → `user-invocable-only` | `subagent` | 仍列出 | 40,183 |

---

## 結論

1. **`skillOverrides` 機制本身可用**:對專案 / 個人 skill,`off` 與 `user-invocable-only`
   兩種值都確實把 skill 從模型可見清單移除(P1、P2)。**H-b 排除**,第一輪的陰性結果為真。
2. **對 plugin skill 無效**:三種 key 格式(裸名 / `plugin:skill` / `plugin@marketplace:skill`)
   × 兩種值(`off` / `user-invocable-only`)共五種組合全數無效,skill 照常出現在清單中,
   prompt 逐位元組不變。
3. spec 步驟 10 只要求試「裸名與前綴」兩種,本輪多試了 fully-qualified 與 `off` 值,
   **窮舉範圍大於 spec 要求**,結論不是「還沒試對 key」。

> `user-invocable-only` 是否保留手動叫用入口:對 plugin skill 而言**此問題已 moot**
> (override 根本沒生效)。對專案 skill 未另行實測 —— 本輪不需要它,不寫成已驗。

### 觸發的處置(design v12 §4.1 備案,已預先授權)

- 不關 SDD。改為在 `feat.md` Phase 3 寫一行負向指示(不呼叫該 skill,改用 Workflow;
  紀律見 `refs/feat-phase3.md`),接受該 skill 仍佔 context。
- **SC-2 降幅門檻自 ≥ 30% 放寬至 ≥ 5%**(同單位)。理由見 §4.1:SDD 佔淨刪量絕大部分,
  關不掉時剩下的只有 rationale 與重疊條。數字難看但誠實。
- 步驟 1b「摘寫三條紀律」**照做不變** —— 它原本是「關閉 SDD 的前提」,現在改為
  「負向指示的替代來源」,兩種情況下都需要。
- `~/.claude/feat-improvements.md` 記一條待解。

### 衍生觀察(不屬 SC-8,列入下輪 / Phase B 候選)

plugin skill 唯一已知的關閉途徑是 `enabledPlugins` 整支關掉。superpowers 整支停用會一併
移除 brainstorming / TDD / receiving-code-review 等本 harness 明文依賴的 skill,**不是
drop-in 替換**,本輪不做。其 context 效益值得單獨量測。
