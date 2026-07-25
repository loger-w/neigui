"""Batch B(E73-E83)— 把專案 CLAUDE.md 逐節拆價。

Round 1 H3 只證明「CLAUDE.md 整份值 −20.4%」,那是個沒法執行的結論(總不能整份刪)。
這裡逐節刪,量每一節自己的 token 價,讓「哪一節該留」變成有價格的取捨,而不是感覺。

指標用 `prompt`(input+write+read)。它對快取狀態不變,所以即使每改一次檔就掉出快取,
節與節之間仍可比。
"""

from __future__ import annotations

import re

from r2 import REPO, measure

CLAUDE_MD = REPO / "CLAUDE.md"
H18 = "H18 CLAUDE.md 各節的單價"


def split_sections(text: str) -> list[tuple[str, str]]:
    """依 `## ` 標題切節;標題前的序言算 `__head__`。"""
    parts = re.split(r"(?m)^(## .*)$", text)
    out: list[tuple[str, str]] = [("__head__", parts[0])]
    for i in range(1, len(parts), 2):
        out.append((parts[i].strip(), parts[i] + parts[i + 1]))
    return out


def main() -> None:
    original = CLAUDE_MD.read_text(encoding="utf-8")
    sections = split_sections(original)
    print(f"== Batch B:CLAUDE.md {len(original):,} chars / {len(sections)} 節 ==\n")
    for name, body in sections:
        print(f"  {name[:52]:<54} {len(body):>6,} chars")
    print()

    base = measure("E73", H18, "baseline:完整 CLAUDE.md", n=2)
    base_prompt = base["prompt_med"]

    for i, (name, body) in enumerate(sections):
        exp = f"E{74 + i}"
        stripped = "".join(b for n, b in sections if n != name)
        try:
            CLAUDE_MD.write_text(stripped, encoding="utf-8")
            rec = measure(
                exp, H18, f"刪掉 {name[:38]}", n=2,
                note=f"{len(body)} chars removed",
            )
            d = rec["prompt_med"] - base_prompt
            print(
                f"        → Δ{d:>+8,.0f} tok  ({d / len(body):.3f} tok/char, "
                f"佔 baseline {d / base_prompt * 100:+.1f}%)"
            )
        finally:
            CLAUDE_MD.write_text(original, encoding="utf-8")

    # 全刪對照:確認逐節 Δ 加起來對得上整份的價
    exp = f"E{74 + len(sections)}"
    try:
        CLAUDE_MD.write_text("# neigui\n", encoding="utf-8")
        rec = measure(exp, H18, "全刪(只留一行標題)", n=2)
        print(f"        → Δ{rec['prompt_med'] - base_prompt:>+8,.0f} tok(整份的價)")
    finally:
        CLAUDE_MD.write_text(original, encoding="utf-8")

    assert CLAUDE_MD.read_text(encoding="utf-8") == original, "CLAUDE.md 未還原!"
    print("\nCLAUDE.md 已還原(逐位元組比對通過)")


if __name__ == "__main__":
    main()
