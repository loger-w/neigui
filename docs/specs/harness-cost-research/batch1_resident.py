"""Batch 1 — H1:常駐層(每個 session 都付的錢)的成本結構。

先建噪音底線(E01,n=5),再逐一關掉常駐來源。**一次只改一個變數。**
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner import (  # noqa: E402
    REPO,
    measure,
    settings_patch,
    verify_settings_clean,
)

H1 = "H1:常駐層(skill description 清單 + CLAUDE.md)佔每個 session 的固定成本,關掉可量到"

PROJECT_SKILLS = [
    "cancel-chain", "changelog-conventions", "e2e-conventions", "finmind-conventions",
    "frontend-conventions", "frontend-testing", "market-pipeline", "twse-tpex-conventions",
]
PERSONAL_SKILLS = [
    "adhd", "auto-verify", "bencium-controlled-ux-designer", "branch-lifecycle",
    "frontend-design", "mlb-game-analyzer", "neoapi-python",
    "tw-market-research-distilled", "vercel-react-best-practices", "worldcup-game-analyzer",
]


def off(names: list[str]) -> dict[str, str]:
    return {n: "off" for n in names}


def main() -> int:
    print("=== Batch 1:常駐層成本 ===", flush=True)

    # E01 噪音底線 —— 不改任何東西,n=5。若全距大於後續效應,整套量測不可採信。
    measure("E01", "baseline(未改動,n=5)", H1, replicates=5,
            note="噪音底線:同一設定重複量測的離散度")

    # E02 關掉 8 支專案 skill
    with settings_patch(skillOverrides=off(PROJECT_SKILLS)):
        measure("E02", f"專案 skill 全關({len(PROJECT_SKILLS)} 支)", H1,
                note="repo .claude/skills/ 的 description 退出常駐清單")

    # E03 關掉 10 支個人 skill
    with settings_patch(skillOverrides=off(PERSONAL_SKILLS)):
        measure("E03", f"個人 skill 全關({len(PERSONAL_SKILLS)} 支)", H1,
                note="~/.claude/skills/ 的 description 退出常駐清單")

    # E04 superpowers plugin 整支停用(SC-8 打不到的那 13 支)
    with settings_patch(enabledPlugins={"superpowers@claude-plugins-official": False}):
        measure("E04", "superpowers plugin 停用(13 支 skill)", H1,
                note="SC-8 證明 skillOverrides 碰不到 plugin skill,整支關是唯一途徑")

    # E05 chrome-devtools plugin 停用
    with settings_patch(enabledPlugins={"chrome-devtools-mcp@chrome-devtools-plugins": False}):
        measure("E05", "chrome-devtools plugin 停用(skill + MCP server)", H1,
                note="同時移除 6 支 skill 與其 MCP tool 定義 — 兩個效應混在一起")

    # E06 全部能關的都關(上界)
    with settings_patch(
        skillOverrides=off(PROJECT_SKILLS + PERSONAL_SKILLS),
        enabledPlugins={
            "superpowers@claude-plugins-official": False,
            "chrome-devtools-mcp@chrome-devtools-plugins": False,
            "pyright-lsp@claude-plugins-official": False,
        },
    ):
        measure("E06", "全關(專案+個人+三個 plugin)", H1,
                note="常駐成本的上界 — 這是理論最大可省")

    return 0 if verify_settings_clean() else 1


if __name__ == "__main__":
    sys.exit(main())
