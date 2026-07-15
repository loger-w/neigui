"""perf/warrant-api-load benchmark — 權證 tab 首開兩端點的冷/熱量測(入庫可重複)。

對跑中的 backend(預設 :8000)量 /api/warrants/{id} + /quotes 序列時序,
模擬前端權證 tab 首開的請求形狀,印 markdown 對照列。

用法:
    cd backend
    python scripts/bench_warrant_api.py --symbol 2330 --repeats 3

冷路徑重現(量「今日快照未 build」):
    1. 停 backend
    2. 將 data/cache/chip/warrants_snapshot_latest.json 改名移走
    3. 重啟 backend 後「立即」跑本腳本(--label cold);S3 預熱已在背景跑,
       首請求會 join 殘餘 build 時間 — 量到的就是使用者可見冷成本
熱路徑:backend 已 serve 過當日快照後再跑(--label warm)。
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import time

import httpx


async def timed(client: httpx.AsyncClient, url: str) -> tuple[float, int]:
    t0 = time.monotonic()
    resp = await client.get(url)
    return (time.monotonic() - t0) * 1000, resp.status_code


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--symbol", default="2330")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--label", default="warm")
    args = ap.parse_args()

    rows: list[tuple[float, float]] = []
    async with httpx.AsyncClient(timeout=300.0) as client:
        for i in range(args.repeats):
            # 前端 useWarrants / useWarrantQuotes 同時發射 → 並發量測
            (w_ms, w_st), (q_ms, q_st) = await asyncio.gather(
                timed(client, f"{args.base}/api/warrants/{args.symbol}"),
                timed(client, f"{args.base}/api/warrants/{args.symbol}/quotes"),
            )
            print(
                f"run {i + 1}: warrants={w_ms:.0f}ms({w_st}) "
                f"quotes={q_ms:.0f}ms({q_st}) tab_open={max(w_ms, q_ms):.0f}ms"
            )
            if w_st == 200 and q_st == 200:
                rows.append((w_ms, q_ms))
            await asyncio.sleep(11.0)  # 跨過 quotes cooldown 10s,每輪都量真實重抓

    if not rows:
        print("no successful runs")
        return
    med_w = statistics.median(r[0] for r in rows)
    med_q = statistics.median(r[1] for r in rows)
    med_tab = statistics.median(max(r) for r in rows)
    print(
        f"\n| {args.label} | {args.symbol} | warrants {med_w:.0f}ms "
        f"| quotes {med_q:.0f}ms | tab 首開 {med_tab:.0f}ms | n={len(rows)} |"
    )


asyncio.run(main())
