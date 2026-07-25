"""彙整 results.jsonl → 分析表。同 exp_id 取最後一筆(重跑會覆蓋)。"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
rows = [json.loads(ln) for ln in (HERE / "results.jsonl").read_text(encoding="utf-8").splitlines() if ln.strip()]

latest: dict[str, dict] = {}
for r in rows:
    latest[r["exp_id"]] = r

valid = {k: v for k, v in latest.items() if "prompt_tokens_median" in v}
invalid = sorted(set(latest) - set(valid))

print(f"總實驗 id 數={len(latest)}  有效={len(valid)}  作廢={len(invalid)} {invalid}\n")

hdr = f"{'id':<5} {'model':<7} {'prompt':>8} {'out':>6} {'turns':>6} {'cost$':>9}  condition"
print(hdr)
print("-" * len(hdr))
for eid in sorted(valid, key=lambda x: (len(x), x)):
    r = valid[eid]
    ok = [x for x in r["runs"] if "prompt_tokens" in x]
    turns = statistics.median(x.get("num_turns") or 0 for x in ok)
    print(
        f"{eid:<5} {r['model']:<7} {r['prompt_tokens_median']:>8.0f} "
        f"{r['output_tokens_median']:>6.0f} {turns:>6.0f} "
        f"{r['cost_usd_median']:>9.4f}  {r['condition']}"
    )


def pt(eid: str) -> float:
    return valid[eid]["prompt_tokens_median"]


def cost(eid: str) -> float:
    return valid[eid]["cost_usd_median"]


print("\n=== 派生量 ===")
BYTES = {
    "E32": 11194, "E33": 4671, "E34": 3882, "E35": 3294, "E36": 3521, "E37": 3329,
    "E38": 20938, "E39": 5215, "E40": 4159, "E41": 3503, "E42": 3698, "E43": 3711,
}
base = pt("E31")
print(f"\n檔案 token 成本(扣掉 Read 基準 {base:.0f}):")
ratios = []
for eid, b in BYTES.items():
    tok = pt(eid) - base
    ratios.append(tok / b)
    print(f"  {eid} {b:>6}B → {tok:>7.0f} tok   {tok / b:.3f} tok/byte   {valid[eid]['condition']}")
print(f"  → tok/byte 中位數 {statistics.median(ratios):.3f},全距 "
      f"[{min(ratios):.3f}, {max(ratios):.3f}] — bytes 是有效代理")

after = sum(pt(e) - base for e in ["E32", "E33", "E34", "E35", "E36", "E37"])
before = sum(pt(e) - base for e in ["E38", "E39", "E40", "E41", "E42", "E43"])
print(f"\n六個 command 合計:改版前 {before:.0f} tok → 改版後 {after:.0f} tok "
      f"({(after - before) / before * 100:+.1f}%)")

p3_after, p3_before = pt("E44") - base, pt("E45") - base
print(f"走到 Phase 3 的載入:改版前 {p3_before:.0f} tok → 改版後 {p3_after:.0f} tok "
      f"({(p3_after - p3_before) / p3_before * 100:+.1f}%)")

print("\n常駐層槓桿(haiku,對照 E01={:.0f}):".format(pt("E01")))
for eid, label in [("E02", "8 支專案 skill 全關"), ("E03", "10 支個人 skill 全關"),
                   ("E04", "superpowers plugin 停用"), ("E05", "chrome-devtools 停用"),
                   ("E06", "全關"), ("E13", "專案 CLAUDE.md → 3 行"),
                   ("E14", "user CLAUDE.md → 3 行"), ("E15", "兩份 CLAUDE.md → 1 行")]:
    d = pt(eid) - pt("E01")
    print(f"  {eid} {label:<26} {d:>+8.0f} tok  ({d / pt('E01') * 100:+.1f}%)")

print("\n模型間的常駐 prompt(同一 trivial 探針):")
for eid, m in [("E46", "haiku"), ("E47", "sonnet"), ("E48", "opus")]:
    print(f"  {eid} {m:<7} {pt(eid):>8.0f} tok   ${cost(eid):.4f}")

print("\nopus coordinator 的常駐層槓桿(對照 E48={:.0f} / ${:.4f}):".format(pt("E48"), cost("E48")))
for eid, label in [("E52", "兩份 CLAUDE.md → 1 行"), ("E53", "兩個 plugin 停用"),
                   ("E55", "全關")]:
    d, dc = pt(eid) - pt("E48"), cost(eid) - cost("E48")
    print(f"  {eid} {label:<24} {d:>+8.0f} tok  {dc:>+9.4f} USD  ({dc / cost('E48') * 100:+.1f}%)")

print("\n真實 grep 任務(同一題):")
for eid, m in [("E49", "haiku"), ("E50", "sonnet"), ("E51", "opus"), ("E54", "opus/僅Grep")]:
    r = valid[eid]
    ok = [x for x in r["runs"] if "prompt_tokens" in x]
    print(f"  {eid} {m:<12} prompt={pt(eid):>8.0f} turns={statistics.median(x.get('num_turns') or 0 for x in ok):>3.0f} "
          f"cost=${cost(eid):.4f}  結果={ok[0]['result_head'][:48]!r}")
