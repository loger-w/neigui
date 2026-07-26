"""Batch B(E135-E142)— model 分工的三個未量過的格子。

user 的分工提案:規劃 / 設計 / 寫 spec 用 fable-5,實作與 subagent 用 opus-5。
round 2 只量過「同一道簡單檢索題」的 model 成本比(fable 是 opus 的 4.74×),
**沒有量過寫作題,也完全沒量過品質**(hypotheses.md 未解清單第一條)。

本批三題:
  H27 寫 spec:fable vs opus 的成本差與產出差(user 已拍板要 fable,本批量代價與差異)
  H28 跨 model 委派:round 2 的 2.16× 委派懲罰是 opus→opus 量的。
      改成 fable→opus subagent(把工作從貴窗口搬到便宜窗口)會不會翻過來
  H30 review 判斷力:同一份 design.md,fable vs opus 各自回傳 findings

H27 的題目**刻意選用真實待辦**(review-protocol 三次載入的去重 change-spec),
產出直接可用,不是拋棄式探針。
"""

from __future__ import annotations

from r3 import measure, measure_full

H27 = "H27 寫 spec:fable vs opus"
H28 = "H28 跨 model 委派是否翻轉 2.16× 懲罰"
H30 = "H30 review 判斷力:fable vs opus"

TOOLS = ["--allowedTools", "Read", "Grep", "Glob"]

# --- H27:真實的 spec 寫作題(產出可用) ---
SPEC_TASK = (
    "本 repo 的 docs/harness/ 是 AI 開發 harness 的鏡像。\n"
    "先讀 docs/harness/harness/load-manifest.json 與 docs/harness/commands/feat.md。\n\n"
    "已知問題:feat-L profile 在 phase 1、2、4 各載入一次 "
    "harness/refs/review-protocol.md 與 superpowers 的 receiving-code-review skill —— "
    "同一份內容進 context 三次(合計重複 20,444 bytes)。三輪 review 本身是必要的"
    "(審的對象不同),重複的只是「怎麼接收 review 意見」那份說明書。\n\n"
    "請寫一份 change-spec(繁體中文),目標:消除重複載入、三輪 review 完全不動。必須含:\n"
    "1. 逐檔的確切修改(哪個檔、哪一段、改成什麼)\n"
    "2. context 被壓縮導致該內容已不在時的 fallback 路徑\n"
    "3. 驗證方式(怎麼證明改對了、怎麼證明三輪 review 沒被弱化)\n"
    "4. 這個改動可能打壞什麼\n\n"
    "不要編輯任何檔案,只輸出 spec。"
)

# --- H28:與 batch A 同一道檢索題,唯一變因是自己做 vs 委派 ---
TASK = (
    "In this repo, find where the harness decides which ref files a given phase loads. "
    "Reply with just the file path and the function name."
)
DELEGATE_TO_OPUS = (
    "Use the Task tool to dispatch a single general-purpose subagent **running model opus** "
    "to answer this, then reply with only its answer: " + TASK
)

# --- H30:同一份 design.md,對抗式 review ---
REVIEW_TASK = (
    "Read docs/specs/harness-context-slimdown/design.md in this repo.\n\n"
    "對它做對抗式 review。這份 design 已經過 12 輪審視,所以低垂的果實都被摘光了 —— "
    "你要找的是還沒被抓到的問題。\n\n"
    "只輸出 JSON,shape:\n"
    '{"findings":[{"severity":"P0|P1|P2","location":"<檔:節>","claim":"<一句話>",'
    '"why":"<為什麼是問題>","fix":"<建議>"}]}\n\n'
    "找不到就回傳空陣列 —— 湊數的 finding 比沒有 finding 更糟。"
)


def main() -> None:
    print("== Batch B:model 分工 ==\n")

    print("H27 — 寫 spec(真實待辦:review-protocol 去重)")
    measure_full("E135", H27, "opus 寫 change-spec", prompt=SPEC_TASK, model="opus", n=2,
                 extra=[*TOOLS, "--effort", "medium"],
                 note="產出存 outputs/,供人讀比對")
    measure_full("E136", H27, "fable 寫 change-spec", prompt=SPEC_TASK, model="fable", n=2,
                 extra=[*TOOLS, "--effort", "medium"],
                 note="user 拍板要 fable 寫 spec;本列量代價")

    print("\nH28 — 跨 model 委派(round 2 的 2.16× 是 opus→opus 量的)")
    measure("E137", H28, "fable 自己做", prompt=TASK, model="fable", n=2,
            extra=[*TOOLS, "--effort", "medium"], note="對照組")
    measure("E138", H28, "fable 派 opus subagent", prompt=DELEGATE_TO_OPUS, model="fable", n=2,
            extra=[*TOOLS, "Task", "--effort", "medium"],
            note="貴窗口 coordinator + 便宜 subagent")

    print("\nH30 — review 判斷力(同一份 design.md,已過 12 輪審視)")
    measure_full("E139", H30, "opus review design.md", prompt=REVIEW_TASK, model="opus", n=2,
                 extra=[*TOOLS, "--effort", "medium"])
    measure_full("E140", H30, "fable review design.md", prompt=REVIEW_TASK, model="fable", n=2,
                 extra=[*TOOLS, "--effort", "medium"])


if __name__ == "__main__":
    main()
