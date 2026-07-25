"""Round 2 觀測批:從真實 session transcript 挖成本結構(零 API 成本)。

Round 1 全部是 synthetic probe(`claude -p` 打固定 prompt)。這裡改用**已經發生的
331 個真實 session**,每則 assistant 訊息都帶完整 usage(含 1h/5m cache 分項、
model、effort、sidechain),可以回答 round 1 開放問題:

  * 真實 turn 數分布(round 1 只證明 turn 是乘數,沒量分布)
  * 真實 cache 命中率 → R1「集中改動」的實際可省金額上限
  * 1h vs 5m TTL 的實際使用比例
  * subagent(sidechain)佔總成本比例

定價(2026-07,claude-api skill 查證):
  opus-5    $5 / $25 per MTok      sonnet-5  $3 / $15      haiku-4.5 $1 / $5
  cache write 5m = 1.25x input,1h = 2x input,cache read = 0.1x input
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")

PROJECTS = Path.home() / ".claude" / "projects"
DIRS = [
    PROJECTS / "C--side-project-neigui",
    PROJECTS / "C--side-project-neigui--claude-worktrees-iv-backfill-fix",
    PROJECTS / "C--side-project-neigui--claude-worktrees-mod-warrant-iv-redesign",
    PROJECTS / "C--side-project-neigui-backend",
]

# $ / token(2026-07 官方定價;sonnet-5 目前在 intro 價 $2/$10,到 2026-08-31)
RATES = {
    "fable": (10.0e-6, 50.0e-6),
    "mythos": (10.0e-6, 50.0e-6),
    "opus": (5.0e-6, 25.0e-6),
    "sonnet": (2.0e-6, 10.0e-6),
    "haiku": (1.0e-6, 5.0e-6),
}


def rate_for(model: str) -> tuple[float, float]:
    m = (model or "").lower()
    if "synthetic" in m:
        return (0.0, 0.0)
    for key in RATES:
        if key in m:
            return RATES[key]
    return RATES["opus"]


def cost_of(u: dict, model: str) -> float:
    """官方 multiplier 還原單則訊息成本。"""
    inp, out = rate_for(model)
    cc = u.get("cache_creation") or {}
    w5 = cc.get("ephemeral_5m_input_tokens", 0)
    w1 = cc.get("ephemeral_1h_input_tokens", 0)
    if not (w5 or w1):  # 舊格式沒有分項,全算 5m
        w5 = u.get("cache_creation_input_tokens", 0)
    return (
        u.get("input_tokens", 0) * inp
        + w5 * inp * 1.25
        + w1 * inp * 2.0
        + u.get("cache_read_input_tokens", 0) * inp * 0.1
        + u.get("output_tokens", 0) * out
    )


def load_sessions() -> list[dict]:
    """主線 = `<id>.jsonl`;subagent / workflow = `<id>/subagents|workflows/**.jsonl`。

    sidechain 記錄**不在**主檔裡(主檔 isSidechain 全 false),而是 session 同名子目錄。
    Round 2 第一版漏掉它們,得到「subagent 佔 0%」的假結論。
    """
    sessions = []
    for d in DIRS:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.jsonl")):
            sub = d / f.stem
            side_files = sorted(sub.rglob("*.jsonl")) if sub.is_dir() else []
            s = parse_session(f, side_files)
            if s:
                sessions.append(s)
    return sessions


ZERO = {
    "turns": 0, "inp": 0, "w5": 0, "w1": 0, "read": 0, "out": 0,
    "cost": 0.0, "c_inp": 0.0, "c_w5": 0.0, "c_w1": 0.0, "c_read": 0.0, "c_out": 0.0,
}


def parse_session(path: Path, side_files: list[Path] | None = None) -> dict | None:
    main = dict(ZERO)
    side = dict(ZERO)
    models: Counter = Counter()
    efforts: Counter = Counter()
    commands: list[str] = []
    first_ts = last_ts = None
    seen_req: set[str] = set()

    lines: list[tuple[str, bool]] = []
    try:
        lines += [(ln, False) for ln in path.read_text(encoding="utf-8", errors="replace").splitlines()]
    except OSError:
        return None
    for sf in side_files or []:
        try:
            lines += [(ln, True) for ln in sf.read_text(encoding="utf-8", errors="replace").splitlines()]
        except OSError:
            continue

    for ln, is_side in lines:
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except json.JSONDecodeError:
            continue
        t = d.get("type")
        if t == "user":
            c = d.get("message", {}).get("content")
            if isinstance(c, list):
                c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
            if isinstance(c, str) and "<command-name>" in c:
                for part in c.split("<command-name>")[1:]:
                    if "</command-name>" not in part:
                        continue  # 未閉合 = 引用的文件內容,不是真的 command
                    name = part.split("</command-name>")[0].strip()
                    if 1 <= len(name) <= 40:
                        commands.append(name)
            continue
        if t != "assistant":
            continue
        msg = d.get("message", {})
        u = msg.get("usage")
        if not u:
            continue
        # 同一則 assistant 訊息可能因 streaming 被寫多行 → 用 requestId 去重
        rid = d.get("requestId") or msg.get("id")
        if rid:
            if rid in seen_req:
                continue
            seen_req.add(rid)
        bucket = side if (is_side or d.get("isSidechain")) else main
        model = msg.get("model", "")
        models[model] += 1
        if d.get("effort"):
            efforts[d["effort"]] += 1
        cc = u.get("cache_creation") or {}
        w5 = cc.get("ephemeral_5m_input_tokens", 0)
        w1 = cc.get("ephemeral_1h_input_tokens", 0)
        if not (w5 or w1):
            w5 = u.get("cache_creation_input_tokens", 0)
        ir, orr = rate_for(model)
        bucket["turns"] += 1
        bucket["inp"] += u.get("input_tokens", 0)
        bucket["w5"] += w5
        bucket["w1"] += w1
        bucket["read"] += u.get("cache_read_input_tokens", 0)
        bucket["out"] += u.get("output_tokens", 0)
        bucket["c_inp"] += u.get("input_tokens", 0) * ir
        bucket["c_w5"] += w5 * ir * 1.25
        bucket["c_w1"] += w1 * ir * 2.0
        bucket["c_read"] += u.get("cache_read_input_tokens", 0) * ir * 0.1
        bucket["c_out"] += u.get("output_tokens", 0) * orr
        bucket["cost"] += cost_of(u, model)
        ts = d.get("timestamp")
        if ts:
            first_ts = first_ts or ts
            last_ts = ts

    if main["turns"] + side["turns"] == 0:
        return None
    dur = None
    if first_ts and last_ts:
        try:
            dur = (
                datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
                - datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            ).total_seconds()
        except ValueError:
            dur = None
    return {
        "file": path.name,
        "main": main,
        "side": side,
        "models": models,
        "efforts": efforts,
        "commands": commands,
        "duration_s": dur,
        "start": first_ts,
    }


def pct(a: float, b: float) -> str:
    return f"{(a / b * 100 if b else 0):5.1f}%"


def main() -> None:
    sessions = load_sessions()
    print(f"# Round 2 觀測批 — {len(sessions)} 個有 usage 的真實 session\n")

    tot = defaultdict(float)
    for s in sessions:
        for b in ("main", "side"):
            for k, v in s[b].items():
                tot[f"{b}_{k}"] += v
    total_cost = tot["main_cost"] + tot["side_cost"]
    total_prompt = sum(
        tot[f"{b}_{k}"] for b in ("main", "side") for k in ("inp", "w5", "w1", "read")
    )

    print("## O1 — 全語料成本結構")
    print(f"總 API call(turn)數 : {tot['main_turns'] + tot['side_turns']:,.0f}")
    print(f"總 prompt token     : {total_prompt:,.0f}")
    print(f"總 output token     : {tot['main_out'] + tot['side_out']:,.0f}")
    print(f"總還原成本          : ${total_cost:,.2f}\n")

    rows = [
        ("uncached input", "inp", "c_inp"),
        ("cache write 5m", "w5", "c_w5"),
        ("cache write 1h", "w1", "c_w1"),
        ("cache read", "read", "c_read"),
        ("output", "out", "c_out"),
    ]
    print(f"{'成分':<16}{'tokens':>15}{'佔 prompt':>11}{'成本 $':>12}{'佔總成本':>10}")
    for name, tk_k, c_k in rows:
        tk = tot[f"main_{tk_k}"] + tot[f"side_{tk_k}"]
        c = tot[f"main_{c_k}"] + tot[f"side_{c_k}"]
        share = "—" if tk_k == "out" else pct(tk, total_prompt)
        print(f"{name:<16}{tk:>15,.0f}{share:>11}{c:>12,.2f}{pct(c, total_cost):>12}")

    print("\n## O2 — cache 命中率(read / (read+write))")
    w = tot["main_w5"] + tot["side_w5"] + tot["main_w1"] + tot["side_w1"]
    r = tot["main_read"] + tot["side_read"]
    print(f"write {w:,.0f} tok / read {r:,.0f} tok → 命中率 {pct(r, r + w)}")
    print(f"1h TTL 佔 write 的 {pct(tot['main_w1'] + tot['side_w1'], w)}")
    actual = tot["main_c_w5"] + tot["side_c_w5"] + tot["main_c_w1"] + tot["side_c_w1"]
    # 同一批 token 若改以 read 計價:5m write 1.25x→0.1x(÷12.5),1h write 2x→0.1x(÷20)
    hypo = (tot["main_c_w5"] + tot["side_c_w5"]) / 12.5 + (tot["main_c_w1"] + tot["side_c_w1"]) / 20.0
    print(
        f"若全部 write 都變成 read:${actual:,.2f} → ${hypo:,.2f} "
        f"(理論上限可省 ${actual - hypo:,.2f} = 總成本的 {pct(actual - hypo, total_cost).strip()})"
    )

    print("\n## O3 — subagent(sidechain)佔比")
    print(
        f"turn {pct(tot['side_turns'], tot['main_turns'] + tot['side_turns'])} / "
        f"成本 {pct(tot['side_cost'], total_cost)} / "
        f"output {pct(tot['side_out'], tot['main_out'] + tot['side_out'])}"
    )

    print("\n## O4 — turn 數分布(主線,排除 sidechain)")
    turns = sorted(s["main"]["turns"] for s in sessions if s["main"]["turns"])
    if turns:
        q = statistics.quantiles(turns, n=10)
        print(
            f"n={len(turns)}  median={statistics.median(turns):.0f}  "
            f"p90={q[8]:.0f}  max={max(turns)}  mean={statistics.mean(turns):.1f}"
        )
        buckets = Counter()
        for t in turns:
            b = "1" if t == 1 else "2-5" if t <= 5 else "6-20" if t <= 20 else "21-100" if t <= 100 else ">100"
            buckets[b] += 1
        cost_by_bucket: dict[str, float] = defaultdict(float)
        for s in sessions:
            t = s["main"]["turns"]
            b = "1" if t == 1 else "2-5" if t <= 5 else "6-20" if t <= 20 else "21-100" if t <= 100 else ">100"
            cost_by_bucket[b] += s["main"]["cost"] + s["side"]["cost"]
        print(f"{'turn 區間':<10}{'session 數':>10}{'佔比':>8}{'總成本':>12}{'佔成本':>9}")
        for b in ("1", "2-5", "6-20", "21-100", ">100"):
            print(
                f"{b:<10}{buckets[b]:>10}{pct(buckets[b], len(turns)):>8}"
                f"{cost_by_bucket[b]:>11,.2f}{pct(cost_by_bucket[b], total_cost):>10}"
            )

    print("\n## O5 — 流程 command 使用次數")
    cmds = Counter()
    for s in sessions:
        cmds.update(s["commands"])
    flow = ("feat", "mod", "perf", "bug", "refactor", "auto", "chore")
    for c, n in cmds.most_common(20):
        mark = " <-- 流程" if c.lstrip("/") in flow else ""
        print(f"  {n:>4}  {c}{mark}")

    print("\n## O6 — 最貴的 10 個 session")
    top = sorted(sessions, key=lambda s: -(s["main"]["cost"] + s["side"]["cost"]))[:10]
    print(f"{'session':<14}{'$':>8}{'turns':>7}{'side':>6}{'prompt tok':>13}{'out tok':>9}  cmds")
    for s in top:
        c = s["main"]["cost"] + s["side"]["cost"]
        p = sum(s["main"][k] + s["side"][k] for k in ("inp", "w5", "w1", "read"))
        print(
            f"{s['file'][:12]:<14}{c:>8.2f}{s['main']['turns']:>7}{s['side']['turns']:>6}"
            f"{p:>13,.0f}{s['main']['out'] + s['side']['out']:>9,.0f}  {','.join(s['commands'][:3])}"
        )

    print("\n## O7 — model / effort 分布(依 turn 數)")
    models, efforts = Counter(), Counter()
    for s in sessions:
        models.update(s["models"])
        efforts.update(s["efforts"])
    for m, n in models.most_common(8):
        print(f"  {n:>6}  {m}")
    print(f"  effort: {dict(efforts)}")

    print("\n## O8 — 每 turn 的邊際 prompt 成本(context 重送效應)")
    per = []
    for s in sessions:
        t = s["main"]["turns"]
        if t >= 5:
            p = sum(s["main"][k] for k in ("inp", "w5", "w1", "read"))
            per.append(p / t)
    if per:
        print(
            f"n={len(per)} session(turn>=5):每 turn 平均重送 "
            f"median={statistics.median(per):,.0f} tok, mean={statistics.mean(per):,.0f} tok"
        )


if __name__ == "__main__":
    main()
