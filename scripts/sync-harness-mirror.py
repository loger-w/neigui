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
- ~/.claude/skills/<6 支改寫複製 skill>/*.md → docs/harness/skills/<name>/(2026-07-27 納入)
- ~/.claude/skills/adhd/*.md   → docs/harness/skills/adhd/(2026-08-03 納入 — model 指定句只存磁碟)
- ~/.claude/CLAUDE.md          → docs/harness/global-rules.md
- ~/.claude/settings.json      → docs/harness/settings.json(2026-08-03 納入 — D1 model 檔位
  與 hooks 註冊的 enforce 落點,原本無 VCS;user 拍板接受 public repo 暴露個人 settings)

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
# 來源目錄本身可含 `*`(見 _expand_dirs);落點保留相對子路徑,不扁平化。
DIR_MAPS: list[tuple[str, str, str]] = [
    ("commands", "*.md", "commands"),
    ("hooks", "*.py", "hooks"),
    ("hooks/tests", "test_*.py", "hooks/tests"),
    ("agents", "*.md", "agents"),
    # harness/ 新落點:RATIONALE.md 必須進鏡像(否則被移出的敘事無回退路徑),
    # 兩份 manifest 是 JSON,pattern 不含 *.json 就不會進版控。
    ("harness", "*.md", "harness"),
    ("harness", "*.json", "harness"),
    ("harness/refs", "*.md", "harness/refs"),
    # 具名到兩支 harness skill —— **不要**寫 skills/*/references,
    # 那會把個人 skill(neoapi-python 等)的 references 一起掃進來。
    ("skills/auto-verify/references", "*.md", "skills/auto-verify/references"),
    ("skills/branch-lifecycle/references", "*.md", "skills/branch-lifecycle/references"),
    # 6 支改寫複製 skill(2026-07-27 拍板納入 VCS 保護;內文修正只存在磁碟,誤覆蓋 /
    # 磁碟事故原本只能靠 RATIONALE 文字重做)。grilling / grill-me 原文照抄零改動,
    # 還原重抓 raw 即可,刻意不納。附件只收 *.md(改寫全在 md;.ts/.sh 為 upstream 原件)。
    ("skills/brainstorming", "*.md", "skills/brainstorming"),
    ("skills/writing-plans", "*.md", "skills/writing-plans"),
    ("skills/test-driven-development", "*.md", "skills/test-driven-development"),
    ("skills/receiving-code-review", "*.md", "skills/receiving-code-review"),
    ("skills/verification-before-completion", "*.md", "skills/verification-before-completion"),
    ("skills/systematic-debugging", "*.md", "skills/systematic-debugging"),
    # adhd:Phase 0 模糊路徑的預設發散 skill(2026-08-03 grilling 轉正批),model 指定句
    # 等改寫只存在磁碟 → 納入 VCS 保護。附件同樣只收 *.md。
    ("skills/adhd", "*.md", "skills/adhd"),
]

# (原檔相對 ~/.claude、鏡像相對 docs/harness)
SINGLE_MAPS: list[tuple[str, str]] = [
    ("skills/auto-verify/SKILL.md", "skills/auto-verify.md"),
    ("skills/branch-lifecycle/SKILL.md", "skills/branch-lifecycle.md"),
    ("CLAUDE.md", "global-rules.md"),
    # settings.json:hooks 註冊(verify-gate 等)與主 session model 檔位的 enforce 落點
    # (2026-08-03 拍板納入;無 secrets — token 不在此檔)
    ("settings.json", "settings.json"),
]

# 鏡像側 orphan 掃描範圍(目錄、pattern)— 與上面兩組對映的落點一致
ORPHAN_SCOPES: list[tuple[str, str]] = [
    ("commands", "*.md"),
    ("hooks", "*.py"),
    ("hooks/tests", "*.py"),
    ("agents", "*.md"),
    ("skills", "*.md"),
    ("harness", "*.md"),
    ("harness", "*.json"),
    ("harness/refs", "*.md"),
    ("skills/auto-verify/references", "*.md"),
    ("skills/branch-lifecycle/references", "*.md"),
    ("skills/brainstorming", "*.md"),
    ("skills/writing-plans", "*.md"),
    ("skills/test-driven-development", "*.md"),
    ("skills/receiving-code-review", "*.md"),
    ("skills/verification-before-completion", "*.md"),
    ("skills/systematic-debugging", "*.md"),
    ("skills/adhd", "*.md"),
]


def _normalized(raw: bytes) -> bytes:
    # 鏡像經 git checkout 會轉 CRLF(core.autocrlf);行尾差異不是內容漂移
    return raw.replace(b"\r\n", b"\n")


def _expand_dirs(root: Path, rel: str) -> list[Path]:
    """來源 / 掃描目錄可含 `*`。

    舊寫法是 `(root / rel).is_dir()` —— rel 含 `*` 時該路徑不存在,`is_dir()` False 被
    靜默 continue,對映等於沒生效而 `--check` 照樣 exit 0(假綠)。build_pairs 與
    find_orphans **各有一個**,只修其中一個只解決一半。
    """
    if "*" in rel:
        return [p for p in sorted(root.glob(rel)) if p.is_dir()]
    d = root / rel
    return [d] if d.is_dir() else []


def _static_prefix(rel: str) -> str:
    """rel 中第一個帶 `*` 的路徑段之前的靜態部分 — 落點相對路徑的基準。"""
    parts: list[str] = []
    for part in rel.split("/"):
        if "*" in part:
            break
        parts.append(part)
    return "/".join(parts)


def build_pairs(claude_home: Path, mirror: Path) -> list[tuple[Path, Path]]:
    pairs: list[tuple[Path, Path]] = []
    for src_rel, pattern, dst_rel in DIR_MAPS:
        base = claude_home / _static_prefix(src_rel) if _static_prefix(src_rel) else claude_home
        for src_dir in _expand_dirs(claude_home, src_rel):
            for f in sorted(src_dir.glob(pattern)):
                if f.name in EXCLUDED or not f.is_file():
                    continue
                # 落點保留相對子路徑:扁平成 dst_rel/f.name 會把不同來源目錄的
                # 同名檔(各 skill 的 references/exceptions.md)壓成同一個檔。
                try:
                    rel_out = f.relative_to(base)
                except ValueError:
                    rel_out = Path(f.name)
                pairs.append((f, mirror / dst_rel / rel_out))
    for src_rel, dst_rel in SINGLE_MAPS:
        pairs.append((claude_home / src_rel, mirror / dst_rel))
    return pairs


def find_orphans(pairs: list[tuple[Path, Path]], mirror: Path) -> list[Path]:
    expected = {dst.resolve() for _, dst in pairs}
    orphans: list[Path] = []
    for sub, pattern in ORPHAN_SCOPES:
        for d in _expand_dirs(mirror, sub):
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
