"""PCB 概念股 cluster spike — 算 20 檔 union 的相關性矩陣 + hierarchical clustering."""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx

REPO_ROOT = Path("C:/side-project/trash-cmoney")
ENV_FILE = REPO_ROOT / "backend" / ".env"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# CMoney 已抓到的三組 PCB 相關 basket
NARRATIVE_1 = {  # "PCB族群再度點火,9檔逆勢上攻" — HDI/載板 + 製造向
    "2429": "銘旺科",
    "4958": "臻鼎-KY",
    "2316": "楠梓電",
    "3189": "景碩",
    "3715": "定穎投控",
    "3037": "欣興",
    "2313": "華通",
    "6141": "柏承",
    "2455": "全新",
}

NARRATIVE_2 = {  # "外資喊多PCB族群,8檔" — CCL/玻纖/材料 + 設備向
    "2368": "金像電",
    "1802": "台玻",
    "1815": "富喬",
    "6274": "台燿",
    "6213": "聯茂",
    "2383": "台光電",
    "8021": "尖點",
    "3167": "大量",
}

CONCEPT_BOARD_PARTIAL = {  # CMoney C50851 PCB 概念股板可見 8/41 檔
    "2355": "敬鵬",
    "2367": "燿華",
    "3044": "健鼎",
    # 其餘 2313 2316 2368 2429 3037 已在 NARRATIVE 中
}

USER_ADDED = {  # user 仲裁補入:ABF 三雄缺 + 玻纖布大廠缺
    "8046": "南電",
    "1303": "南亞",
}


def build_universe() -> dict[str, dict]:
    """每檔股票標出來自哪幾家資料源 (multi-source attribution)."""
    universe: dict[str, dict] = {}
    for sid, name in NARRATIVE_1.items():
        universe.setdefault(sid, {"name": name, "sources": []})["sources"].append("CMoney_N1")
    for sid, name in NARRATIVE_2.items():
        universe.setdefault(sid, {"name": name, "sources": []})["sources"].append("CMoney_N2")
    for sid, name in CONCEPT_BOARD_PARTIAL.items():
        universe.setdefault(sid, {"name": name, "sources": []})["sources"].append("CMoney_C50851")
    for sid, name in USER_ADDED.items():
        universe.setdefault(sid, {"name": name, "sources": []})["sources"].append("user_added")
    return universe


async def fetch_finmind_price(
    client: httpx.AsyncClient, token: str, stock_id: str, start: str, end: str
) -> list[dict]:
    """FinMind Sponsor tier 用 Bearer header,不要 ?token= query."""
    resp = await client.get(
        "https://api.finmindtrade.com/api/v4/data",
        params={
            "dataset": "TaiwanStockPrice",
            "data_id": stock_id,
            "start_date": start,
            "end_date": end,
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("status") != 200:
        raise RuntimeError(f"FinMind {stock_id} err: {body}")
    return body.get("data", [])


async def fetch_all(token: str, universe: dict[str, dict], start: str, end: str) -> dict:
    out: dict[str, list[dict]] = {}
    failed: list[str] = []
    sem = asyncio.Semaphore(5)  # respect rate limit
    async with httpx.AsyncClient() as client:
        async def one(sid: str) -> None:
            async with sem:
                try:
                    data = await fetch_finmind_price(client, token, sid, start, end)
                    out[sid] = data
                    print(f"  {sid} {universe[sid]['name']}: {len(data)} rows", file=sys.stderr)
                except Exception as e:
                    failed.append(sid)
                    print(f"  {sid} {universe[sid]['name']}: FAIL {e}", file=sys.stderr)

        await asyncio.gather(*(one(s) for s in universe))
    return {"price": out, "failed": failed}


def compute_log_returns(price: dict[str, list[dict]]) -> tuple[dict[str, list[float]], list[str]]:
    """以共同交易日為基準,算 log return。回傳: returns dict (sid -> list[float]), trading_dates."""
    import math

    sid_to_dates: dict[str, list[str]] = {sid: [r["date"] for r in rows] for sid, rows in price.items()}
    if not sid_to_dates:
        return {}, []
    common: set[str] = set(next(iter(sid_to_dates.values())))
    for dates in sid_to_dates.values():
        common &= set(dates)
    sorted_dates = sorted(common)
    if len(sorted_dates) < 2:
        return {}, sorted_dates

    returns: dict[str, list[float]] = {}
    for sid, rows in price.items():
        by_date = {r["date"]: float(r["close"]) for r in rows if r.get("close")}
        closes = [by_date[d] for d in sorted_dates if d in by_date]
        if len(closes) < 2:
            continue
        log_ret = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
        returns[sid] = log_ret
    return returns, sorted_dates[1:]


def compute_correlation_matrix(returns: dict[str, list[float]]) -> tuple[list[str], list[list[float]]]:
    """Pearson 相關係數,純 Python(避免裝 numpy/scipy)。"""
    import math

    sids = sorted(returns.keys())
    n = len(sids)
    matrix = [[0.0] * n for _ in range(n)]
    for i, a in enumerate(sids):
        xa = returns[a]
        ma = sum(xa) / len(xa)
        for j, b in enumerate(sids):
            xb = returns[b]
            mb = sum(xb) / len(xb)
            cov = sum((xa[k] - ma) * (xb[k] - mb) for k in range(len(xa))) / len(xa)
            va = sum((x - ma) ** 2 for x in xa) / len(xa)
            vb = sum((x - mb) ** 2 for x in xb) / len(xb)
            denom = math.sqrt(va * vb)
            matrix[i][j] = cov / denom if denom > 0 else 0.0
    return sids, matrix


def hierarchical_cluster(
    sids: list[str], corr: list[list[float]], k: int = 3, linkage: str = "average"
) -> dict[str, int]:
    """Pure-Python hierarchical clustering on (1 - corr) distance.

    linkage='single' (chain effect 嚴重) / 'average' / 'complete'.
    Spike 用;production 應該換 scipy ward + HRP distance sqrt(0.5*(1-rho))。
    """
    n = len(sids)
    clusters: list[set[int]] = [{i} for i in range(n)]
    dist = [[1.0 - corr[i][j] for j in range(n)] for i in range(n)]

    def cluster_dist(ca: set[int], cb: set[int]) -> float:
        ds = [dist[a][b] for a in ca for b in cb]
        if linkage == "single":
            return min(ds)
        if linkage == "complete":
            return max(ds)
        return sum(ds) / len(ds)  # average

    while len(clusters) > k:
        best = (1e9, -1, -1)
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                d = cluster_dist(clusters[i], clusters[j])
                if d < best[0]:
                    best = (d, i, j)
        _, i, j = best
        merged = clusters[i] | clusters[j]
        clusters = [c for idx, c in enumerate(clusters) if idx not in (i, j)] + [merged]

    assign: dict[str, int] = {}
    for cidx, members in enumerate(clusters):
        for m in members:
            assign[sids[m]] = cidx
    return assign


def threshold_groups(sids: list[str], corr: list[list[float]], thresh: float = 0.55) -> list[set[str]]:
    """Connected-component on edges with corr > thresh — more interpretable than linkage k."""
    n = len(sids)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        for j in range(i + 1, n):
            if corr[i][j] > thresh:
                union(i, j)

    groups: dict[int, set[str]] = {}
    for i, sid in enumerate(sids):
        groups.setdefault(find(i), set()).add(sid)
    return [g for g in groups.values()]


async def main() -> None:
    env = load_env(ENV_FILE)
    token = env.get("FINMIND_TOKEN")
    if not token:
        print("ERROR: FINMIND_TOKEN not in .env", file=sys.stderr)
        sys.exit(1)

    universe = build_universe()
    print(f"Universe: {len(universe)} stocks", file=sys.stderr)
    for sid, info in sorted(universe.items()):
        srcs = ",".join(info["sources"])
        print(f"  {sid} {info['name']:10s} [{srcs}]", file=sys.stderr)

    # 60 個 trading day 大約 90 個 calendar day
    end = date.today()
    start = end - timedelta(days=120)
    print(f"\nFetching FinMind {start} -> {end}...", file=sys.stderr)
    result = await fetch_all(token, universe, start.isoformat(), end.isoformat())
    print(f"\nFailed: {result['failed']}", file=sys.stderr)

    returns, trading_dates = compute_log_returns(result["price"])
    print(f"\nCommon trading days: {len(trading_dates)} ({trading_dates[0]} -> {trading_dates[-1]})",
          file=sys.stderr)

    sids, corr_matrix = compute_correlation_matrix(returns)
    print(f"\nCorrelation matrix: {len(sids)} x {len(sids)}", file=sys.stderr)

    cluster_avg_k3 = hierarchical_cluster(sids, corr_matrix, k=3, linkage="average")
    cluster_avg_k4 = hierarchical_cluster(sids, corr_matrix, k=4, linkage="average")
    cluster_avg_k5 = hierarchical_cluster(sids, corr_matrix, k=5, linkage="average")
    groups_050 = [sorted(g) for g in threshold_groups(sids, corr_matrix, thresh=0.50)]
    groups_055 = [sorted(g) for g in threshold_groups(sids, corr_matrix, thresh=0.55)]
    groups_060 = [sorted(g) for g in threshold_groups(sids, corr_matrix, thresh=0.60)]

    output = {
        "universe": universe,
        "trading_dates_count": len(trading_dates),
        "trading_dates_range": [trading_dates[0], trading_dates[-1]] if trading_dates else [],
        "failed": result["failed"],
        "correlation_matrix": {
            "stock_ids": sids,
            "matrix": [[round(v, 3) for v in row] for row in corr_matrix],
        },
        "cluster_average_linkage": {
            "k3": cluster_avg_k3,
            "k4": cluster_avg_k4,
            "k5": cluster_avg_k5,
        },
        "threshold_groups": {
            "0.50": groups_050,
            "0.55": groups_055,
            "0.60": groups_060,
        },
    }

    out_path = Path(__file__).parent / "pcb_cluster_result.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote: {out_path}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
