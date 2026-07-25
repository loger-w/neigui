"""Harness build loop 成本實驗基建。

量測管道:`claude -p --output-format json` 對每次 headless session 回傳
  total_cost_usd / input_tokens / output_tokens / cache_creation / cache_read
  / duration_ms / num_turns

**核心指標 `prompt_tokens` = input + cache_creation + cache_read**
  —— 這是「這個 session 開場就要付的錢」,harness 的常駐成本全在裡面。
  cache_creation vs cache_read 的分配會隨快取狀態變動,但**兩者之和穩定**,
  所以一律用和,不看個別欄位(第一輪 SC-8 探針已驗證此性質)。

紀律:
  * 每個條件跑 N 次 replicate,報 median 與全距 —— 單次數字不可採信。
  * 每次實驗結束一律還原設定;runner 以 try/finally 保證,並在結尾複驗。
  * 條件之間只改**一個**變數(鐵則:一次一個假說、一次一個變數)。
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")

CLAUDE = Path(os.path.expanduser("~/.claude"))
SETTINGS = CLAUDE / "settings.json"
REPO = Path("C:/side-project/neigui")
HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results.jsonl"

# 固定探針:1 turn、輸出極短 —— 把 output token 壓到最低,讓差異全部落在 prompt 側。
PROBE_MINIMAL = "Reply with exactly the two characters: OK"


# ---------------------------------------------------------------------------
# 設定變更(全部可還原)
# ---------------------------------------------------------------------------


def _read_settings() -> dict:
    return json.loads(
        SETTINGS.read_text(encoding="utf-8"), object_pairs_hook=collections.OrderedDict
    )


def _write_settings(data: dict) -> None:
    SETTINGS.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


@contextmanager
def settings_patch(**changes):
    """暫時改 settings.json 的頂層 key,結束還原原始位元組。"""
    original = SETTINGS.read_bytes()
    try:
        data = _read_settings()
        for key, value in changes.items():
            if value is None:
                data.pop(key, None)
            elif isinstance(value, dict) and isinstance(data.get(key), dict):
                merged = dict(data[key])
                for k, v in value.items():
                    if v is None:
                        merged.pop(k, None)
                    else:
                        merged[k] = v
                data[key] = merged
            else:
                data[key] = value
        _write_settings(data)
        yield
    finally:
        SETTINGS.write_bytes(original)


@contextmanager
def files_swapped(swaps: dict[Path, str | None]):
    """暫時替換(或刪除)一批檔案,結束一律還原。value=None 代表暫時移除。"""
    backups: dict[Path, bytes | None] = {}
    try:
        for path, content in swaps.items():
            backups[path] = path.read_bytes() if path.exists() else None
            if content is None:
                if path.exists():
                    path.unlink()
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
        yield
    finally:
        for path, original in backups.items():
            if original is None:
                if path.exists():
                    path.unlink()
            else:
                path.write_bytes(original)


def git_show(sha: str, rel: str) -> str:
    out = subprocess.run(
        ["git", "-C", str(REPO), "show", f"{sha}:{rel}"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if out.returncode != 0:
        raise RuntimeError(f"git show {sha}:{rel} failed: {out.stderr[:300]}")
    return out.stdout


# ---------------------------------------------------------------------------
# 量測
# ---------------------------------------------------------------------------


def run_probe(
    prompt: str,
    model: str = "haiku",
    cwd: Path = REPO,
    timeout: int = 600,
    extra_args: list[str] | None = None,
) -> dict:
    # prompt 走 stdin:`--allowedTools <tools...>` 是**變參**旗標,prompt 當位置參數
    # 放在它後面會被一起吃掉(batch 3b 第一次全批 ERR 的根因)。
    proc = subprocess.run(
        [
            "claude",
            "-p",
            "--model",
            model,
            "--output-format",
            "json",
            *(extra_args or []),
        ],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(cwd),
        timeout=timeout,
    )
    if proc.returncode != 0:
        return {
            "error": (proc.stderr or proc.stdout)[-400:],
            "returncode": proc.returncode,
        }
    payload = json.loads(proc.stdout)
    result_text = payload.get("result") or ""
    # 權限被擋 = 工具沒真的跑 = 這次量測無效。「基準高於處置」這種物理上不可能的結果
    # 就是這樣來的(batch 3 第一次全批作廢)。一律硬失敗,不讓它混進統計。
    if payload.get("permission_denials") or "permission" in result_text.lower():
        return {"invalid": "permission_denied", "result_head": result_text[:160]}
    u = payload["usage"]
    prompt_tokens = (
        u.get("input_tokens", 0)
        + u.get("cache_creation_input_tokens", 0)
        + u.get("cache_read_input_tokens", 0)
    )
    return {
        "prompt_tokens": prompt_tokens,
        "output_tokens": u.get("output_tokens", 0),
        "cost_usd": payload.get("total_cost_usd"),
        "duration_ms": payload.get("duration_ms"),
        "num_turns": payload.get("num_turns"),
        "result_head": (payload.get("result") or "")[:120],
    }


def measure(
    exp_id: str,
    condition: str,
    hypothesis: str,
    *,
    prompt: str = PROBE_MINIMAL,
    model: str = "haiku",
    replicates: int = 3,
    cwd: Path = REPO,
    note: str = "",
    extra_args: list[str] | None = None,
) -> dict:
    runs = []
    for _ in range(replicates):
        runs.append(run_probe(prompt, model=model, cwd=cwd, extra_args=extra_args))
        time.sleep(0.5)
    ok = [r for r in runs if "error" not in r and "invalid" not in r]
    rec = {
        "exp_id": exp_id,
        "hypothesis": hypothesis,
        "condition": condition,
        "model": model,
        "replicates": replicates,
        "note": note,
        "runs": runs,
    }
    if ok:
        rec["prompt_tokens_median"] = statistics.median(r["prompt_tokens"] for r in ok)
        rec["prompt_tokens_range"] = [
            min(r["prompt_tokens"] for r in ok),
            max(r["prompt_tokens"] for r in ok),
        ]
        rec["output_tokens_median"] = statistics.median(r["output_tokens"] for r in ok)
        rec["cost_usd_median"] = statistics.median(r["cost_usd"] for r in ok)
        rec["duration_ms_median"] = statistics.median(r["duration_ms"] for r in ok)
    with RESULTS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    pt = rec.get("prompt_tokens_median", "ERR")
    rng = rec.get("prompt_tokens_range", "")
    print(
        f"  {exp_id:<6} {condition:<44} prompt={pt} {rng} out={rec.get('output_tokens_median', '')}",
        flush=True,
    )
    return rec


def load_results() -> list[dict]:
    if not RESULTS.exists():
        return []
    return [
        json.loads(ln)
        for ln in RESULTS.read_text(encoding="utf-8").splitlines()
        if ln.strip()
    ]


def verify_settings_clean() -> bool:
    """收尾複驗:settings.json 沒有被實驗殘留污染。"""
    data = _read_settings()
    so = data.get("skillOverrides", {})
    expected = {"web-design-guidelines": "off", "bencium-innovative-ux-designer": "off"}
    plugins_ok = (
        data.get("enabledPlugins", {}).get("superpowers@claude-plugins-official")
        is True
    )
    clean = so == expected and plugins_ok
    print(
        f"settings 還原檢查:skillOverrides={so} superpowers={plugins_ok} → {'OK' if clean else 'DIRTY'}"
    )
    return clean


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.verify:
        sys.exit(0 if verify_settings_clean() else 1)
    print(f"results: {RESULTS} ({len(load_results())} 筆)")
