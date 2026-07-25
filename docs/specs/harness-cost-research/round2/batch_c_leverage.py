"""Batch C(E85-E97)— 觀測批指出的三個真實槓桿,逐一實測。

觀測批(corpus.py)的成本解剖:
  cache read 54.7% > cache write 36% > output 9%
  長 session(>100 turn)= 19.5% 的 session 吃掉 85% 成本
  subagent 佔 55% turn 但只佔 20.6% 成本

由此推出三條可執行假說,這批各自給一個受控實驗:
  H19 常駐 floor 是什麼組成的(read 那 54.7% 的分母)
  H20 同樣的讀檔量,合併成一個 turn 比拆成多個 turn 便宜(turn 是乘數)
  H21 effort 是流程層可以直接設的旋鈕,對成本影響多大
  H22 委派 subagent 比 coordinator 自己做便宜(觀測批的暗示,需受控驗證)
  H23 output 只佔 9%,所以「叫模型少講話」的省錢天花板很低
"""

from __future__ import annotations

from r2 import measure

H19 = "H19 常駐 floor 的組成"
H20 = "H20 turn 數 vs 合併讀取"
H21 = "H21 effort 對成本的影響"
H22 = "H22 委派 subagent vs coordinator 自己做"
H23 = "H23 output 指令的省錢天花板"
H24 = "H24 model 選擇對同一題的成本"

REFS = [
    "docs/harness/SPEC.md",
    "docs/harness/harness/RATIONALE.md",
    ".claude/harness.json",
    "docs/decisions.md",
    "docs/next-time.md",
]
FILE_LIST = "\n".join(f"- {p}" for p in REFS)

PARALLEL = (
    "Read these files and reply with only the total number of lines across all of them:\n"
    f"{FILE_LIST}\n"
    "Issue all Read calls in ONE message (parallel tool calls). Do not comment on the files."
)
SERIAL = (
    "Read these files and reply with only the total number of lines across all of them:\n"
    f"{FILE_LIST}\n"
    "Read them ONE AT A TIME: issue exactly one Read call per message, wait for the result, "
    "then issue the next. Do not comment on the files."
)

TASK = (
    "In this repo, find where the harness decides which ref files a given phase loads. "
    "Reply with just the file path and the function name."
)
DELEGATE = (
    "Use the Task tool to dispatch a single general-purpose subagent to answer this, "
    "then reply with only its answer: " + TASK
)

EXPLAIN = "Explain what prompt caching is and why cache hit rate matters for agent cost."
EXPLAIN_TERSE = EXPLAIN + " Answer in at most two sentences. No preamble, no lists."


def main() -> None:
    print("== Batch C:三條真實槓桿 ==\n")

    print("H19 — floor 拆解(關掉一整類常駐內容,看 prompt 少多少)")
    measure("E85", H19, "baseline(haiku,現況)", n=2)
    measure("E86", H19, "--tools \"\"(關掉所有內建工具 schema)", n=2, extra=["--tools", ""])
    measure("E87", H19, "--disable-slash-commands(關掉 skill 清單)", n=2,
            extra=["--disable-slash-commands"])
    measure("E88", H19, "--safe-mode(全部 customization 關)", n=2, extra=["--safe-mode"])

    print("\nH20 — 同樣 5 個檔:一個 turn 讀完 vs 逐個 turn 讀")
    measure("E89", H20, "5 檔:parallel(一個 message 發完)", prompt=PARALLEL, n=2,
            extra=["--allowedTools", "Read"])
    measure("E90", H20, "5 檔:serial(一個 message 一個 Read)", prompt=SERIAL, n=2,
            extra=["--allowedTools", "Read"])

    print("\nH21 — effort sweep(同一個真實任務,opus)")
    for exp, eff in (("E91", "low"), ("E92", "medium"), ("E93", "high"), ("E94", "xhigh")):
        measure(exp, H21, f"opus effort={eff}", prompt=TASK, model="opus", n=2,
                extra=["--effort", eff, "--allowedTools", "Read", "Grep", "Glob"])

    print("\nH22 — 委派 vs 自己做(同一題,opus coordinator)")
    measure("E95", H22, "opus 自己做", prompt=TASK, model="opus", n=2,
            extra=["--effort", "low", "--allowedTools", "Read", "Grep", "Glob"])
    measure("E96", H22, "opus 委派 subagent", prompt=DELEGATE, model="opus", n=2,
            extra=["--effort", "low", "--allowedTools", "Read", "Grep", "Glob", "Task"])

    print("\nH23 — output 指令的效果(output 只佔總成本 9%,天花板應該很低)")
    measure("E97", H23, "解釋題:預設", prompt=EXPLAIN, model="opus", n=2, extra=["--effort", "low"])
    measure("E98", H23, "解釋題:加簡潔指令", prompt=EXPLAIN_TERSE, model="opus", n=2,
            extra=["--effort", "low"])

    print("\nH24 — model 選擇(觀測批:76.6% 的花費落在 fable-5,單價是 opus-5 的兩倍)")
    for exp, m in (("E99", "claude-fable-5"), ("E100", "claude-opus-5"), ("E101", "claude-sonnet-5")):
        measure(exp, H24, f"同一題 × {m}", prompt=TASK, model=m, n=2,
                extra=["--effort", "low", "--allowedTools", "Read", "Grep", "Glob"])


if __name__ == "__main__":
    main()
