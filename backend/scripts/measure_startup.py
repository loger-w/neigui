"""Cold-start benchmark — uvicorn spawn 到 /api/_meta/mode 首個 200 的 time-to-ready.

perf/cold-start 量測工具(Phase 1 baseline / Phase 5 對照用同一支,量測方式不變
才能 before/after 對照):

- real 模式:吃 backend/.env 的 FINMIND_TOKEN,啟動路徑真打 FinMind
  (TaiwanStockInfo,每 run 一發,配額面可忽略)。
- fake 模式:FAKE_FINMIND=1 讀 tests_e2e fixture,隔離出非網路段。

2026-07-07 baseline(lifespan 非阻塞化前):real median 1.36s / fake 0.66s;
非阻塞化後 real 應落回 fake 水位(<0.8s)— 回歸守門是
tests/test_symbols_startup.py(deterministic),本腳本供手動追數字。

Run:
    cd backend
    python scripts/measure_startup.py --mode real -n 3
    python scripts/measure_startup.py --mode fake -n 3
"""

from __future__ import annotations

import argparse
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent


def one_run(port: int, extra_env: dict[str, str], timeout: float) -> float | None:
    env = os.environ.copy()
    env.update(extra_env)
    url = f"http://127.0.0.1:{port}/api/_meta/mode"
    t0 = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", str(port)],
        cwd=BACKEND_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = t0 + timeout
        while time.perf_counter() < deadline:
            try:
                if httpx.get(url, timeout=1.0).status_code == 200:
                    return time.perf_counter() - t0
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        return None
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        time.sleep(0.3)  # 讓 port 釋放,避免下一輪 bind 撞牆


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["real", "fake"], default="real")
    p.add_argument("-n", type=int, default=3, help="runs (median over n)")
    p.add_argument("--port", type=int, default=8123)
    p.add_argument("--timeout", type=float, default=120.0)
    args = p.parse_args()

    extra = {"FAKE_FINMIND": "1"} if args.mode == "fake" else {}
    results: list[float] = []
    for i in range(args.n):
        elapsed = one_run(args.port, extra, args.timeout)
        label = f"{elapsed:.3f}s" if elapsed is not None else "TIMEOUT"
        print(f"[{args.mode}] run {i + 1}/{args.n}: {label}", file=sys.stderr)
        if elapsed is not None:
            results.append(elapsed)
    if not results:
        print(f"[{args.mode}] all runs timed out", file=sys.stderr)
        sys.exit(1)
    print(
        f"[{args.mode}] n={len(results)} min={min(results):.3f}s "
        f"median={statistics.median(results):.3f}s max={max(results):.3f}s"
    )


if __name__ == "__main__":
    main()
