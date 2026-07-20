"""perf/options-market-load benchmark — options 頁 9 支端點並發載入量測(入庫可重複)。

模擬 OptionsPage 首開的真實請求形狀:9 支 endpoint 同時打進跑中的 backend
(預設 :8000),量每支耗時 + 總 wall time,印 markdown 對照列。

用法:
    cd backend
    python scripts/bench_options_page.py --contract TXO202607W4 --label warm

stale 再訪重現(量「盤中 30 分 TTL 過期後再開頁」— 本 perf 的 baseline 情境):
    python scripts/bench_options_page.py --contract TXO202607W4 --stale --label stale
    (--stale 會先把今天相關 result cache 的 fetched_at 倒填 1 小時,
     使 max_pain / oi_walls / pcr / spot 等走重算路徑;僅動 fetched_at,
     不刪檔、不 bump 版本。)

market 對照(驗證 event-loop starvation 是否連坐 /api/market/snapshot):
    加 --with-market 會在 9 支 options 並發的同時打一支 snapshot。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx

_STALE_PATTERNS = (
    "max_pain_",
    "oi_walls_",
    "pcr_",
    "_strike_vol",
    "_oi_lt",
    "_spot",
    "oi_lt_day_",
    "txo_slim_",
    "txo_daily_",
)


def backdate_today_caches(cache_dir: Path, today_iso: str) -> int:
    """把今天 fetched_at 的 option 相關 cache 倒填 1 小時,重現 stale 再訪。"""
    n = 0
    for p in cache_dir.iterdir():
        if not any(pat in p.name for pat in _STALE_PATTERNS):
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        fa = data.get("fetched_at", "")
        if not fa.startswith(today_iso):
            continue
        data["fetched_at"] = (datetime.fromisoformat(fa) - timedelta(hours=1)).isoformat(
            timespec="seconds"
        )
        p.write_text(json.dumps(data), encoding="utf-8")
        n += 1
    return n


async def timed(client: httpx.AsyncClient, name: str, url: str) -> tuple[str, float, int]:
    t0 = time.monotonic()
    resp = await client.get(url)
    return name, (time.monotonic() - t0) * 1000, resp.status_code


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--contract", default="TXO202607W4")
    ap.add_argument("--label", default="warm")
    ap.add_argument("--stale", action="store_true")
    ap.add_argument("--with-market", action="store_true")
    ap.add_argument(
        "--cache-dir",
        default=str(Path(__file__).resolve().parents[1] / "data" / "cache" / "chip"),
    )
    args = ap.parse_args()

    if args.stale:
        today_iso = datetime.now().strftime("%Y-%m-%d")
        n = backdate_today_caches(Path(args.cache_dir), today_iso)
        print(f"backdated {n} cache files (fetched_at -1h)")

    c = args.contract
    endpoints = [
        ("spot", "/api/options/spot"),
        ("oi_large_traders", f"/api/options/oi_large_traders?contract={c}"),
        ("strike_volume", f"/api/options/strike_volume?contract={c}"),
        ("max_pain", f"/api/options/max_pain?contract={c}"),
        ("oi_walls", f"/api/options/oi_walls?contract={c}"),
        ("pcr", "/api/options/pcr"),
        ("retail_mtx", "/api/options/retail_mtx"),
        ("foreign_futures", "/api/options/foreign_futures"),
        ("institutional", "/api/options/institutional"),
    ]
    if args.with_market:
        endpoints.append(("market_snapshot", "/api/market/snapshot"))

    async with httpx.AsyncClient(base_url=args.base, timeout=300.0) as client:
        t0 = time.monotonic()
        rows = await asyncio.gather(*[timed(client, name, url) for name, url in endpoints])
        wall = (time.monotonic() - t0) * 1000

    print(f"\n| endpoint | {args.label} ms | status |")
    print("|---|---|---|")
    for name, ms, status in sorted(rows, key=lambda r: -r[1]):
        print(f"| {name} | {ms:.0f} | {status} |")
    print(f"| **TOTAL WALL** | **{wall:.0f}** | |")


if __name__ == "__main__":
    asyncio.run(main())
