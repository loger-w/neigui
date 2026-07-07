"""Pure parsers for futures-derived sentiment metrics(options-page-v2 SC-4/5).

散戶小台多空比 + 外資台指期淨未平倉。Sister to services/finmind_options.py —
this module owns data-shape logic only (zero I/O); fetch + cache + rate-limit
live on FinMindClient.

Schema verified by live probe 2026-07-07(tests/fixtures/futures/probe/ +
.claude/feat/options-page-v2/probe-futures-2026-07-07.md):
- TaiwanFuturesDaily:total OI only on ``trading_session == "position"`` rows
  (after_market rows carry open_interest == 0);``contract_date`` includes
  weekly contracts(``202607W2``)and calendar spreads(``202607/202608``).
- TaiwanFuturesInstitutionalInvestors:product-level rows(no contract_date,
  covers ALL expiries incl. weeklies)→ the total-OI denominator must include
  weekly contracts too, else retail = total − inst can go negative.
"""

from __future__ import annotations

import re

_CACHE_VERSION_FUTURES = 1

_SERIES_LEN = 20

# Single-expiry contracts incl. weeklies (202607 / 202607W2); excludes
# calendar spreads (202607/202608).
_SINGLE_CONTRACT = re.compile(r"\d{6}(W\d)?")

_INSTITUTIONS = ("外資", "自營商", "投信")


def _inst_by_date(rows_inst: list[dict]) -> dict[str, dict[str, int]]:
    """Aggregate institutional long/short OI per date (三法人合計)."""
    out: dict[str, dict[str, int]] = {}
    for r in rows_inst:
        d = r.get("date", "")
        if not d or r.get("institutional_investors") not in _INSTITUTIONS:
            continue
        try:
            long_oi = int(r.get("long_open_interest_balance_volume", 0) or 0)
            short_oi = int(r.get("short_open_interest_balance_volume", 0) or 0)
        except (TypeError, ValueError):
            continue
        bucket = out.setdefault(d, {"long": 0, "short": 0})
        bucket["long"] += long_oi
        bucket["short"] += short_oi
    return out


def parse_retail_mtx(rows_total: list[dict], rows_inst: list[dict]) -> dict:
    """散戶小台多空比(SC-4)。

    per-day:
        total_oi   = Σ open_interest over position-session single-expiry rows
        inst_long  = Σ 三法人 long OI;inst_short 同理
        retail_long  = total_oi − inst_long
        retail_short = total_oi − inst_short
        ratio        = (retail_long − retail_short) / total_oi

    日資格(design §2.1 / R5 / probe 修正結論 2)— 不合格日整筆 drop:
        - total_oi == 0(僅夜盤發布的早晨、無資料日)
        - 該日無任何法人 rows(偽中性 0 點會污染 sparkline)
        - retail_long < 0 或 retail_short < 0(聚合口徑不符偵測線,
          另記 ``retail_mtx_negative_retail``)

    Returns:
        ``{current: {retail_long, retail_short, ratio} | None,
          series: [{date, ratio}](≤20, asc), as_of_date, dropped_days,
          data_quality_warnings}``
    """
    total_by_date: dict[str, int] = {}
    for r in rows_total:
        d = r.get("date", "")
        if not d or r.get("trading_session") != "position":
            continue
        if not _SINGLE_CONTRACT.fullmatch(str(r.get("contract_date", ""))):
            continue
        try:
            oi = int(r.get("open_interest", 0) or 0)
        except (TypeError, ValueError):
            continue
        total_by_date[d] = total_by_date.get(d, 0) + oi

    inst_by_date = _inst_by_date(rows_inst)

    warnings: list[str] = []
    dropped = 0
    negative_seen = False
    daily: list[dict] = []
    for d in sorted(total_by_date.keys()):
        total_oi = total_by_date[d]
        inst = inst_by_date.get(d)
        if total_oi <= 0 or inst is None:
            dropped += 1
            continue
        retail_long = total_oi - inst["long"]
        retail_short = total_oi - inst["short"]
        if retail_long < 0 or retail_short < 0:
            dropped += 1
            negative_seen = True
            continue
        daily.append({
            "date": d,
            "retail_long": retail_long,
            "retail_short": retail_short,
            "ratio": (retail_long - retail_short) / total_oi,
        })

    if negative_seen:
        warnings.append("retail_mtx_negative_retail")
    if dropped > 0:
        warnings.append("retail_mtx_days_dropped")

    if not daily:
        return {
            "current": None, "series": [], "as_of_date": None,
            "dropped_days": dropped, "data_quality_warnings": warnings,
        }

    last = daily[-1]
    return {
        "current": {
            "retail_long": last["retail_long"],
            "retail_short": last["retail_short"],
            "ratio": last["ratio"],
        },
        "series": [
            {"date": e["date"], "ratio": e["ratio"]} for e in daily[-_SERIES_LEN:]
        ],
        "as_of_date": last["date"],
        "dropped_days": dropped,
        "data_quality_warnings": warnings,
    }


def parse_foreign_futures(rows_inst: list[dict]) -> dict:
    """外資台指期淨未平倉(SC-5)。

    外資 rows only(自營商 / 投信忽略);net = long OI − short OI。

    Returns:
        ``{current: {long_oi, short_oi, net_oi} | None,
          series: [{date, net_oi}](≤20, asc), as_of_date,
          data_quality_warnings}``
    """
    by_date: dict[str, dict[str, int]] = {}
    for r in rows_inst:
        d = r.get("date", "")
        if not d or r.get("institutional_investors") != "外資":
            continue
        try:
            long_oi = int(r.get("long_open_interest_balance_volume", 0) or 0)
            short_oi = int(r.get("short_open_interest_balance_volume", 0) or 0)
        except (TypeError, ValueError):
            continue
        bucket = by_date.setdefault(d, {"long": 0, "short": 0})
        bucket["long"] += long_oi
        bucket["short"] += short_oi

    if not by_date:
        return {
            "current": None, "series": [], "as_of_date": None,
            "data_quality_warnings": [],
        }

    dates = sorted(by_date.keys())
    last = by_date[dates[-1]]
    return {
        "current": {
            "long_oi": last["long"],
            "short_oi": last["short"],
            "net_oi": last["long"] - last["short"],
        },
        "series": [
            {"date": d, "net_oi": by_date[d]["long"] - by_date[d]["short"]}
            for d in dates[-_SERIES_LEN:]
        ],
        "as_of_date": dates[-1],
        "data_quality_warnings": [],
    }
