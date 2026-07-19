#!/usr/bin/env python3
"""docs/harness/ 鏡像同步器(source of truth = ~/.claude/ 原檔)。

用法(repo root 執行):
    python scripts/sync-harness-mirror.py --check   # 只報告,任何不一致 exit 1
    python scripts/sync-harness-mirror.py --fix     # 原檔 → 鏡像 覆蓋同步

涵蓋(對映 docs/harness/README.md「檔案同步說明」,該節以本腳本為準):
- ~/.claude/commands/*.md      → docs/harness/commands/
- ~/.claude/hooks/*.py         → docs/harness/hooks/
- ~/.claude/hooks/tests/test_*.py → docs/harness/hooks/tests/
- ~/.claude/agents/*.md        → docs/harness/agents/
- ~/.claude/skills/{auto-verify,branch-lifecycle}/SKILL.md → docs/harness/skills/*.md
- ~/.claude/CLAUDE.md          → docs/harness/global-rules.md

目錄對映走 glob:原檔側新增檔案自動入列(消滅「清單漏列」雙源);
鏡像側多出無對應原檔的檔案報 ORPHAN(不自動刪 — 人工判斷是改名還是該刪)。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 除役檔不鏡像(harness-push-gate 2026-07-18 除役,原檔留存但不再是 harness 一部分)
EXCLUDED = {"harness-push-gate.py", "test_harness_push_gate.py"}

# (原檔目錄相對 ~/.claude、glob pattern、鏡像目錄相對 docs/harness)
DIR_MAPS: list[tuple[str, str, str]] = [
    ("commands", "*.md", "commands"),
    ("hooks", "*.py", "hooks"),
    ("hooks/tests", "test_*.py", "hooks/tests"),
    ("agents", "*.md", "agents"),
]

# (原檔相對 ~/.claude、鏡像相對 docs/harness)
SINGLE_MAPS: list[tuple[str, str]] = [
    ("skills/auto-verify/SKILL.md", "skills/auto-verify.md"),
    ("skills/branch-lifecycle/SKILL.md", "skills/branch-lifecycle.md"),
    ("CLAUDE.md", "global-rules.md"),
]

# 鏡像側 orphan 掃描範圍(目錄、pattern)— 與上面兩組對映的落點一致
ORPHAN_SCOPES: list[tuple[str, str]] = [
    ("commands", "*.md"),
    ("hooks", "*.py"),
    ("hooks/tests", "*.py"),
    ("agents", "*.md"),
    ("skills", "*.md"),
]


def _normalized(raw: bytes) -> bytes:
    # 鏡像經 git checkout 會轉 CRLF(core.autocrlf);行尾差異不是內容漂移
    return raw.replace(b"\r\n", b"\n")


def build_pairs(claude_home: Path, mirror: Path) -> list[tuple[Path, Path]]:
    pairs: list[tuple[Path, Path]] = []
    for src_rel, pattern, dst_rel in DIR_MAPS:
        src_dir = claude_home / src_rel
        if not src_dir.is_dir():
            continue
        for f in sorted(src_dir.glob(pattern)):
            if f.name in EXCLUDED or not f.is_file():
                continue
            pairs.append((f, mirror / dst_rel / f.name))
    for src_rel, dst_rel in SINGLE_MAPS:
        pairs.append((claude_home / src_rel, mirror / dst_rel))
    return pairs


def find_orphans(pairs: list[tuple[Path, Path]], mirror: Path) -> list[Path]:
    expected = {dst.resolve() for _, dst in pairs}
    orphans: list[Path] = []
    for sub, pattern in ORPHAN_SCOPES:
        d = mirror / sub
        if not d.is_dir():
            continue
        for f in sorted(d.glob(pattern)):
            if f.is_file() and f.resolve() not in expected:
                orphans.append(f)
    return orphans


def main(
    argv: list[str] | None = None,
    claude_home: Path | None = None,
    mirror: Path | None = None,
) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="docs/harness 鏡像同步器")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="只報告,不一致 exit 1")
    mode.add_argument("--fix", action="store_true", help="原檔 → 鏡像 覆蓋同步")
    args = parser.parse_args(argv)

    claude_home = claude_home or (Path.home() / ".claude")
    mirror = mirror or (Path(__file__).resolve().parent.parent / "docs" / "harness")

    pairs = build_pairs(claude_home, mirror)
    issues = 0

    for src, dst in pairs:
        if not src.is_file():
            print(f"SOURCE-MISSING  {src}(對映清單指到的原檔不存在)")
            issues += 1
            continue
        src_bytes = src.read_bytes()
        if not dst.is_file():
            if args.fix:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(src_bytes)
                print(f"COPIED   {dst.relative_to(mirror)}")
            else:
                print(f"MISSING  {dst.relative_to(mirror)}")
                issues += 1
        elif _normalized(dst.read_bytes()) != _normalized(src_bytes):
            if args.fix:
                dst.write_bytes(src_bytes)
                print(f"UPDATED  {dst.relative_to(mirror)}")
            else:
                print(f"DRIFT    {dst.relative_to(mirror)}")
                issues += 1

    for orphan in find_orphans(pairs, mirror):
        print(f"ORPHAN   {orphan.relative_to(mirror)}(鏡像多出、無對應原檔 — 人工處理)")
        issues += 1

    if issues:
        print(f"共 {issues} 個未解問題", file=sys.stderr)
        return 1
    print("鏡像同步:全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
