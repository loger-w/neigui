"""Multi-industry probe v2 — 用 FinMind TaiwanStockIndustryChain 推 universe + 250-day corr matrix.

Target 6 個產業:
- PCB(印刷電路板)
- 被動元件
- 半導體(focus sub: 基板/IC封裝測試/晶圓代工/IC設計)
- 通信網路(focus sub: 光通訊設備/5G/網通設備)
- 電動車輛產業
- 人工智慧

輸出: scratchpad/industry_probe_v2.json — Workflow 拿來分析。
"""
from __future__ import annotations

import asyncio
import json
import math
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import httpx

ENV_FILE = Path("C:/side-project/trash-cmoney/backend/.env")
OUT_PATH = Path(__file__).parent / "industry_probe_v2.json"
CHAIN_CACHE = Path(__file__).parent / "industry_chain_full.json"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# 目標產業: (industry, sub_industry list or None for "all subs of this industry")
TARGETS: dict[str, list[tuple[str, str | None]]] = {
    "PCB": [("印刷電路板", None)],  # 全部 sub
    "Passive": [("被動元件", None)],
    "Semiconductor": [
        ("半導體", "晶圓製造"),
        ("半導體", "晶圓代工"),
        ("半導體", "IC設計"),
        ("半導體", "IC封裝測試"),
        ("半導體", "基板"),
        ("半導體", "IC通路"),
        ("半導體", "IC原料供應商"),
        ("半導體", "其他半導體設備或服務"),
    ],
    "Optical_Comm": [
        ("通信網路", "光通訊設備(如光纖電纜、光傳輸設備)"),
        ("通信網路", "通信硬體網路設備之製造、研發或銷售"),
        ("通信網路", "印刷電路板"),
        ("通信網路", "主/被動元件"),
        ("通信網路", "5G"),
    ],
    "EV": [("電動車輛產業", None)],
    "AI": [("人工智慧", None)],
}


def matches_target(target_pairs: list[tuple[str, str | None]], row: dict) -> bool:
    ind = row.get("industry", "")
    sub = row.get("sub_industry", "")
    for ti, ts in target_pairs:
        if ti != ind:
            continue
        if ts is None or ts == sub:
            return True
    return False


async def fetch_chain(client: httpx.AsyncClient, token: str) -> list[dict]:
    if CHAIN_CACHE.exists():
        print(f"  using cache {CHAIN_CACHE}", file=sys.stderr)
        return json.loads(CHAIN_CACHE.read_text(encoding="utf-8"))
    print("  fetching TaiwanStockIndustryChain...", file=sys.stderr)
    r = await client.get(
        "https://api.finmindtrade.com/api/v4/data",
        params={"dataset": "TaiwanStockIndustryChain"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60.0,
    )
    r.raise_for_status()
    body = r.json()
    rows = body.get("data", [])
    CHAIN_CACHE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"  cached {len(rows)} rows", file=sys.stderr)
    return rows


async def fetch_stock_info(client: httpx.AsyncClient, token: str) -> dict[str, str]:
    """stock_id -> stock_name."""
    r = await client.get(
        "https://api.finmindtrade.com/api/v4/data",
        params={"dataset": "TaiwanStockInfo"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60.0,
    )
    r.raise_for_status()
    body = r.json()
    rows = body.get("data", [])
    out: dict[str, str] = {}
    for r in rows:
        sid = str(r.get("stock_id", ""))
        nm = r.get("stock_name", "")
        if sid and nm and sid not in out:
            out[sid] = nm
    return out


def build_universe(
    chain: list[dict],
    targets: list[tuple[str, str | None]],
) -> tuple[set[str], dict[str, list[str]]]:
    """回傳: (stock_ids, sub_industry_group: name -> stock_ids)."""
    stock_ids: set[str] = set()
    groups: dict[str, set[str]] = defaultdict(set)
    for row in chain:
        if not matches_target(targets, row):
            continue
        sid = str(row.get("stock_id", ""))
        sub = row.get("sub_industry", "")
        if not sid:
            continue
        # filter ETF / 權證
        if sid.startswith("00") or not sid.isdigit() or len(sid) != 4:
            continue
        stock_ids.add(sid)
        groups[sub].add(sid)
    return stock_ids, {k: sorted(v) for k, v in groups.items()}


async def fetch_price(
    client: httpx.AsyncClient, token: str, sid: str, start: str, end: str
) -> list[dict]:
    r = await client.get(
        "https://api.finmindtrade.com/api/v4/data",
        params={
            "dataset": "TaiwanStockPrice",
            "data_id": sid,
            "start_date": start,
            "end_date": end,
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("status") != 200:
        return []
    return body.get("data", [])


async def fetch_all_prices(
    token: str, stock_ids: set[str], start: str, end: str
) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    sem = asyncio.Semaphore(8)

    async with httpx.AsyncClient() as client:
        async def one(sid: str) -> None:
            async with sem:
                try:
                    rows = await fetch_price(client, token, sid, start, end)
                    out[sid] = rows
                except Exception as e:
                    print(f"  {sid}: FAIL {e}", file=sys.stderr)
                    out[sid] = []

        tasks = [one(s) for s in sorted(stock_ids)]
        await asyncio.gather(*tasks)

    return out


def compute_log_returns(
    price: dict[str, list[dict]], min_rows: int = 100
) -> tuple[dict[str, list[float]], list[str]]:
    """共同 trading day 為基準。skip rows < min_rows 的股票(下市/新上市)。"""
    valid = {sid: rows for sid, rows in price.items() if len(rows) >= min_rows}
    if not valid:
        return {}, []
    sid_dates = {sid: [r["date"] for r in rows] for sid, rows in valid.items()}
    common = set(next(iter(sid_dates.values())))
    for d in sid_dates.values():
        common &= set(d)
    sorted_dates = sorted(common)
    if len(sorted_dates) < 30:
        return {}, sorted_dates

    rets: dict[str, list[float]] = {}
    target_len = len(sorted_dates)
    for sid, rows in valid.items():
        by_d: dict[str, float] = {}
        for r in rows:
            c = r.get("close")
            if c is None:
                continue
            try:
                cv = float(c)
            except (TypeError, ValueError):
                continue
            if cv <= 0:
                continue
            by_d[r["date"]] = cv
        # strict: 必須對每個 common date 有 close,否則 skip 該 stock
        if not all(d in by_d for d in sorted_dates):
            continue
        closes = [by_d[d] for d in sorted_dates]
        if len(closes) != target_len:
            continue
        rets[sid] = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    return rets, sorted_dates[1:]


def compute_corr_matrix(returns: dict[str, list[float]]) -> dict[str, dict[str, float]]:
    sids = sorted(returns.keys())
    out: dict[str, dict[str, float]] = {s: {} for s in sids}
    for i, a in enumerate(sids):
        xa = returns[a]
        ma = sum(xa) / len(xa)
        va = sum((x - ma) ** 2 for x in xa) / len(xa)
        if va <= 0:
            continue
        for j in range(i, len(sids)):
            b = sids[j]
            xb = returns[b]
            mb = sum(xb) / len(xb)
            cov = sum((xa[k] - ma) * (xb[k] - mb) for k in range(len(xa))) / len(xa)
            vb = sum((x - mb) ** 2 for x in xb) / len(xb)
            corr = cov / math.sqrt(va * vb) if vb > 0 else 0.0
            out[a][b] = round(corr, 3)
            out[b][a] = round(corr, 3)
    return out


async def main() -> None:
    env = load_env(ENV_FILE)
    token = env["FINMIND_TOKEN"]

    end = date.today()
    start = end - timedelta(days=380)  # 250 trading day ≈ 365 calendar
    print(f"Window: {start} -> {end}", file=sys.stderr)

    async with httpx.AsyncClient() as client:
        print("Phase 1: chain + info", file=sys.stderr)
        chain = await fetch_chain(client, token)
        info = await fetch_stock_info(client, token)

    output: dict = {
        "fetched_at": end.isoformat(),
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "industries": {},
    }

    all_stock_ids: set[str] = set()
    industry_universes: dict[str, dict] = {}

    print(f"\nPhase 2: build universes", file=sys.stderr)
    for ind_key, targets in TARGETS.items():
        stock_ids, sub_groups = build_universe(chain, targets)
        print(f"  {ind_key}: {len(stock_ids)} stocks, {len(sub_groups)} sub_industries", file=sys.stderr)
        industry_universes[ind_key] = {"stock_ids": sorted(stock_ids), "sub_groups": sub_groups}
        all_stock_ids |= stock_ids

    print(f"\nTotal unique stocks across all industries: {len(all_stock_ids)}", file=sys.stderr)
    print(f"\nPhase 3: fetch prices (concurrent 8)...", file=sys.stderr)
    prices = await fetch_all_prices(token, all_stock_ids, start.isoformat(), end.isoformat())
    n_ok = sum(1 for v in prices.values() if v)
    print(f"  fetched OK: {n_ok}/{len(prices)}", file=sys.stderr)

    print(f"\nPhase 4: per-industry corr matrix", file=sys.stderr)
    for ind_key, uni in industry_universes.items():
        local_prices = {sid: prices.get(sid, []) for sid in uni["stock_ids"]}
        returns, tdays = compute_log_returns(local_prices)
        corr = compute_corr_matrix(returns) if returns else {}
        # stock meta
        meta = {sid: {"name": info.get(sid, ""), "sub_industries": []} for sid in returns.keys()}
        for sub, sids in uni["sub_groups"].items():
            for sid in sids:
                if sid in meta:
                    meta[sid]["sub_industries"].append(sub)
        output["industries"][ind_key] = {
            "universe_size": len(uni["stock_ids"]),
            "valid_universe_size": len(returns),
            "trading_days": len(tdays),
            "trading_dates_range": [tdays[0], tdays[-1]] if tdays else [],
            "stocks": meta,
            "sub_groups": uni["sub_groups"],
            "correlation_matrix": corr,
        }
        print(f"  {ind_key}: {len(returns)}/{len(uni['stock_ids'])} valid, {len(tdays)} td", file=sys.stderr)

    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"\nWrote {OUT_PATH} ({size_kb:.1f} KB)", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
