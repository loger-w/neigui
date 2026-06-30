"""MLCC 概念股 cluster spike — 複製 PCB spike 方法論。

L1a = 5 篇 CMoney narrative article union(全部 stock_id+股名 明列、過濾 teaser)
L1b = TWSE / domain knowledge 必有主流被動元件 / MLCC 玩家
L1c = L1b - L1a(set difference,用來驗證「法定有但 narrative 漏」)
"""
from __future__ import annotations

import asyncio
import json
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


# ============================================================
# L1a — CMoney narrative basket(5 篇 article 明列股號)
# ============================================================
ARTICLE_A = {  # "被動元件漲價效應,10檔" (4d2a9629)
    "2492": "華新科",
    "2375": "凱美",
    "3026": "禾伸堂",
    "2327": "國巨",
    "6173": "信昌電",
    "6862": "三集瑞-KY",
    "3624": "光頡",
    "4760": "勤凱",
    "6449": "鈺邦",
    "2472": "立隆電",
}

ARTICLE_B = {  # "被動元件強勢回歸,9檔" (50c73888)
    "4989": "榮科",
    "8043": "蜜望實",
    "3026": "禾伸堂",
    "3363": "上詮",
    "3357": "臺慶科",
    "6449": "鈺邦",
    "2472": "立隆電",
    "2478": "大毅",
    "6204": "艾華",
}

ARTICLE_C = {  # "AI、國巨併購等題材,10檔" (1222626d)
    "6449": "鈺邦",
    "8043": "蜜望實",
    "5328": "華容",
    "2375": "凱美",
    "3236": "千如",
    "3357": "臺慶科",
    "6432": "今展科",
    "2327": "國巨",
    "2428": "興勤",
    "6173": "信昌電",
}

ARTICLE_D = {  # "被動元件確定漲價,9檔" (98abc6da)
    "2327": "國巨",
    "2492": "華新科",
    "3236": "千如",
    "5228": "鈺鎧",
    "6127": "九豪",
    "6155": "鈞寶",
    "2478": "大毅",
    "6173": "信昌電",
    "6284": "佳邦",
}

# ARTICLE_E (71ab6bf4) — "4大被動元件全漲價,15檔" 標題 15 檔但內文只詳 4 檔(且含
# 2330 台積電 / 2317 鴻海 非被動元件),不採用避免污染 narrative 基準。


# ============================================================
# L1b — domain knowledge 必有的主流被動元件 / MLCC 玩家
# ============================================================
L1B_DOMAIN = {
    # MLCC / 被動元件三雄 + 必有 chip 元件廠
    "2327": "國巨",
    "2492": "華新科",
    "3026": "禾伸堂",
    "2375": "凱美",      # 鋁質電容(注:user 提 5317 為筆誤,正確股號 2375)
    "6173": "信昌電",
    "2472": "立隆電",
    "8163": "達方",
    # 可選 — 老牌電容
    "9905": "大華金屬",
    # 注 1:2456 奇力新已被 2327 國巨併購下市(只剩 4 rows),排除
    # 注 2:2308 台達電太大、market beta dominate,排除以避免污染 corr 結構
}


def build_universe() -> dict[str, dict]:
    """每檔股票標出來自哪幾個 source(multi-source attribution)."""
    universe: dict[str, dict] = {}

    def add(sid: str, name: str, src: str) -> None:
        info = universe.setdefault(sid, {"name": name, "sources": []})
        if src not in info["sources"]:
            info["sources"].append(src)

    for sid, name in ARTICLE_A.items():
        add(sid, name, "CMoney_A_漲價效應")
    for sid, name in ARTICLE_B.items():
        add(sid, name, "CMoney_B_強勢回歸")
    for sid, name in ARTICLE_C.items():
        add(sid, name, "CMoney_C_AI併購")
    for sid, name in ARTICLE_D.items():
        add(sid, name, "CMoney_D_確定漲價")
    for sid, name in L1B_DOMAIN.items():
        add(sid, name, "L1b_domain")

    return universe


def compute_l1_split(universe: dict[str, dict]) -> dict[str, list[str]]:
    """L1a = 出現於至少一篇 narrative。L1b = L1B_DOMAIN keys。L1c = L1b - L1a。"""
    l1a = sorted(
        sid for sid, info in universe.items()
        if any(s.startswith("CMoney_") for s in info["sources"])
    )
    l1b = sorted(L1B_DOMAIN.keys())
    l1a_set = set(l1a)
    l1c = sorted(sid for sid in l1b if sid not in l1a_set)
    return {"L1a_narrative": l1a, "L1b_domain": l1b, "L1c_setdiff": l1c}


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
    sem = asyncio.Semaphore(5)
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
    import math

    sid_to_dates: dict[str, list[str]] = {
        sid: [r["date"] for r in rows] for sid, rows in price.items()
    }
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


def compute_correlation_matrix(
    returns: dict[str, list[float]]
) -> tuple[list[str], list[list[float]]]:
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
    n = len(sids)
    clusters: list[set[int]] = [{i} for i in range(n)]
    dist = [[1.0 - corr[i][j] for j in range(n)] for i in range(n)]

    def cluster_dist(ca: set[int], cb: set[int]) -> float:
        ds = [dist[a][b] for a in ca for b in cb]
        if linkage == "single":
            return min(ds)
        if linkage == "complete":
            return max(ds)
        return sum(ds) / len(ds)

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


def threshold_groups(
    sids: list[str], corr: list[list[float]], thresh: float
) -> list[set[str]]:
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
    return list(groups.values())


def avg_pair_corr(sids_subset: list[str], sids: list[str], corr: list[list[float]]) -> float:
    """Average pairwise corr for a subset (excludes diagonal)."""
    idx = {s: i for i, s in enumerate(sids)}
    members = [s for s in sids_subset if s in idx]
    vals = []
    for i in range(len(members)):
        for j in range(i + 1, len(members)):
            vals.append(corr[idx[members[i]]][idx[members[j]]])
    return sum(vals) / len(vals) if vals else 0.0


def avg_cross_corr(
    set_a: list[str], set_b: list[str], sids: list[str], corr: list[list[float]]
) -> float:
    """Cross corr between two disjoint sets (only counts a,b pairs where a in A, b in B, a != b)."""
    idx = {s: i for i, s in enumerate(sids)}
    a_in = [s for s in set_a if s in idx]
    b_in = [s for s in set_b if s in idx]
    vals = []
    for a in a_in:
        for b in b_in:
            if a == b:
                continue
            vals.append(corr[idx[a]][idx[b]])
    return sum(vals) / len(vals) if vals else 0.0


def strong_pairs(
    sids: list[str], corr: list[list[float]], thresh: float = 0.65
) -> list[tuple[float, str, str]]:
    pairs = []
    for i in range(len(sids)):
        for j in range(i + 1, len(sids)):
            if corr[i][j] >= thresh:
                pairs.append((corr[i][j], sids[i], sids[j]))
    pairs.sort(reverse=True)
    return pairs


def avg_corr_per_sid(
    sids: list[str], corr: list[list[float]]
) -> list[tuple[str, float]]:
    out = []
    n = len(sids)
    for i in range(n):
        vals = [corr[i][j] for j in range(n) if j != i]
        out.append((sids[i], sum(vals) / len(vals)))
    out.sort(key=lambda x: x[1])
    return out


def top_corr_partners(
    sids: list[str], corr: list[list[float]], target_sid: str, top: int = 5
) -> list[tuple[str, float]]:
    if target_sid not in sids:
        return []
    i = sids.index(target_sid)
    partners = sorted(
        ((sids[j], corr[i][j]) for j in range(len(sids)) if j != i),
        key=lambda x: x[1],
        reverse=True,
    )
    return partners[:top]


async def main() -> None:
    env = load_env(ENV_FILE)
    token = env.get("FINMIND_TOKEN")
    if not token:
        print("ERROR: FINMIND_TOKEN not in .env", file=sys.stderr)
        sys.exit(1)

    universe = build_universe()
    split = compute_l1_split(universe)
    print(f"Universe: {len(universe)} stocks", file=sys.stderr)
    print(f"  L1a narrative: {len(split['L1a_narrative'])}", file=sys.stderr)
    print(f"  L1b domain:    {len(split['L1b_domain'])}", file=sys.stderr)
    print(f"  L1c setdiff:   {len(split['L1c_setdiff'])} -> {split['L1c_setdiff']}",
          file=sys.stderr)

    # 90 trading day ~ 130 calendar day
    end = date.today()
    start = end - timedelta(days=130)
    print(f"\nFetching FinMind {start} -> {end}...", file=sys.stderr)
    result = await fetch_all(token, universe, start.isoformat(), end.isoformat())
    print(f"\nFailed: {result['failed']}", file=sys.stderr)

    returns, trading_dates = compute_log_returns(result["price"])
    print(
        f"\nCommon trading days: {len(trading_dates)} "
        f"({trading_dates[0]} -> {trading_dates[-1]})",
        file=sys.stderr,
    )

    sids, corr_matrix = compute_correlation_matrix(returns)
    print(f"\nCorrelation matrix: {len(sids)} x {len(sids)}", file=sys.stderr)

    # ---------- 各篇 narrative basket inner / cross ----------
    article_baskets = {
        "ARTICLE_A": list(ARTICLE_A.keys()),
        "ARTICLE_B": list(ARTICLE_B.keys()),
        "ARTICLE_C": list(ARTICLE_C.keys()),
        "ARTICLE_D": list(ARTICLE_D.keys()),
    }
    inner_corr = {
        name: round(avg_pair_corr(members, sids, corr_matrix), 4)
        for name, members in article_baskets.items()
    }
    cross_pairs = {}
    a_names = list(article_baskets.keys())
    for i in range(len(a_names)):
        for j in range(i + 1, len(a_names)):
            key = f"{a_names[i]} x {a_names[j]}"
            cross_pairs[key] = round(
                avg_cross_corr(
                    article_baskets[a_names[i]], article_baskets[a_names[j]],
                    sids, corr_matrix,
                ),
                4,
            )

    # narrative union inner vs L1c-internal vs narrative x L1c
    narrative_union = split["L1a_narrative"]
    l1c = split["L1c_setdiff"]
    narrative_inner_all = round(avg_pair_corr(narrative_union, sids, corr_matrix), 4)
    l1c_inner = round(avg_pair_corr(l1c, sids, corr_matrix), 4) if len(l1c) >= 2 else None
    narrative_x_l1c = (
        round(avg_cross_corr(narrative_union, l1c, sids, corr_matrix), 4)
        if l1c
        else None
    )

    # ---------- L1c 個別檔對 narrative basket 的相關性概況 ----------
    l1c_audit = {}
    for sid in l1c:
        if sid not in sids:
            continue
        partners = top_corr_partners(sids, corr_matrix, sid, top=8)
        avg_all = sum(corr_matrix[sids.index(sid)]) / (len(sids) - 1) \
            if len(sids) > 1 else 0.0
        l1c_audit[sid] = {
            "name": universe[sid]["name"],
            "avg_corr_vs_union": round(avg_all - 1.0 / (len(sids) - 1), 4),
            "top_partners": [(s, round(v, 4)) for s, v in partners],
        }

    # ---------- 強 pair (>0.65) ----------
    pairs_065 = [(round(c, 4), a, b) for c, a, b in strong_pairs(sids, corr_matrix, 0.65)]
    pairs_055 = [(round(c, 4), a, b) for c, a, b in strong_pairs(sids, corr_matrix, 0.55)]

    # ---------- avg corr per sid (找 outlier) ----------
    avg_corr_list = [(s, round(v, 4)) for s, v in avg_corr_per_sid(sids, corr_matrix)]

    output = {
        "universe": universe,
        "l1_split": split,
        "trading_dates_count": len(trading_dates),
        "trading_dates_range": (
            [trading_dates[0], trading_dates[-1]] if trading_dates else []
        ),
        "failed": result["failed"],
        "correlation_matrix": {
            "stock_ids": sids,
            "matrix": [[round(v, 3) for v in row] for row in corr_matrix],
        },
        "narrative_basket_inner_corr": inner_corr,
        "narrative_basket_cross_corr": cross_pairs,
        "narrative_union_inner_corr": narrative_inner_all,
        "l1c_inner_corr": l1c_inner,
        "narrative_x_l1c_cross_corr": narrative_x_l1c,
        "l1c_audit": l1c_audit,
        "strong_pairs_065": pairs_065,
        "strong_pairs_055": pairs_055,
        "avg_corr_per_sid_ascending": avg_corr_list,
        "cluster_average_linkage": {
            "k3": hierarchical_cluster(sids, corr_matrix, k=3),
            "k4": hierarchical_cluster(sids, corr_matrix, k=4),
            "k5": hierarchical_cluster(sids, corr_matrix, k=5),
            "k6": hierarchical_cluster(sids, corr_matrix, k=6),
        },
        "threshold_groups": {
            "0.50": [sorted(g) for g in threshold_groups(sids, corr_matrix, 0.50)],
            "0.55": [sorted(g) for g in threshold_groups(sids, corr_matrix, 0.55)],
            "0.60": [sorted(g) for g in threshold_groups(sids, corr_matrix, 0.60)],
            "0.65": [sorted(g) for g in threshold_groups(sids, corr_matrix, 0.65)],
        },
    }

    out_path = Path(__file__).parent / "mlcc_cluster_result.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote: {out_path}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
