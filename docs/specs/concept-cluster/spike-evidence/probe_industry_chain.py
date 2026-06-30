"""Probe FinMind TaiwanStockIndustryChain dataset 看 sub_industry 怎麼切。"""
from __future__ import annotations

import asyncio
import json
from collections import Counter, defaultdict
from pathlib import Path

import httpx

ENV_FILE = Path("C:/side-project/trash-cmoney/backend/.env")


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# 我 spike 用過的 stock_id,要看它們的 sub_industry 是什麼
PROBE_STOCKS = {
    # PCB
    "3037": "欣興", "3189": "景碩", "4958": "臻鼎-KY", "8046": "南電",
    "2313": "華通", "2367": "燿華", "2355": "敬鵬", "2316": "楠梓電",
    "3044": "健鼎", "2368": "金像電", "2429": "銘旺科", "6141": "柏承",
    "3715": "定穎投控", "2455": "全新", "8021": "尖點", "3167": "大量",
    "5439": "高技", "6153": "嘉聯益", "6269": "台郡",
    # 玻纖 / CCL
    "1802": "台玻", "1815": "富喬", "1303": "南亞",
    "2383": "台光電", "6274": "台燿", "6213": "聯茂",
    # MLCC / 被動元件
    "2327": "國巨", "2492": "華新科", "2375": "凱美", "6173": "信昌電",
    "2472": "立隆電", "2478": "大毅", "3026": "禾伸堂", "6862": "三集瑞-KY",
    "3624": "光頡", "4760": "勤凱", "6449": "鈺邦", "3357": "臺慶科",
    "3236": "千如", "6155": "鈞寶", "2428": "興勤", "6284": "佳邦",
    "5328": "華容", "6432": "今展科", "8043": "蜜望實", "5228": "鈺鎧",
    "6127": "九豪", "3363": "上詮", "4989": "榮科", "6204": "艾華",
    "8163": "達方", "9905": "大華金屬", "2456": "奇力新",
}


async def main() -> None:
    env = load_env(ENV_FILE)
    token = env["FINMIND_TOKEN"]

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.finmindtrade.com/api/v4/data",
            params={"dataset": "TaiwanStockIndustryChain"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60.0,
        )
        resp.raise_for_status()
        body = resp.json()

    if body.get("status") != 200:
        print(f"ERROR: {body}")
        return

    rows = body.get("data", [])
    print(f"Total rows: {len(rows)}")
    if not rows:
        print("Empty!")
        return

    # peek schema
    print(f"\nSample rows:")
    for r in rows[:5]:
        print(f"  {r}")

    # 對 probe stocks 印出 industry / sub_industry
    print(f"\n=== PROBE STOCKS ===")
    by_stock: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        sid = str(r.get("stock_id", ""))
        if sid in PROBE_STOCKS:
            by_stock[sid].append(r)

    for sid in sorted(PROBE_STOCKS.keys()):
        name = PROBE_STOCKS[sid]
        entries = by_stock.get(sid, [])
        if not entries:
            print(f"  {sid} {name:12s}: NOT FOUND")
            continue
        # 一檔股票可能屬多個產業鏈
        pairs = sorted({(e.get("industry", ""), e.get("sub_industry", "")) for e in entries})
        for ind, sub in pairs:
            print(f"  {sid} {name:12s}: {ind} / {sub}")

    # industry distribution
    print(f"\n=== industry 分布 (top 30) ===")
    industries = Counter(r.get("industry", "") for r in rows)
    for ind, cnt in industries.most_common(30):
        print(f"  {cnt:5d}  {ind}")

    print(f"\nTotal unique industry: {len(industries)}")

    # sub_industry under selected industries (PCB / MLCC 相關)
    print(f"\n=== sub_industry under PCB-related industry ===")
    pcb_subs: Counter = Counter()
    mlcc_subs: Counter = Counter()
    for r in rows:
        ind = r.get("industry", "")
        sub = r.get("sub_industry", "")
        if "PCB" in ind or "電路板" in ind or "載板" in ind:
            pcb_subs[(ind, sub)] += 1
        if "電容" in ind or "被動" in ind or "MLCC" in ind or "電感" in ind or "電阻" in ind:
            mlcc_subs[(ind, sub)] += 1
    for (ind, sub), cnt in pcb_subs.most_common(50):
        print(f"  {cnt:3d}  {ind} / {sub}")
    print()
    print("=== sub_industry under MLCC / 被動元件-related industry ===")
    for (ind, sub), cnt in mlcc_subs.most_common(50):
        print(f"  {cnt:3d}  {ind} / {sub}")

    # save raw
    out = Path(__file__).parent / "industry_chain_probe.json"
    out.write_text(
        json.dumps(
            {
                "total_rows": len(rows),
                "sample": rows[:20],
                "probe": {sid: by_stock.get(sid, []) for sid in PROBE_STOCKS},
                "industry_counts": dict(industries.most_common()),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {out}")


if __name__ == "__main__":
    asyncio.run(main())
