"""Batch 3b — 重跑 batch 3(E16-E30 因權限 artifact 全批作廢)。

修正三處:
  1. 探針檔一律放**專案目錄內**(repo 外的路徑 headless 會跳權限)
  2. 加 `--allowedTools Read`
  3. runner 對 permission_denials / 回覆含 "permission" 的 run 硬失敗,不進統計

量法不變:prompt_tokens(讀檔) − prompt_tokens(讀 1 行檔) = 該檔進 context 的真實 token。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner import REPO, git_show, measure, verify_settings_clean  # noqa: E402

H4 = "H4:command 檔瘦身有換到真實 token 節省(bytes 降幅 ≈ token 降幅)"
H5 = "H5:refs 分層把成本從『一次大檔』換成『多次小檔』,單輪走完反而更貴"

COMMANDS = ["feat", "mod", "perf", "bug", "refactor", "auto"]
CLAUDE_CMD = Path.home() / ".claude" / "commands"
PROBE_DIR = REPO / "docs" / "specs" / "harness-cost-research" / "_probe"
ALLOW = ["--allowedTools", "Read"]


def rel(p: Path) -> str:
    return p.relative_to(REPO).as_posix()


def read_probe(*paths: Path) -> str:
    listed = " and ".join(rel(p) for p in paths)
    return f"Read {listed} then reply with exactly: OK"


def main() -> int:
    print("=== Batch 3b:六個 command 的真實 token 成本(修正探針)===", flush=True)
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        tiny = PROBE_DIR / "tiny.md"
        tiny.write_text("x\n", encoding="utf-8")
        measure(
            "E31",
            "baseline:Read 一個 1 行檔",
            H4,
            prompt=read_probe(tiny),
            extra_args=ALLOW,
            note="扣掉這個才是檔案本身的 token",
        )

        # 改版後(在役)—— 複製進專案目錄以避開權限
        for i, name in enumerate(COMMANDS):
            src = CLAUDE_CMD / f"{name}.md"
            dst = PROBE_DIR / f"new-{name}.md"
            shutil.copyfile(src, dst)
            measure(
                f"E{32 + i}",
                f"讀 {name}.md 改版後({src.stat().st_size}B)",
                H4,
                prompt=read_probe(dst),
                extra_args=ALLOW,
            )

        # 改版前(main 上的鏡像版本)
        for i, name in enumerate(COMMANDS):
            text = git_show("main", f"docs/harness/commands/{name}.md")
            dst = PROBE_DIR / f"old-{name}.md"
            dst.write_text(text, encoding="utf-8")
            measure(
                f"E{38 + i}",
                f"讀 {name}.md 改版前({len(text.encode('utf-8'))}B)",
                H4,
                prompt=read_probe(dst),
                extra_args=ALLOW,
            )

        # H5:一輪 /feat 走到 Phase 3 各自要讀的檔集合
        refs = Path.home() / ".claude" / "harness" / "refs"
        after_files = ["feat.md"] + [
            f"refs-{n}"
            for n in [
                "feat-state",
                "sp-overrides",
                "scope-tiers",
                "feat-phase0-2",
                "review-protocol",
                "feat-phase3",
            ]
        ]
        after_paths = [PROBE_DIR / "new-feat.md"]
        total_b = (CLAUDE_CMD / "feat.md").stat().st_size
        for n in [
            "feat-state",
            "sp-overrides",
            "scope-tiers",
            "feat-phase0-2",
            "review-protocol",
            "feat-phase3",
        ]:
            d = PROBE_DIR / f"ref-{n}.md"
            shutil.copyfile(refs / f"{n}.md", d)
            after_paths.append(d)
            total_b += (refs / f"{n}.md").stat().st_size
        measure(
            "E44",
            f"改版後走到 Phase 3 的 7 檔({total_b}B)",
            H5,
            prompt=read_probe(*after_paths),
            extra_args=ALLOW,
            note=str(after_files),
        )

        old_feat = PROBE_DIR / "old-feat.md"
        measure(
            "E45",
            f"改版前走到 Phase 3 只需 feat.md({old_feat.stat().st_size}B)",
            H5,
            prompt=read_probe(old_feat),
            extra_args=ALLOW,
        )
    finally:
        shutil.rmtree(PROBE_DIR, ignore_errors=True)
        print(f"  探針目錄清除:{not PROBE_DIR.exists()}")

    return 0 if verify_settings_clean() else 1


if __name__ == "__main__":
    sys.exit(main())
