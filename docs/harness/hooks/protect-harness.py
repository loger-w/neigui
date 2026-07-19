#!/usr/bin/env python3
"""PreToolUse hook: harness 自我保護 — 改強制層本體須經 user 核准(ask 不 deny)。

守的範圍(2026-07-06 harness review Batch 1;2026-07-19 落地):
- ~/.claude/hooks/**(強制層 hook 本體與測試)
- ~/.claude/settings.json / settings.local.json(hook 註冊與 permissions)
- ~/.claude/agents/**(review agent 定義 — criteria 被弱化 = review 失效)
- **/.claude/harness.json(pre-push / auto-verify 共用驗證插槽)
- **/.git/hooks/** 與 **/scripts/git-hooks/**(git 防線本體)

ask 不 deny:改 harness 是合法維護動作,但不可靜默發生 — 防 agent(或被
prompt injection 的 agent)悄悄弱化強制層。docs/harness/ 鏡像副本不在
守備範圍(鏡像同步是日常操作,source of truth 在 user-global 原檔)。

覆蓋兩個面:
- Write/Edit/MultiEdit:file_path 落在守備範圍 → ask
- Bash/PowerShell:命令同時含「守備路徑」+「寫入動詞」→ ask
  (純讀 / 跑測試 / python 執行 hook 不攔)
"""

from __future__ import annotations

import json
import re
import sys

# Windows 路徑正規化後(\ → /)再比對;大小寫不敏感。
PROTECTED_FILE_PATTERNS = [
    re.compile(r"/\.claude/hooks/", re.IGNORECASE),
    re.compile(r"/\.claude/settings(\.local)?\.json$", re.IGNORECASE),
    re.compile(r"/\.claude/agents/", re.IGNORECASE),
    re.compile(r"/\.claude/harness\.json$", re.IGNORECASE),
    re.compile(r"/\.git/hooks/", re.IGNORECASE),
    re.compile(r"/scripts/git-hooks/", re.IGNORECASE),
]

# shell 命令面:守備路徑(斜線方向不定、可能以 ~ / $HOME / 磁碟機字母開頭)
PROTECTED_IN_CMD = re.compile(
    r"(?:"
    r"\.claude[/\\]hooks\b|"
    r"\.claude[/\\]settings(?:\.local)?\.json\b|"
    r"\.claude[/\\]agents\b|"
    r"\.claude[/\\]harness\.json\b|"
    r"\.git[/\\]hooks\b|"
    r"scripts[/\\]git-hooks\b"
    r")",
    re.IGNORECASE,
)

# 寫入動詞(shell / PowerShell)。純讀(cat / python / pytest / git add)不列。
WRITE_VERB = re.compile(
    r"(?:"
    r">{1,2}|"
    r"\btee\b|\bcp\b|\bmv\b|\brm\b|\bdel\b|\bcopy\b|\bmove\b|"
    r"\bsed\s+(?:-[A-Za-z]*\s+)*-i\b|"
    r"\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|"
    r"\bCopy-Item\b|\bMove-Item\b|\bRemove-Item\b|\bNew-Item\b"
    r")",
    re.IGNORECASE,
)


def _normalize(path: str) -> str:
    return path.replace("\\", "/")


def is_protected_file(file_path: str) -> bool:
    norm = _normalize(file_path)
    return any(p.search(norm) for p in PROTECTED_FILE_PATTERNS)


def shell_hits_protected(command: str) -> bool:
    return bool(PROTECTED_IN_CMD.search(command) and WRITE_VERB.search(command))


def _ask(reason: str) -> int:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"protect-harness: malformed stdin JSON: {e}", file=sys.stderr)
        return 0

    if not isinstance(payload, dict):
        return 0

    tool_name = payload.get("tool_name") or payload.get("toolName") or ""
    tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
    if not isinstance(tool_input, dict):
        return 0

    if tool_name in ("Write", "Edit", "MultiEdit"):
        file_path = tool_input.get("file_path", "")
        if isinstance(file_path, str) and file_path and is_protected_file(file_path):
            return _ask(
                "harness 自我保護:此檔屬強制層本體(hooks / settings / agents / "
                f"harness.json / git hooks)— {file_path}。改動需 user 明確核准。"
            )
        return 0

    if tool_name in ("Bash", "PowerShell"):
        command = tool_input.get("command", "")
        if isinstance(command, str) and command and shell_hits_protected(command):
            return _ask(
                "harness 自我保護:命令對強制層本體路徑做寫入類操作。"
                "改動需 user 明確核准。"
            )
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
