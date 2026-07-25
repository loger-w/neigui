"""Round 2 觀測批第三層:六個流程 command(/feat /mod /perf /bug /refactor /auto)的真實單次成本。

Round 1 H4 量的是「command 檔本身多少 token」(六檔合計 13,720)。那是靜態載入量。
真正該問的是:**跑一次這個流程要花多少錢**。答案由 turn 數主導,不由檔案大小主導。
"""

from __future__ import annotations

import statistics
import sys
from collections import defaultdict

from corpus import load_sessions, pct

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

FLOWS = ("/feat", "/mod", "/perf", "/bug", "/refactor", "/auto", "/chore")


def main() -> None:
    sessions = load_sessions()
    total = sum(s["main"]["cost"] + s["side"]["cost"] for s in sessions)

    by_flow: dict[str, list[dict]] = defaultdict(list)
    for s in sessions:
        hit = {c for c in s["commands"] if c in FLOWS}
        for f in hit:
            by_flow[f].append(s)
        if not hit:
            by_flow["(無流程 command)"].append(s)

    print(
        f"# 六個流程 command 的真實單次成本(語料 {len(sessions)} session,合計 ${total:,.2f})\n"
    )
    print(
        f"{'flow':<18}{'session':>8}{'總成本$':>10}{'佔比':>8}{'中位$':>9}{'中位turn':>9}{'中位out':>10}"
    )
    rows = []
    for flow, ss in by_flow.items():
        costs = sorted(s["main"]["cost"] + s["side"]["cost"] for s in ss)
        turns = sorted(s["main"]["turns"] for s in ss)
        outs = sorted(s["main"]["out"] + s["side"]["out"] for s in ss)
        rows.append((sum(costs), flow, len(ss), costs, turns, outs))
    for tot_c, flow, n, costs, turns, outs in sorted(rows, reverse=True):
        print(
            f"{flow:<18}{n:>8}{tot_c:>10,.2f}{pct(tot_c, total):>8}"
            f"{statistics.median(costs):>9,.2f}{statistics.median(turns):>9,.0f}"
            f"{statistics.median(outs):>10,.0f}"
        )

    print("\n## 帶流程 command 的 session vs 不帶的")
    with_flow = [s for s in sessions if any(c in FLOWS for c in s["commands"])]
    without = [s for s in sessions if not any(c in FLOWS for c in s["commands"])]
    for label, ss in (("有流程 command", with_flow), ("無流程 command", without)):
        if not ss:
            continue
        costs = [s["main"]["cost"] + s["side"]["cost"] for s in ss]
        turns = [s["main"]["turns"] for s in ss]
        print(
            f"  {label}:n={len(ss):>3}  總 ${sum(costs):>8,.2f} ({pct(sum(costs), total).strip()})  "
            f"中位 ${statistics.median(costs):>6,.2f}  中位 turn {statistics.median(turns):>4,.0f}"
        )

    print("\n## subagent 使用強度(依流程)")
    print(f"{'flow':<18}{'side turn 佔比':>16}{'side 成本佔比':>15}")
    for _tc, flow, _n, _c, _t, _o in sorted(rows, reverse=True):
        ss = by_flow[flow]
        mt = sum(s["main"]["turns"] for s in ss)
        st = sum(s["side"]["turns"] for s in ss)
        mc = sum(s["main"]["cost"] for s in ss)
        sc = sum(s["side"]["cost"] for s in ss)
        print(f"{flow:<18}{pct(st, mt + st):>16}{pct(sc, mc + sc):>15}")


if __name__ == "__main__":
    main()
