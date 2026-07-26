"""Round 3(1b)量測基建 — 薄包裝,沿用 round 2 的 `r2.measure`。

與 round 2 的兩點差別:
1. 結果落在 `results3.jsonl`(不污染 round 2 的語料)。
2. 新增 `measure_full`:spec / review 這類題目要留**完整輸出**供人讀,
   r2 的 `head[:100]` 不夠。
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "round2"))

import r2  # noqa: E402

r2.RESULTS = HERE / "results3.jsonl"

REPO = r2.REPO
RESULTS = r2.RESULTS
OUTDIR = HERE / "outputs"
measure = r2.measure
run = r2.run
swapped = r2.swapped
load = r2.load


def run_full(
    prompt: str, model: str, extra: list[str] | None = None, timeout: int = 1800
) -> dict:
    """同 r2.run,但保留完整 result 文字(寫進 outputs/,不塞進 jsonl)。"""
    import subprocess

    proc = subprocess.run(
        ["claude", "-p", "--model", model, "--output-format", "json", *(extra or [])],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(REPO),
        timeout=timeout,
    )
    if proc.returncode != 0:
        return {"error": (proc.stderr or proc.stdout)[-300:]}
    try:
        p = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": proc.stdout[-300:]}
    if p.get("permission_denials"):
        return {"invalid": "permission_denied"}
    u = p["usage"]
    return {
        "prompt": u.get("input_tokens", 0)
        + u.get("cache_creation_input_tokens", 0)
        + u.get("cache_read_input_tokens", 0),
        "write": u.get("cache_creation_input_tokens", 0),
        "read": u.get("cache_read_input_tokens", 0),
        "out": u.get("output_tokens", 0),
        "cost": p.get("total_cost_usd"),
        "turns": p.get("num_turns"),
        "ms": p.get("duration_ms"),
        "text": p.get("result") or "",
    }


def measure_full(
    exp: str,
    hypothesis: str,
    condition: str,
    *,
    prompt: str,
    model: str,
    n: int = 2,
    extra: list[str] | None = None,
    note: str = "",
) -> dict:
    OUTDIR.mkdir(parents=True, exist_ok=True)
    runs = []
    for i in range(n):
        if i:
            time.sleep(0.5)
        r = run_full(prompt, model=model, extra=extra)
        if "text" in r:
            path = OUTDIR / f"{exp}_{i}.md"
            path.write_text(r.pop("text"), encoding="utf-8")
            r["out_file"] = path.name
        runs.append(r)
    ok = [r for r in runs if "error" not in r and "invalid" not in r]
    rec = {
        "exp": exp,
        "hypothesis": hypothesis,
        "condition": condition,
        "model": model,
        "n": n,
        "note": note,
        "runs": runs,
    }
    for k in ("prompt", "write", "read", "out", "cost", "turns"):
        if ok:
            rec[f"{k}_med"] = statistics.median(r[k] for r in ok)
    with RESULTS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    if ok:
        print(
            f"  {exp:<5} {condition:<46} prompt={rec['prompt_med']:>8,.0f} "
            f"out={rec['out_med']:>6,.0f} ${rec['cost_med']:.4f}",
            flush=True,
        )
    else:
        print(f"  {exp:<5} {condition:<46} FAILED {runs[0]}", flush=True)
    return rec
