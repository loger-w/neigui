"""Batch 5 — H9/H10:cache 狀態與「多檔 vs 單檔」。

H9 由 batch 4 的異常引出:opus 各條件的「每 token 成本」差到 2.5 倍,而 token 數只差
20% —— 差的是 prompt cache 命中狀態。若成立,則「省 context」的錢有很大一部分其實是
「讓 prefix 穩定、吃得到 cache」。

H10 直接驗 load-manifest 的計帳規則:spec 寫「同 path 多筆不去重 —— 每次 Read 都真的
佔窗口」。真的嗎?同一檔讀兩次 vs 讀一次,量得出來。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner import REPO, measure, run_probe, verify_settings_clean  # noqa: E402

H9 = "H9:opus 的成本差異主要來自 prompt cache 命中狀態,不是 token 數"
H10 = "H10:同一檔在一個 session 內讀兩次,第二次仍全額計入(spec 的不去重假設成立)"
H11 = "H11:同樣的總 bytes,拆成多檔比單檔貴(每次 tool call 有固定開銷)"

PROBE_DIR = REPO / "docs" / "specs" / "harness-cost-research" / "_probe5"
ALLOW = ["--allowedTools", "Read"]


def rel(p: Path) -> str:
    return p.relative_to(REPO).as_posix()


def main() -> int:
    print("=== Batch 5:cache 與多檔開銷 ===", flush=True)

    # --- H9:同一條件連跑 4 次,看成本隨 cache 變熱怎麼走 ---
    print("  E56 opus trivial × 4 連續(cache 暖機曲線):", flush=True)
    seq = []
    for i in range(4):
        r = run_probe("Reply with exactly: OK", model="opus")
        seq.append(r)
        print(f"    run{i + 1}: prompt={r.get('prompt_tokens')} cost=${r.get('cost_usd'):.4f}", flush=True)
    measure("E56", "opus trivial 連續 4 次(cache 暖機)", H9, model="opus", replicates=1,
            note=f"逐次成本 {[round(x.get('cost_usd', 0), 4) for x in seq]}")

    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        # --- H10:同一檔讀一次 vs 讀兩次 ---
        f = PROBE_DIR / "target.md"
        shutil.copyfile(Path.home() / ".claude" / "commands" / "feat.md", f)
        size = f.stat().st_size
        measure("E57", f"讀同一檔 1 次({size}B)", H10,
                prompt=f"Read {rel(f)} then reply with exactly: OK", extra_args=ALLOW)
        measure("E58", f"讀同一檔 2 次({size}B×2)", H10,
                prompt=(f"Read {rel(f)}. Then read {rel(f)} a second time. "
                        "Then reply with exactly: OK"),
                extra_args=ALLOW,
                note="spec 的不去重假設:第二次應該再全額計一次")

        # --- H11:同總量,單檔 vs 七檔 ---
        big = PROBE_DIR / "one-big.md"
        parts = []
        refs = Path.home() / ".claude" / "harness" / "refs"
        names = ["feat-state", "sp-overrides", "scope-tiers", "feat-phase0-2",
                 "review-protocol", "feat-phase3", "feat-phase8"]
        blob = ""
        for n in names:
            t = (refs / f"{n}.md").read_text(encoding="utf-8")
            blob += t
            p = PROBE_DIR / f"p-{n}.md"
            p.write_text(t, encoding="utf-8")
            parts.append(p)
        big.write_text(blob, encoding="utf-8")
        nb = big.stat().st_size
        measure("E59", f"單檔讀完 {nb}B", H11,
                prompt=f"Read {rel(big)} then reply with exactly: OK", extra_args=ALLOW)
        listed = " and ".join(rel(p) for p in parts)
        measure("E60", f"同樣內容拆 7 檔讀完({nb}B)", H11,
                prompt=f"Read {listed} then reply with exactly: OK", extra_args=ALLOW,
                note="與 E59 內容逐位元組相同,只差檔數")
    finally:
        shutil.rmtree(PROBE_DIR, ignore_errors=True)
        print(f"  探針目錄清除:{not PROBE_DIR.exists()}")

    return 0 if verify_settings_clean() else 1


if __name__ == "__main__":
    sys.exit(main())
