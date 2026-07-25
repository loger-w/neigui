"""Batch 2 — 追 Batch 1 的兩個反常 + H2/H3。

反常 1:關 8 支專案 skill 只省 76 tokens(≈9.5/支),但其 description 是長中文句。
反常 2:關 10 支個人 skill 反而 +34 tokens。

劑量反應是分辨「效應真的很小」與「機制根本沒生效」的標準做法:
若 1 支 → x、4 支 → 4x、8 支 → 8x,線性即效應為真;不線性代表另有東西在動。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner import measure, settings_patch, verify_settings_clean  # noqa: E402

H2 = "H2:skillOverrides 省下的 token 與被關掉的 description 長度成正比(劑量反應線性)"
H3 = "H3:CLAUDE.md 是常駐層最大單一成本,砍它的邊際效益高於砍 skill 清單"

PROJ = [
    "cancel-chain", "changelog-conventions", "e2e-conventions", "finmind-conventions",
    "frontend-conventions", "frontend-testing", "market-pipeline", "twse-tpex-conventions",
]
PERSONAL_LONG = ["auto-verify", "branch-lifecycle", "adhd", "tw-market-research-distilled"]


def off(names) -> dict:
    return {n: "off" for n in names}


def main() -> int:
    print("=== Batch 2:劑量反應 + CLAUDE.md ===", flush=True)

    # --- 劑量反應:專案 skill ---
    with settings_patch(skillOverrides=off(PROJ[:1])):
        measure("E07", "專案 skill 關 1 支(e2e-conventions)", H2)
    with settings_patch(skillOverrides=off(PROJ[:2])):
        measure("E08", "專案 skill 關 2 支", H2)
    with settings_patch(skillOverrides=off(PROJ[:4])):
        measure("E09", "專案 skill 關 4 支", H2)
    with settings_patch(skillOverrides=off(PROJ)):
        measure("E10", "專案 skill 關 8 支(複驗 E02)", H2)

    # --- 劑量反應:個人 skill(挑 description 最長的四支)---
    with settings_patch(skillOverrides=off(PERSONAL_LONG[:1])):
        measure("E11", "個人 skill 關 1 支(auto-verify,長描述)", H2)
    with settings_patch(skillOverrides=off(PERSONAL_LONG)):
        measure("E12", "個人 skill 關 4 支(全長描述)", H2)

    # --- H3:CLAUDE.md ---
    proj_md = Path("C:/side-project/neigui/CLAUDE.md")
    user_md = Path.home() / ".claude" / "CLAUDE.md"
    proj_orig = proj_md.read_text(encoding="utf-8")
    user_orig = user_md.read_text(encoding="utf-8")
    print(f"  (專案 CLAUDE.md {len(proj_orig)} chars / user CLAUDE.md {len(user_orig)} chars)")

    try:
        proj_md.write_text("# neigui\n\n台股籌碼 / 選擇權分析 dashboard。\n", encoding="utf-8")
        measure("E13", "專案 CLAUDE.md 砍到 3 行", H3,
                note=f"原 {len(proj_orig)} chars")
    finally:
        proj_md.write_text(proj_orig, encoding="utf-8")

    try:
        user_md.write_text("# 共通鐵則\n\n略。\n", encoding="utf-8")
        measure("E14", "user CLAUDE.md 砍到 3 行", H3,
                note=f"原 {len(user_orig)} chars")
    finally:
        user_md.write_text(user_orig, encoding="utf-8")

    try:
        proj_md.write_text("# neigui\n", encoding="utf-8")
        user_md.write_text("# rules\n", encoding="utf-8")
        measure("E15", "兩份 CLAUDE.md 都砍到 1 行", H3)
    finally:
        proj_md.write_text(proj_orig, encoding="utf-8")
        user_md.write_text(user_orig, encoding="utf-8")

    assert proj_md.read_text(encoding="utf-8") == proj_orig, "專案 CLAUDE.md 未還原"
    assert user_md.read_text(encoding="utf-8") == user_orig, "user CLAUDE.md 未還原"
    print("  CLAUDE.md 還原檢查:OK")
    return 0 if verify_settings_clean() else 1


if __name__ == "__main__":
    sys.exit(main())
