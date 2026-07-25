"""Batch 3 — H4:六個 command 檔改版前後的**實際 token 成本**(不是 bytes 代理)。

量法:比較「讀檔後回 OK」與「直接回 OK」的 prompt_tokens 差,即該檔進 context 的真實
token 數。這是 slash command 被叫用時真正付出的錢。

涵蓋 user 指定的六個流程:/feat /mod /perf /bug /refactor /auto。
改版前版本自 `main` 取(本分支的基點),寫進暫存檔後量測。
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner import git_show, measure, verify_settings_clean  # noqa: E402

H4 = "H4:command 檔瘦身有換到真實 token 節省(bytes 降幅 ≈ token 降幅)"
H5 = "H5:refs 分層把成本從『一次大檔』換成『多次小檔』,單輪走完反而更貴"

COMMANDS = ["feat", "mod", "perf", "bug", "refactor", "auto"]
CLAUDE_CMD = Path.home() / ".claude" / "commands"


def read_probe(path: Path) -> str:
    return f"Read the file {path.as_posix()} then reply with exactly: OK"


def main() -> int:
    print("=== Batch 3:六個 command 的真實 token 成本 ===", flush=True)

    # 基準:一次 Read 工具呼叫本身的開銷(讀一個 1 行檔)
    with tempfile.TemporaryDirectory() as td:
        tiny = Path(td) / "tiny.md"
        tiny.write_text("x\n", encoding="utf-8")
        measure(
            "E16",
            "baseline:Read 一個 1 行檔",
            H4,
            prompt=read_probe(tiny),
            note="扣掉這個才是檔案本身的 token",
        )

        # 改版後(在役)
        for i, name in enumerate(COMMANDS):
            p = CLAUDE_CMD / f"{name}.md"
            measure(
                f"E{17 + i}",
                f"讀 {name}.md(改版後,{p.stat().st_size}B)",
                H4,
                prompt=read_probe(p),
            )

        # 改版前(main 上的鏡像版本)
        for i, name in enumerate(COMMANDS):
            old = Path(td) / f"old-{name}.md"
            text = git_show("main", f"docs/harness/commands/{name}.md")
            old.write_text(text, encoding="utf-8")
            measure(
                f"E{23 + i}",
                f"讀 {name}.md(改版前,{len(text.encode('utf-8'))}B)",
                H4,
                prompt=read_probe(old),
            )

        # H5:一輪 /feat 走到 Phase 4,改版後要讀的檔集合 vs 改版前只讀 feat.md
        refs = Path.home() / ".claude" / "harness" / "refs"
        after_set = [
            CLAUDE_CMD / "feat.md",
            refs / "feat-state.md",
            refs / "sp-overrides.md",
            refs / "scope-tiers.md",
            refs / "feat-phase0-2.md",
            refs / "review-protocol.md",
            refs / "feat-phase3.md",
        ]
        listed = " and ".join(p.as_posix() for p in after_set)
        measure(
            "E29",
            "讀『改版後走到 Phase 4 的 7 個檔』",
            H5,
            prompt=f"Read these files: {listed}. Then reply with exactly: OK",
        )

        old_feat = Path(td) / "old-feat-only.md"
        old_feat.write_text(
            git_show("main", "docs/harness/commands/feat.md"), encoding="utf-8"
        )
        measure(
            "E30",
            "讀『改版前走到 Phase 4 只需 feat.md』",
            H5,
            prompt=read_probe(old_feat),
        )

    return 0 if verify_settings_clean() else 1


if __name__ == "__main__":
    sys.exit(main())
