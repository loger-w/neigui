"""Round 2 觀測批第二層:成本花在「常駐層」還是「累積的對話」?

這題決定了「瘦身 CLAUDE.md」值不值得。O8 顯示長 session 每 turn 平均重送 204k token,
而常駐層(harness + CLAUDE.md + tool schema)實測只有 ~40k。若差額真的是累積對話,
那瘦身常駐層在最貴的那批 session 裡只能碰到 1/5 的成本。

作法:同一個 session 內,第 1 個 turn 的 prompt ≈ 常駐層(對話還沒累積);
之後每個 turn 的 prompt 成長量 = 對話累積。兩者相除就是佔比。
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

from corpus import DIRS, cost_of, pct, rate_for

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")  # type: ignore[union-attr]


def turn_series(path: Path) -> list[tuple[int, float, str]]:
    """回傳主線每個 turn 的 (prompt_tokens, cost, model),依時間序。"""
    out = []
    seen: set[str] = set()
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for ln in text.splitlines():
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "assistant" or d.get("isSidechain"):
            continue
        msg = d.get("message", {})
        u = msg.get("usage")
        if not u:
            continue
        rid = d.get("requestId") or msg.get("id")
        if rid:
            if rid in seen:
                continue
            seen.add(rid)
        p = (
            u.get("input_tokens", 0)
            + u.get("cache_creation_input_tokens", 0)
            + u.get("cache_read_input_tokens", 0)
        )
        out.append((p, cost_of(u, msg.get("model", "")), msg.get("model", "")))
    return out


def main() -> None:
    series = []
    for d in DIRS:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.jsonl")):
            s = turn_series(f)
            if len(s) >= 20:
                series.append((f.name, s))

    print(f"# 觀測批第二層 — {len(series)} 個 turn>=20 的 session\n")

    print("## O9 — 常駐層 vs 累積對話(每個 session 內)")
    firsts, means, shares = [], [], []
    for _name, s in series:
        first = s[0][0]
        mean = statistics.mean(p for p, _, _ in s)
        firsts.append(first)
        means.append(mean)
        shares.append(first / mean if mean else 0)
    print(f"turn 1 的 prompt(≈常駐層) median = {statistics.median(firsts):,.0f} tok")
    print(f"全 session 平均 prompt/turn      median = {statistics.median(means):,.0f} tok")
    print(f"→ 常駐層佔每 turn 的比例         median = {statistics.median(shares) * 100:.1f}%")
    print("   (剩下的是這個 session 自己累積出來的對話 / 讀進來的檔 / tool 結果)")

    print("\n## O10 — prompt 隨 turn 成長的形狀(最長的 5 個 session)")
    longest = sorted(series, key=lambda x: -len(x[1]))[:5]
    print(f"{'session':<14}{'turns':>6}{'turn1':>10}{'turn25%':>10}{'turn50%':>10}{'turn75%':>10}{'末turn':>10}")
    for name, s in longest:
        n = len(s)
        pts = [s[0][0], s[n // 4][0], s[n // 2][0], s[3 * n // 4][0], s[-1][0]]
        print(f"{name[:12]:<14}{n:>6}" + "".join(f"{p:>10,.0f}" for p in pts))

    print("\n## O11 — 成本集中在 session 的哪一段?(把每個長 session 切四等分)")
    quarters = [0.0, 0.0, 0.0, 0.0]
    for _name, s in series:
        n = len(s)
        for i, (_p, c, _m) in enumerate(s):
            quarters[min(3, i * 4 // n)] += c
    tot = sum(quarters)
    for i, q in enumerate(quarters):
        print(f"  第 {i + 1} 段(turn {i * 25}-{(i + 1) * 25}%): ${q:>8,.2f}  {pct(q, tot)}")

    print("\n## O12 — 若常駐層砍掉 N tok,在真實語料能省多少?")
    total_turns = sum(len(s) for _n, s in series)
    print(f"turn>=20 的 session 合計 {total_turns:,} 個 main turn")
    for cut in (1_000, 5_000, 10_000, 20_000):
        # 常駐層在 prefix 最前面 → 幾乎總是 cache read(0.1x);用各 session 的實際 model 費率
        saved = 0.0
        for _n, s in series:
            for _p, _c, model in s:
                saved += cut * rate_for(model)[0] * 0.1
        print(f"  砍 {cut:>6,} tok/session → 省 ${saved:>7,.2f}(佔本批總成本 {pct(saved, tot)})")

    print("\n## O13 — 每個 session 的 turn 1 prompt 分布(常駐層實際多大)")
    fq = statistics.quantiles(firsts, n=4)
    print(f"  p25={fq[0]:,.0f}  median={statistics.median(firsts):,.0f}  p75={fq[2]:,.0f}  max={max(firsts):,.0f}")
    big = [f for f in firsts if f > 100_000]
    print(f"  turn1 就 >100k 的 session:{len(big)} 個(通常是 --continue / resume 接續舊對話)")

    print("\n## O14 — model 混用:哪個 model 花掉最多錢")
    by_model: dict[str, float] = defaultdict(float)
    turns_by_model: Counter = Counter()
    for _n, s in series:
        for _p, c, m in s:
            by_model[m] += c
            turns_by_model[m] += 1
    for m, c in sorted(by_model.items(), key=lambda x: -x[1]):
        print(f"  {m:<28} ${c:>8,.2f}  {pct(c, tot):>7}  turns={turns_by_model[m]:>6,}")


if __name__ == "__main__":
    main()
