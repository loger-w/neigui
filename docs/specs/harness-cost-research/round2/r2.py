"""Round 2 受控實驗基建。

與 round 1 `runner.py` 的差別:round 1 只看 `prompt_tokens`(三欄之和),因為它問的是
「prompt 多大」。Round 2 的題目多半是**快取狀態**,所以 write / read 要分開留。
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

REPO = Path("C:/side-project/neigui")
HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results2.jsonl"

PROBE = "Reply with exactly the two characters: OK"


def run(
    prompt: str = PROBE,
    model: str = "haiku",
    cwd: Path = REPO,
    extra: list[str] | None = None,
    timeout: int = 900,
) -> dict:
    proc = subprocess.run(
        ["claude", "-p", "--model", model, "--output-format", "json", *(extra or [])],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(cwd),
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
    cc = u.get("cache_creation") or {}
    return {
        "inp": u.get("input_tokens", 0),
        "write": u.get("cache_creation_input_tokens", 0),
        "read": u.get("cache_read_input_tokens", 0),
        "w5": cc.get("ephemeral_5m_input_tokens", 0),
        "w1": cc.get("ephemeral_1h_input_tokens", 0),
        "out": u.get("output_tokens", 0),
        "prompt": u.get("input_tokens", 0)
        + u.get("cache_creation_input_tokens", 0)
        + u.get("cache_read_input_tokens", 0),
        "cost": p.get("total_cost_usd"),
        "turns": p.get("num_turns"),
        "ms": p.get("duration_ms"),
        "head": (p.get("result") or "")[:100],
    }


def measure(
    exp: str,
    hypothesis: str,
    condition: str,
    *,
    prompt: str = PROBE,
    model: str = "haiku",
    n: int = 2,
    cwd: Path = REPO,
    extra: list[str] | None = None,
    note: str = "",
    gap: float = 0.5,
) -> dict:
    runs = []
    for i in range(n):
        if i:
            time.sleep(gap)
        runs.append(run(prompt, model=model, cwd=cwd, extra=extra))
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
            f"w={rec['write_med']:>8,.0f} r={rec['read_med']:>8,.0f} "
            f"out={rec['out_med']:>5,.0f} ${rec['cost_med']:.4f}",
            flush=True,
        )
    else:
        print(f"  {exp:<5} {condition:<46} FAILED {runs[0]}", flush=True)
    return rec


@contextmanager
def swapped(files: dict[Path, str | None]):
    """暫時替換/刪除檔案,結束一律還原位元組。"""
    backup: dict[Path, bytes | None] = {}
    try:
        for p, content in files.items():
            backup[p] = p.read_bytes() if p.exists() else None
            if content is None:
                p.unlink(missing_ok=True)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content, encoding="utf-8")
        yield
    finally:
        for p, orig in backup.items():
            if orig is None:
                p.unlink(missing_ok=True)
            else:
                p.write_bytes(orig)


def load() -> dict[str, dict]:
    if not RESULTS.exists():
        return {}
    out: dict[str, dict] = {}
    for ln in RESULTS.read_text(encoding="utf-8").splitlines():
        if ln.strip():
            r = json.loads(ln)
            out[r["exp"]] = r
    return out
