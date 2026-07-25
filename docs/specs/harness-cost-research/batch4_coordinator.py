"""Batch 4 — H6/H7/H8:opus 當 coordinator 時,常駐成本的錢是誰在付。

前三批都用 haiku 量 token 數(prompt 大小與模型無關,便宜)。但 harness 真正的
coordinator 是 opus,而 opus 的 input 單價高一個量級 —— **同樣的 token 數,在 opus 上
是不同的錢**。這批直接量錢。

真實任務探針(需要 Grep + Read,多 turn,結果可機械驗證):
  找出定義 `gate_for_phase` 的檔案路徑。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner import measure, settings_patch, verify_settings_clean  # noqa: E402

H6 = "H6:coordinator 換模型時,常駐層的邊際成本按 input 單價等比放大 — 省 context 對 opus 的價值遠高於 haiku"
H7 = "H7:真實多 turn 任務的成本由 turn 數主導,而非單次 prompt 大小"
H8 = "H8:砍常駐層(CLAUDE.md)對 opus coordinator 的省錢幅度 > 砍 command 檔"

TASK = (
    "Find which file defines the function gate_for_phase. "
    "Reply with only the file path, nothing else."
)
ALLOW = ["--allowedTools", "Read", "Grep", "Glob"]
PROJ_MD = Path("C:/side-project/neigui/CLAUDE.md")
USER_MD = Path.home() / ".claude" / "CLAUDE.md"


def main() -> int:
    print("=== Batch 4:opus coordinator 的錢 ===", flush=True)

    # --- H6:同一個 trivial 探針,三個模型 —— 隔離「常駐 prompt 的單價」 ---
    for eid, model in [("E46", "haiku"), ("E47", "sonnet"), ("E48", "opus")]:
        measure(eid, f"trivial 探針 @ {model}", H6, model=model, replicates=2,
                note="prompt token 數應該三者相同;差的是錢")

    # --- H7:真實多 turn 任務,三個模型 ---
    for eid, model in [("E49", "haiku"), ("E50", "sonnet"), ("E51", "opus")]:
        measure(eid, f"真實 grep 任務 @ {model}", H7, model=model, replicates=2,
                prompt=TASK, extra_args=ALLOW,
                note="量 turn 數 / output token / 總成本")

    # --- H8:opus coordinator 下,砍常駐層 vs 砍 command 檔 ---
    proj_orig = PROJ_MD.read_text(encoding="utf-8")
    user_orig = USER_MD.read_text(encoding="utf-8")
    try:
        PROJ_MD.write_text("# neigui\n", encoding="utf-8")
        USER_MD.write_text("# rules\n", encoding="utf-8")
        measure("E52", "opus + 兩份 CLAUDE.md 砍到 1 行", H8, model="opus", replicates=2,
                note="對照 E48(opus 原況)")
    finally:
        PROJ_MD.write_text(proj_orig, encoding="utf-8")
        USER_MD.write_text(user_orig, encoding="utf-8")

    with settings_patch(
        enabledPlugins={
            "superpowers@claude-plugins-official": False,
            "chrome-devtools-mcp@chrome-devtools-plugins": False,
        }
    ):
        measure("E53", "opus + 兩個 plugin 停用", H8, model="opus", replicates=2,
                note="對照 E48")

    # --- H7 續:同一任務在 opus 上,工具白名單收緊會不會少繞路 ---
    measure("E54", "opus 真實任務,只給 Grep(不給 Read/Glob)", H7, model="opus",
            replicates=2, prompt=TASK, extra_args=["--allowedTools", "Grep"],
            note="工具少 → turn 數與成本會怎麼變")

    # --- H6 續:trivial 探針在 opus 上,常駐層全關的下界 ---
    with settings_patch(
        skillOverrides={
            n: "off" for n in [
                "cancel-chain", "changelog-conventions", "e2e-conventions",
                "finmind-conventions", "frontend-conventions", "frontend-testing",
                "market-pipeline", "twse-tpex-conventions", "adhd", "auto-verify",
                "branch-lifecycle", "bencium-controlled-ux-designer", "frontend-design",
                "mlb-game-analyzer", "neoapi-python", "tw-market-research-distilled",
                "vercel-react-best-practices", "worldcup-game-analyzer",
            ]
        },
        enabledPlugins={
            "superpowers@claude-plugins-official": False,
            "chrome-devtools-mcp@chrome-devtools-plugins": False,
            "pyright-lsp@claude-plugins-official": False,
        },
    ):
        try:
            PROJ_MD.write_text("# neigui\n", encoding="utf-8")
            USER_MD.write_text("# rules\n", encoding="utf-8")
            measure("E55", "opus 全關(skill + plugin + CLAUDE.md)", H8, model="opus",
                    replicates=2, note="常駐成本下界 @ opus 單價")
        finally:
            PROJ_MD.write_text(proj_orig, encoding="utf-8")
            USER_MD.write_text(user_orig, encoding="utf-8")

    assert PROJ_MD.read_text(encoding="utf-8") == proj_orig
    assert USER_MD.read_text(encoding="utf-8") == user_orig
    print("  CLAUDE.md 還原檢查:OK")
    return 0 if verify_settings_clean() else 1


if __name__ == "__main__":
    sys.exit(main())
