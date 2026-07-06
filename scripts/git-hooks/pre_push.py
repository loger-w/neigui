#!/usr/bin/env python3
"""git pre-push hook 本體:跑 .claude/harness.json 的 verify 指令組。

design(docs/specs/harness-enforcement/design.md)§2.4:任一紅 → push 拒絕。
無 config → 警告放行(通用骨架的優雅降級);config 壞掉 → fail-closed(exit 1),
壞掉的防線不該靜默放行。e2e 不在此跑(太慢,留流程 gate)。
user 緊急繞過:git push --no-verify(block-no-verify.py 保證 Claude 用不了這條路)。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def _find_root() -> Path:
    res = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if res.returncode != 0:
        print("pre-push: git rev-parse 失敗,無法定位 repo root", file=sys.stderr)
        sys.exit(1)
    return Path(res.stdout.strip())


def main(root: Path | None = None) -> int:
    root = root or _find_root()
    config_path = root / ".claude" / "harness.json"
    if not config_path.is_file():
        print(f"pre-push: {config_path} 不存在,跳過驗證(警告)", file=sys.stderr)
        return 0
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        steps = config["verify"]
    except (json.JSONDecodeError, KeyError, UnicodeDecodeError) as e:
        print(f"pre-push: harness.json 解析失敗(fail-closed):{e}", file=sys.stderr)
        return 1
    for step in steps:
        name = step["name"]
        cwd = root / step.get("cwd", ".")
        cmd = step["cmd"]
        print(f"pre-push: [{name}] {cmd}(cwd={cwd})", file=sys.stderr)
        res = subprocess.run(cmd, shell=True, cwd=str(cwd))
        if res.returncode != 0:
            print(
                f"pre-push: [{name}] 失敗(exit {res.returncode})— push 已拒絕",
                file=sys.stderr,
            )
            return 1
    print("pre-push: 全部驗證通過", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
