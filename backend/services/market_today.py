"""market-today-only — 純函式計算層:index_strength / cap_tiers / sector_rotation
/ sector_members.

Spec: .claude/mod/market-today-only/change-spec.md §1(SC-1〜SC-3)/ §4 Backend B。

單位契約(R7,spec §1):所有 `*_change_rate` 欄位 = 百分比數值(-2.11 表示
-2.11%);貢獻公式內 `chg_i` = `change_rate / 100`。

零 IO — 所有輸入(universe rows / index_rows / mv_map / type_map / chain /
name_map)由 caller(services/finmind_realtime.py)組好傳入,方便手算 fixture
單元測試(不需 mock FinMind)。
"""

from __future__ import annotations

import math
import statistics

_MARKET_INDEX_KEYS = {"twse": "001", "tpex": "101"}
_TSMC_STOCK_ID = "2330"
_CONTRIB_TOP_N = 5
_CAP_TIER_BOUNDS = (50, 150)  # top50: [0:50), mid100: [50:150), rest: [150:)


# ---------------------------------------------------------------------------
# SC-1 — 大盤強弱卡(index strength + 貢獻 top5 + 台積電)
# ---------------------------------------------------------------------------


def _index_to_universe_map(universe_rows: list[dict]) -> dict[str, dict]:
    return {r["stock_id"]: r for r in universe_rows if r.get("stock_id")}


def _market_contrib_entries(
    market: str,
    universe_by_id: dict[str, dict],
    mv_map: dict[str, int],
    type_map: dict[str, str],
    name_map: dict[str, str],
    prev_close: float | None,
) -> dict[str, dict]:
    """該市場 eligible 股(type 符合 + mv 有 + change_rate 非 null)的
    `{stock_id: {stock_id, name, change_rate, contrib_points}}`。

    prev_close 為 None(index row 缺 change_price 之類的異常情況)→ 回空 dict,
    不嘗試除法。
    """
    if prev_close is None:
        return {}

    raw: list[tuple[str, float, float]] = []
    total_mv = 0.0
    for sid, row in universe_by_id.items():
        if type_map.get(sid) != market:
            continue
        mv = mv_map.get(sid)
        chg = row.get("change_rate")
        if mv is None or chg is None:
            continue
        raw.append((sid, chg, mv))
        total_mv += mv

    if not raw or not total_mv:
        return {}

    out: dict[str, dict] = {}
    for sid, chg, mv in raw:
        contrib_points = prev_close * (mv * (chg / 100)) / total_mv
        out[sid] = {
            "stock_id": sid,
            "name": name_map.get(sid) or sid,
            "change_rate": chg,
            "contrib_points": contrib_points,
        }
    return out


def compute_index_strength(
    index_rows: dict[str, dict],
    universe_rows: list[dict],
    mv_map: dict[str, int],
    type_map: dict[str, str],
    name_map: dict[str, str],
) -> dict:
    """SC-1:加權/櫃買強弱 + 拉盤結構(spread)+ 貢獻 top5 + 台積電貢獻。

    R5/R12:001 或 101 index row 缺席 → 該側(含該側 contrib)整組 None。
    """
    universe_by_id = _index_to_universe_map(universe_rows)

    sides: dict[str, dict | None] = {}
    contrib_entries: dict[str, dict[str, dict]] = {}

    for market, index_key in _MARKET_INDEX_KEYS.items():
        index_row = index_rows.get(index_key)
        if index_row is None:
            sides[market] = None
            continue

        close = index_row.get("close")
        change_price = index_row.get("change_price")
        change_rate = index_row.get("change_rate")

        market_changes = [
            row.get("change_rate")
            for sid, row in universe_by_id.items()
            if type_map.get(sid) == market and row.get("change_rate") is not None
        ]
        if market_changes and change_rate is not None:
            median_change_rate = statistics.median(market_changes)
            spread = change_rate - median_change_rate
        else:
            median_change_rate = None
            spread = None

        sides[market] = {
            "close": close,
            "change_rate": change_rate,
            "median_change_rate": median_change_rate,
            "spread": spread,
        }

        prev_close = (
            close - change_price if close is not None and change_price is not None else None
        )
        contrib_entries[market] = _market_contrib_entries(
            market, universe_by_id, mv_map, type_map, name_map, prev_close
        )

    contrib_out: dict[str, dict | None] = {}
    for market in _MARKET_INDEX_KEYS:
        if sides[market] is None:
            contrib_out[market] = None
            continue
        # SC-5(review P2#1):mv_map 整包缺席 = mv 來源降級,contrib 該側 null
        # (前端顯示「資料暫缺」);mv 有料但該市場無 eligible 才是合法空清單。
        if not mv_map:
            contrib_out[market] = None
            continue
        entries = list(contrib_entries.get(market, {}).values())
        up = sorted(
            (e for e in entries if e["contrib_points"] > 0),
            key=lambda e: e["contrib_points"],
            reverse=True,
        )[:_CONTRIB_TOP_N]
        down = sorted(
            (e for e in entries if e["contrib_points"] < 0),
            key=lambda e: e["contrib_points"],
        )[:_CONTRIB_TOP_N]
        contrib_out[market] = {"up": up, "down": down}

    tsmc_row = universe_by_id.get(_TSMC_STOCK_ID)
    tsmc_change_rate = tsmc_row.get("change_rate") if tsmc_row else None
    twse_eligible = contrib_entries.get("twse", {})
    tsmc_contrib_points = (
        twse_eligible[_TSMC_STOCK_ID]["contrib_points"] if _TSMC_STOCK_ID in twse_eligible else None
    )

    # MK-1(mod/batch-ui-update):扣除台積電後的加權漲跌 — ex 點數 = 指數漲跌
    # 點數(change_price)− 2330 貢獻點數;ex 漲跌率以 prev_close 為分母。
    # 任一輸入缺(index row / change_price / tsmc 貢獻)→ 兩欄 null。
    ex_tsmc: dict = {"change_points": None, "change_rate": None}
    twse_index_row = index_rows.get(_MARKET_INDEX_KEYS["twse"])
    if twse_index_row is not None and tsmc_contrib_points is not None:
        idx_close = twse_index_row.get("close")
        idx_change_price = twse_index_row.get("change_price")
        if idx_close is not None and idx_change_price is not None:
            prev_index = idx_close - idx_change_price
            ex_points = idx_change_price - tsmc_contrib_points
            ex_tsmc = {
                "change_points": ex_points,
                "change_rate": (ex_points / prev_index * 100) if prev_index else None,
            }

    return {
        "twse": sides["twse"],
        "tpex": sides["tpex"],
        "tsmc": {"change_rate": tsmc_change_rate, "contrib_points": tsmc_contrib_points},
        "ex_tsmc": ex_tsmc,
        "contrib": contrib_out,
    }


# ---------------------------------------------------------------------------
# SC-2 — 權值 vs 中小分層
# ---------------------------------------------------------------------------


def compute_cap_tiers(universe_rows: list[dict], mv_map: dict[str, int]) -> list[dict] | None:
    """R8:mv 缺 或 change_rate null 的股剔除(不入任何桶、不計 members)。

    前 50 / 51-150 / 其餘三桶;桶內若無成員略過(避免除以零 — spec 未明文,
    決定見 change-spec 執行報告)。eligible 全空 → None。
    """
    eligible = [
        r for r in universe_rows if r.get("stock_id") in mv_map and r.get("change_rate") is not None
    ]
    if not eligible:
        return None

    eligible.sort(key=lambda r: mv_map[r["stock_id"]], reverse=True)
    top_n, mid_n = _CAP_TIER_BOUNDS
    buckets = [
        ("top50", eligible[:top_n]),
        ("mid100", eligible[top_n:mid_n]),
        ("rest", eligible[mid_n:]),
    ]

    tiers: list[dict] = []
    for tier_name, rows in buckets:
        if not rows:
            continue
        changes = [r["change_rate"] for r in rows]
        up_count = sum(1 for c in changes if c > 0)
        tiers.append(
            {
                "tier": tier_name,
                "members": len(rows),
                "avg_change_rate": sum(changes) / len(changes),
                "up_ratio": up_count / len(changes),
            }
        )
    return tiers


# ---------------------------------------------------------------------------
# SC-3 — 族群輪動三層(industry / sub_industry / members)
# ---------------------------------------------------------------------------


def _dedup_ids(stock_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for sid in stock_ids:
        if sid in seen:
            continue
        seen.add(sid)
        out.append(sid)
    return out


def _group_stats(stock_ids: list[str], universe_by_id: dict[str, dict]) -> dict | None:
    """R8:vol_ratio 分子分母同步剔除(缺任一欄的股整檔排除於 Σ 之外);
    剔除後分母為 0 → vol_ratio None。members = change_rate 非 null 的成員數。
    成員 0 → 回 None(caller 略過此群組)。
    """
    member_rows = []
    for sid in _dedup_ids(stock_ids):
        row = universe_by_id.get(sid)
        if row is None or row.get("change_rate") is None:
            continue
        member_rows.append(row)

    if not member_rows:
        return None

    avg_change_rate = sum(r["change_rate"] for r in member_rows) / len(member_rows)

    vol_num = 0.0
    vol_den = 0.0
    for r in member_rows:
        tv = r.get("total_volume")
        yv = r.get("yesterday_volume")
        if tv is None or yv is None:
            continue
        vol_num += tv
        vol_den += yv
    vol_ratio = (vol_num / vol_den) if vol_den else None

    return {
        "members": len(member_rows),
        "avg_change_rate": avg_change_rate,
        "vol_ratio": vol_ratio,
    }


def compute_sector_rotation(
    universe_rows: list[dict],
    chain_map: dict[str, dict[str, list[str]]] | None,
) -> dict | None:
    """SC-3 主列表 + 展開子產業。chain_map None/空 → None。

    industry 層 = 該產業所有 sub 的 stock_id 聯集去重(同產業內一票);
    sub 層各自獨立(跨產業/跨子產業重複允許)。成員 0 的群組略過。
    industries 與 subs 均按 avg_change_rate desc 排序。
    """
    if not chain_map:
        return None

    universe_by_id = _index_to_universe_map(universe_rows)
    industries: list[dict] = []

    for industry_name, sub_map in chain_map.items():
        union_ids: list[str] = []
        for sub_ids in sub_map.values():
            union_ids.extend(sub_ids)
        industry_stats = _group_stats(union_ids, universe_by_id)
        if industry_stats is None:
            continue

        subs: list[dict] = []
        for sub_name, sub_ids in sub_map.items():
            sub_stats = _group_stats(sub_ids, universe_by_id)
            if sub_stats is None:
                continue
            subs.append({"name": sub_name, **sub_stats})
        subs.sort(key=lambda s: s["avg_change_rate"], reverse=True)

        industries.append({"name": industry_name, **industry_stats, "subs": subs})

    industries.sort(key=lambda i: i["avg_change_rate"], reverse=True)
    return {"industries": industries}


# ---------------------------------------------------------------------------
# MK-5/7(mod/batch-ui-update)— compute_breadth:漲跌家數 + 全量 rows
# ---------------------------------------------------------------------------

_LIMIT_RATE = 0.10  # 普通股漲跌幅限制;ETF/處置股例外由 universe filter 先剔除


def _tick_size(price: float) -> float:
    """台股普通股檔位(TWSE 升降單位):價位區間 → tick。"""
    if price < 10:
        return 0.01
    if price < 50:
        return 0.05
    if price < 100:
        return 0.1
    if price < 500:
        return 0.5
    if price < 1000:
        return 1.0
    return 5.0


def _limit_price(prev_close: float, direction: int) -> float:
    """漲停(direction=+1)/ 跌停(−1)價:prev_close×(1±10%) 後向 prev_close
    方向取合法 tick(漲停向下取、跌停向上取);1e-9 epsilon 吸收浮點誤差。"""
    raw = prev_close * (1 + direction * _LIMIT_RATE)
    tick = _tick_size(raw)
    if direction > 0:
        steps = math.floor(raw / tick + 1e-9)
    else:
        steps = math.ceil(raw / tick - 1e-9)
    return steps * tick


def compute_breadth(
    universe_rows: list[dict],
    type_map: dict[str, str],
    name_map: dict[str, str],
) -> dict | None:
    """MK-5/7:上市/上櫃 漲停/上漲/平盤/下跌/跌停 家數 + 全量 rows(前端門檻
    /排序自理)。桶互斥(漲停不重複計入上漲)。

    漲停判定(R4):prev_close = close − change_price(tick snapshot 精確欄位,
    不用 change_rate 反推),與 tick 級容差(半個 tick)比較;prev/close 缺 →
    不判 limit,只按 change_rate 正負分桶。change_rate null 整檔跳過;type_map
    查無市場的股(index/未收錄)排除。全空 → None。
    """
    counts: dict[str, dict[str, int]] = {
        m: {"limit_up": 0, "up": 0, "flat": 0, "down": 0, "limit_down": 0} for m in ("twse", "tpex")
    }
    rows_out: list[dict] = []

    for r in universe_rows:
        sid = r.get("stock_id")
        market = type_map.get(sid or "")
        chg = r.get("change_rate")
        if not sid or market not in counts or chg is None:
            continue

        close = r.get("close")
        change_price = r.get("change_price")
        prev_close = (
            close - change_price if close is not None and change_price is not None else None
        )
        limit_up = False
        limit_down = False
        if prev_close is not None and prev_close > 0 and close is not None:
            up_price = _limit_price(prev_close, 1)
            down_price = _limit_price(prev_close, -1)
            limit_up = abs(close - up_price) < _tick_size(up_price) / 2
            limit_down = abs(close - down_price) < _tick_size(down_price) / 2

        if limit_up:
            bucket = "limit_up"
        elif limit_down:
            bucket = "limit_down"
        elif chg > 0:
            bucket = "up"
        elif chg < 0:
            bucket = "down"
        else:
            bucket = "flat"
        counts[market][bucket] += 1

        tv = r.get("total_volume")
        yv = r.get("yesterday_volume")
        vol_ratio = (tv / yv) if (tv is not None and yv) else None
        rows_out.append(
            {
                "stock_id": sid,
                "name": name_map.get(sid) or sid,
                "market": market,
                "change_rate": chg,
                "volume_ratio": vol_ratio,
                "total_amount": r.get("total_amount"),
                "limit_up": limit_up,
                "limit_down": limit_down,
            }
        )

    if not rows_out:
        return None
    return {"twse": counts["twse"], "tpex": counts["tpex"], "rows": rows_out}


# ---------------------------------------------------------------------------
# SC-3 — 成員股 drill-down(routes/market.py `/sector_members` 用)
# ---------------------------------------------------------------------------


def compute_sector_members(
    universe_rows: list[dict],
    chain_map: dict[str, dict[str, list[str]]] | None,
    name_map: dict[str, str],
    industry: str,
    sub_industry: str | None = None,
) -> dict | None:
    """未知 industry / sub_industry → None(caller 轉 404)。

    sub_industry 為 None → 該產業所有 sub 聯集去重;成員 entry 含 vol_ratio /
    total_amount,change_rate desc 排(null 最後)。
    """
    if not chain_map or industry not in chain_map:
        return None

    sub_map = chain_map[industry]
    if sub_industry is not None:
        if sub_industry not in sub_map:
            return None
        stock_ids = sub_map[sub_industry]
    else:
        stock_ids = []
        for ids in sub_map.values():
            stock_ids.extend(ids)

    universe_by_id = _index_to_universe_map(universe_rows)
    members: list[dict] = []
    for sid in _dedup_ids(stock_ids):
        row = universe_by_id.get(sid)
        if row is None:
            continue
        tv = row.get("total_volume")
        yv = row.get("yesterday_volume")
        vol_ratio = (tv / yv) if (tv is not None and yv) else None
        members.append(
            {
                "stock_id": sid,
                "name": name_map.get(sid) or sid,
                "change_rate": row.get("change_rate"),
                "vol_ratio": vol_ratio,
                "total_amount": row.get("total_amount"),
            }
        )

    members.sort(key=lambda m: (m["change_rate"] is None, -(m["change_rate"] or 0)))
    return {"industry": industry, "sub_industry": sub_industry, "members": members}
