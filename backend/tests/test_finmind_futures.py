"""Tests for services/finmind_futures.py — 散戶小台多空比 + 外資期貨淨 OI parsers.

Schema per live probe 2026-07-07(tests/fixtures/futures/probe/):
- TaiwanFuturesDaily:total OI 只在 trading_session=="position" rows;
  contract_date 含週合約(202607W2);價差 rows 形如 "202607/202608"。
- TaiwanFuturesInstitutionalInvestors:商品層級(無 contract_date),
  institutional_investors ∈ {外資, 自營商, 投信},
  long/short_open_interest_balance_volume。
"""
from __future__ import annotations

import json
from pathlib import Path

_PROBE_DIR = Path(__file__).parent / "fixtures" / "futures" / "probe"


def _total_row(day: str, contract_date: str, oi: int, session: str = "position") -> dict:
    return {
        "date": day, "futures_id": "MTX", "contract_date": contract_date,
        "open": 22000.0, "max": 22100.0, "min": 21900.0, "close": 22050.0,
        "spread": 0.0, "spread_per": 0.0, "volume": 100,
        "settlement_price": 0.0, "open_interest": oi, "trading_session": session,
    }


def _inst_row(day: str, name: str, long_oi: int, short_oi: int, futures_id: str = "MTX") -> dict:
    return {
        "date": day, "futures_id": futures_id, "institutional_investors": name,
        "long_deal_volume": 0, "long_deal_amount": 0,
        "short_deal_volume": 0, "short_deal_amount": 0,
        "long_open_interest_balance_volume": long_oi,
        "long_open_interest_balance_amount": long_oi * 100,
        "short_open_interest_balance_volume": short_oi,
        "short_open_interest_balance_amount": short_oi * 100,
    }


# ---------------------------------------------------------------------------
# parse_retail_mtx
# ---------------------------------------------------------------------------


def test_parse_retail_mtx_happy_two_days():
    """SC-4:retail = 總 OI − 法人;ratio = (多−空)/總;current = 最後一日。"""
    from services.finmind_futures import parse_retail_mtx
    rows_total = [
        _total_row("2026-07-02", "202607", 40000),
        _total_row("2026-07-02", "202607W2", 100),        # weekly counts
        _total_row("2026-07-03", "202607", 42000),
    ]
    rows_inst = [
        _inst_row("2026-07-02", "外資", 3000, 1000),
        _inst_row("2026-07-02", "自營商", 2000, 9000),
        _inst_row("2026-07-02", "投信", 100, 80),
        _inst_row("2026-07-03", "外資", 3600, 1100),
        _inst_row("2026-07-03", "自營商", 2200, 9100),
        _inst_row("2026-07-03", "投信", 120, 90),
    ]
    out = parse_retail_mtx(rows_total, rows_inst)
    # day2: total=42000, instL=5920, instS=10290 → rL=36080, rS=31710
    assert out["as_of_date"] == "2026-07-03"
    assert out["current"]["retail_long"] == 42000 - 5920
    assert out["current"]["retail_short"] == 42000 - 10290
    assert out["current"]["ratio"] == ((42000 - 5920) - (42000 - 10290)) / 42000
    assert [s["date"] for s in out["series"]] == ["2026-07-02", "2026-07-03"]
    assert out["dropped_days"] == 0
    assert out["data_quality_warnings"] == []


def test_parse_retail_mtx_only_position_session_counts():
    """SC-4 / probe:after_market rows OI 恆 0(即使非 0 也不得入分母)。"""
    from services.finmind_futures import parse_retail_mtx
    rows_total = [
        _total_row("2026-07-03", "202607", 40000, session="position"),
        _total_row("2026-07-03", "202607", 99999, session="after_market"),
    ]
    rows_inst = [_inst_row("2026-07-03", "外資", 1000, 500)]
    out = parse_retail_mtx(rows_total, rows_inst)
    assert out["current"]["retail_long"] == 40000 - 1000


def test_parse_retail_mtx_excludes_spread_contracts():
    """SC-4:價差 rows(202607/202608)不入總 OI。"""
    from services.finmind_futures import parse_retail_mtx
    rows_total = [
        _total_row("2026-07-03", "202607", 40000),
        _total_row("2026-07-03", "202607/202608", 5000),
    ]
    rows_inst = [_inst_row("2026-07-03", "外資", 1000, 500)]
    out = parse_retail_mtx(rows_total, rows_inst)
    assert out["current"]["retail_long"] == 40000 - 1000


def test_parse_retail_mtx_drops_days_without_inst_rows():
    """SC-4 / R5:法人缺的日子整筆 drop(不以 0 偽中性入 series)+ 固定 warning。"""
    from services.finmind_futures import parse_retail_mtx
    rows_total = [
        _total_row("2026-07-02", "202607", 40000),
        _total_row("2026-07-03", "202607", 42000),
    ]
    rows_inst = [_inst_row("2026-07-03", "外資", 1000, 500)]  # 07-02 missing
    out = parse_retail_mtx(rows_total, rows_inst)
    assert [s["date"] for s in out["series"]] == ["2026-07-03"]
    assert out["dropped_days"] == 1
    assert "retail_mtx_days_dropped" in out["data_quality_warnings"]


def test_parse_retail_mtx_drops_negative_retail_days_with_warning():
    """SC-4 / probe 修正結論 2:retail < 0 = 聚合口徑不符偵測線 → drop + warning。"""
    from services.finmind_futures import parse_retail_mtx
    rows_total = [_total_row("2026-07-03", "202607", 1000)]
    rows_inst = [_inst_row("2026-07-03", "外資", 5000, 100)]  # inst > total
    out = parse_retail_mtx(rows_total, rows_inst)
    assert out["series"] == []
    assert out["current"] is None
    assert out["as_of_date"] is None
    assert "retail_mtx_negative_retail" in out["data_quality_warnings"]


def test_parse_retail_mtx_series_capped_at_20():
    from services.finmind_futures import parse_retail_mtx
    rows_total = []
    rows_inst = []
    for i in range(1, 26):
        day = f"2026-06-{i:02d}"
        rows_total.append(_total_row(day, "202607", 40000 + i))
        rows_inst.append(_inst_row(day, "外資", 1000, 500))
    out = parse_retail_mtx(rows_total, rows_inst)
    assert len(out["series"]) == 20
    assert out["series"][-1]["date"] == "2026-06-25"


def test_parse_retail_mtx_empty_inputs():
    from services.finmind_futures import parse_retail_mtx
    out = parse_retail_mtx([], [])
    assert out["current"] is None
    assert out["series"] == []
    assert out["as_of_date"] is None


def test_parse_retail_mtx_on_real_probe_fixture():
    """Schema drift gate:真實 probe window 跑 parser — 非負、ratio 有界。"""
    from services.finmind_futures import parse_retail_mtx
    rows_total = json.loads(
        (_PROBE_DIR / "TaiwanFuturesDaily_MTX_window.json").read_text(encoding="utf-8")
    )["data"]
    rows_inst = json.loads(
        (_PROBE_DIR / "TaiwanFuturesInstitutionalInvestors_MTX_window.json").read_text(
            encoding="utf-8"
        )
    )["data"]
    out = parse_retail_mtx(rows_total, rows_inst)
    assert out["current"] is not None
    assert out["current"]["retail_long"] > 0
    assert out["current"]["retail_short"] > 0
    assert -1.0 <= out["current"]["ratio"] <= 1.0
    assert out["dropped_days"] == 0
    assert len(out["series"]) == 20


# ---------------------------------------------------------------------------
# parse_foreign_futures
# ---------------------------------------------------------------------------


def test_parse_foreign_futures_happy():
    """SC-5:外資 long/short OI → net;自營/投信 rows 忽略。"""
    from services.finmind_futures import parse_foreign_futures
    rows = [
        _inst_row("2026-07-02", "外資", 6000, 87000, futures_id="TX"),
        _inst_row("2026-07-02", "自營商", 7800, 4700, futures_id="TX"),
        _inst_row("2026-07-03", "外資", 6178, 87230, futures_id="TX"),
        _inst_row("2026-07-03", "投信", 73101, 5888, futures_id="TX"),
    ]
    out = parse_foreign_futures(rows)
    assert out["as_of_date"] == "2026-07-03"
    assert out["current"] == {"long_oi": 6178, "short_oi": 87230, "net_oi": 6178 - 87230}
    assert [s["date"] for s in out["series"]] == ["2026-07-02", "2026-07-03"]
    assert out["series"][0]["net_oi"] == 6000 - 87000


def test_parse_foreign_futures_empty():
    from services.finmind_futures import parse_foreign_futures
    out = parse_foreign_futures([])
    assert out["current"] is None
    assert out["series"] == []
    assert out["as_of_date"] is None


def test_parse_foreign_futures_on_real_probe_fixture():
    from services.finmind_futures import parse_foreign_futures
    rows = json.loads(
        (_PROBE_DIR / "TaiwanFuturesInstitutionalInvestors_TX_window.json").read_text(
            encoding="utf-8"
        )
    )["data"]
    out = parse_foreign_futures(rows)
    assert out["current"] is not None
    assert out["current"]["net_oi"] == out["current"]["long_oi"] - out["current"]["short_oi"]
    assert len(out["series"]) == 20
