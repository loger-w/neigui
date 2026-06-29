"""Phase 1/2 perf baseline measurement.

Hits a running backend (default :8000) with the same parallel fetch fan-out
the frontend performs on equity-overview / options-page mount. Records
per-endpoint wall-clock + finish order across N repeats and prints a
markdown summary.

Run:
    cd backend
    python scripts/perf_baseline.py --base http://127.0.0.1:8000 \
        --symbol 2330 --contract auto --repeats 3
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime

import httpx


@dataclass
class CallResult:
    name: str
    url: str
    status: int
    ms: float
    bytes_in: int
    fired_at_ms: float
    finished_at_ms: float
    error: str | None = None


async def timed_get(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    t0: float,
) -> CallResult:
    fired = (time.monotonic() - t0) * 1000
    try:
        start = time.monotonic()
        resp = await client.get(url)
        end = time.monotonic()
        body = resp.content
        return CallResult(
            name=name,
            url=url,
            status=resp.status_code,
            ms=(end - start) * 1000,
            bytes_in=len(body),
            fired_at_ms=fired,
            finished_at_ms=(end - t0) * 1000,
        )
    except Exception as exc:
        end = time.monotonic()
        return CallResult(
            name=name,
            url=url,
            status=0,
            ms=(end - t0) * 1000 - fired,
            bytes_in=0,
            fired_at_ms=fired,
            finished_at_ms=(end - t0) * 1000,
            error=type(exc).__name__ + ":" + str(exc)[:120],
        )


async def fan_out(
    client: httpx.AsyncClient,
    base: str,
    pairs: list[tuple[str, str]],
) -> tuple[float, list[CallResult]]:
    t0 = time.monotonic()
    results = await asyncio.gather(
        *[timed_get(client, name, base + path, t0) for name, path in pairs]
    )
    total = (time.monotonic() - t0) * 1000
    return total, list(results)


def equity_pairs(symbol: str, date_str: str) -> list[tuple[str, str]]:
    return [
        ("chip-summary", f"/api/chip/{symbol}?date={date_str}"),
        ("history-base", f"/api/chip/{symbol}/history/base?days=540"),
        ("history-major", f"/api/chip/{symbol}/history/major?days=540"),
        ("brokers-window", f"/api/chip/{symbol}/brokers_window?date={date_str}&days=10"),
    ]


def options_pairs(contract: str, date_str: str) -> list[tuple[str, str]]:
    return [
        ("spot", f"/api/options/spot?date={date_str}"),
        ("large-traders", f"/api/options/oi_large_traders?contract={contract}&date={date_str}"),
        ("strike-volume", f"/api/options/strike_volume?contract={contract}&date={date_str}"),
        ("max-pain", f"/api/options/max_pain?contract={contract}&date={date_str}"),
        ("oi-walls", f"/api/options/oi_walls?contract={contract}&date={date_str}"),
        ("pcr", f"/api/options/pcr?date={date_str}&scope=all_months"),
        ("institutional", f"/api/options/institutional?date={date_str}"),
    ]


async def resolve_default_contract(client: httpx.AsyncClient, base: str) -> str | None:
    """Probe oi_large_traders with the canonical monthly slot for current month."""
    today = date.today()
    candidates = [
        f"TXO{today.year}{today.month:02d}",
        f"TXO{today.year}{today.month:02d}W1",
        f"TXO{today.year}{today.month:02d}W2",
    ]
    for c in candidates:
        try:
            r = await client.get(
                base + f"/api/options/oi_large_traders?contract={c}&date={today.isoformat()}"
            )
            if r.status_code == 200:
                return c
        except Exception:
            continue
    return None


def fmt_row(r: CallResult) -> str:
    err = f" ERR={r.error}" if r.error else ""
    kb = r.bytes_in / 1024
    return (
        f"  {r.name:<16} {r.status:>4} fire={r.fired_at_ms:7.1f}ms "
        f"finish={r.finished_at_ms:7.1f}ms dur={r.ms:7.1f}ms "
        f"size={kb:6.1f}KB{err}"
    )


def summarize_runs(
    label: str,
    totals: list[float],
    per_call: dict[str, list[CallResult]],
) -> str:
    lines = [f"\n## {label}"]
    lines.append(f"total wall-clock: {statistics.mean(totals):.1f}ms (n={len(totals)})")
    if len(totals) > 1:
        lines.append(
            f"  range: {min(totals):.1f} – {max(totals):.1f}ms, stdev={statistics.stdev(totals):.1f}"
        )
    lines.append("")
    lines.append("| endpoint | mean finish | min | max | stdev | mean size |")
    lines.append("|---|---|---|---|---|---|")
    for name, results in per_call.items():
        finishes = [r.finished_at_ms for r in results if r.status == 200]
        sizes = [r.bytes_in for r in results if r.status == 200]
        if not finishes:
            statuses = ",".join(str(r.status) for r in results)
            lines.append(f"| {name} | ERR | — | — | — | status={statuses} |")
            continue
        m = statistics.mean(finishes)
        lo = min(finishes)
        hi = max(finishes)
        sd = statistics.stdev(finishes) if len(finishes) > 1 else 0
        sz = statistics.mean(sizes) / 1024
        lines.append(f"| {name} | {m:.1f}ms | {lo:.1f} | {hi:.1f} | {sd:.1f} | {sz:.1f}KB |")
    lines.append("")
    return "\n".join(lines)


def finish_order_dist(per_call: dict[str, list[CallResult]]) -> str:
    """For each run, list endpoints by finish order. Reports the order distribution."""
    if not per_call:
        return ""
    n_runs = len(next(iter(per_call.values())))
    orderings: list[tuple[str, ...]] = []
    for i in range(n_runs):
        sorted_by_finish = sorted(
            (
                (name, results[i].finished_at_ms)
                for name, results in per_call.items()
                if results[i].status == 200
            ),
            key=lambda x: x[1],
        )
        orderings.append(tuple(name for name, _ in sorted_by_finish))
    lines = ["", "finish order per run:"]
    for i, o in enumerate(orderings):
        lines.append(f"  run {i + 1}: {' → '.join(o)}")
    unique = set(orderings)
    lines.append(f"unique orderings: {len(unique)} / {n_runs} runs")
    return "\n".join(lines)


async def run_scenario(
    client: httpx.AsyncClient,
    base: str,
    label: str,
    pairs: list[tuple[str, str]],
    repeats: int,
    refresh_first: bool = False,
) -> str:
    """Run the same parallel fan-out `repeats` times and aggregate."""
    totals: list[float] = []
    per_call: dict[str, list[CallResult]] = {name: [] for name, _ in pairs}

    if refresh_first:
        print(f"  [{label}] priming with refresh=true to skip cache...", file=sys.stderr)
        refreshed = [
            (name, path + ("&" if "?" in path else "?") + "refresh=true") for name, path in pairs
        ]
        _, _ = await fan_out(client, base, refreshed)

    for i in range(repeats):
        print(f"  [{label}] run {i + 1}/{repeats}...", file=sys.stderr)
        total, results = await fan_out(client, base, pairs)
        totals.append(total)
        for r in results:
            per_call[r.name].append(r)
        for r in sorted(results, key=lambda x: x.finished_at_ms):
            print(fmt_row(r), file=sys.stderr)
        print(f"  total: {total:.1f}ms", file=sys.stderr)

    out = summarize_runs(label, totals, per_call)
    out += finish_order_dist(per_call)
    return out


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://127.0.0.1:8000")
    p.add_argument("--symbol", default="2330")
    p.add_argument("--symbol2", default="6488", help="2nd symbol for cold path test")
    p.add_argument("--contract", default="auto")
    p.add_argument("--date", default="")
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument(
        "--skip-cold", action="store_true", help="Skip refresh=true runs (don't burn FinMind)"
    )
    args = p.parse_args()

    target_date = args.date or date.today().isoformat()

    timeout = httpx.Timeout(60.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if args.contract == "auto":
            args.contract = await resolve_default_contract(client, args.base) or ""
            if not args.contract:
                print("Failed to resolve a default contract.", file=sys.stderr)
                return
            print(f"using contract: {args.contract}", file=sys.stderr)

        report = [
            f"# Perf baseline — {datetime.now().isoformat(timespec='seconds')}",
            f"base={args.base}  date={target_date}  contract={args.contract}",
            f"symbols: {args.symbol} (warm), {args.symbol2} (cold/colder)",
            f"repeats per scenario: {args.repeats}",
        ]

        report.append(
            await run_scenario(
                client,
                args.base,
                f"Equity warm — {args.symbol}",
                equity_pairs(args.symbol, target_date),
                args.repeats,
            )
        )

        report.append(
            await run_scenario(
                client,
                args.base,
                f"Equity warm — {args.symbol2}",
                equity_pairs(args.symbol2, target_date),
                args.repeats,
            )
        )

        if not args.skip_cold:
            report.append(
                await run_scenario(
                    client,
                    args.base,
                    f"Equity cold (refresh-primed) — {args.symbol}",
                    equity_pairs(args.symbol, target_date),
                    args.repeats,
                    refresh_first=True,
                )
            )

        report.append(
            await run_scenario(
                client,
                args.base,
                f"Options warm — {args.contract}",
                options_pairs(args.contract, target_date),
                args.repeats,
            )
        )

        if not args.skip_cold:
            report.append(
                await run_scenario(
                    client,
                    args.base,
                    f"Options cold (refresh-primed) — {args.contract}",
                    options_pairs(args.contract, target_date),
                    args.repeats,
                    refresh_first=True,
                )
            )

        print("\n".join(report))


if __name__ == "__main__":
    asyncio.run(main())
