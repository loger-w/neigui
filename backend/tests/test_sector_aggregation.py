"""Tests for services/sector_aggregation.py — SC-1~5 coverage.

Design: .claude/feat/market-sector-breadth/design.md v2
Implementation: .claude/feat/market-sector-breadth/implementation/sector_aggregation.md
Phase 3 TDD [red] batch — SC-1 (compute_ma20), SC-2 (aggregate_sector_breadth),
SC-3 (aggregate_sector_volume_ratio), SC-4/5 (orchestrators + integrated flag),
constants lock (R5).

Numbering matches implementation.md §3.

Fixtures use canonical dates in June 2026 (weekdays: Mon-Fri).
"""

from __future__ import annotations

from datetime import date, timedelta

import httpx
import pytest

from services import sector_aggregation as sa


# ---------------------------------------------------------------------------
# Helpers — build price rows
# ---------------------------------------------------------------------------


def _row(stock_id: str, d: date, close: float, volume: int) -> dict:
    return {
        "stock_id": stock_id,
        "date": d.isoformat(),
        "close": close,
        "Trading_Volume": volume,
    }


def _daily_rows(stock_id: str, start: date, days: int, base_close: float, base_vol: int) -> list[dict]:
    """Generate `days` daily rows starting from `start` (weekday-only skipped for simplicity)."""
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        out.append(_row(stock_id, d, base_close + i, base_vol + i * 100))
    return out


# ---------------------------------------------------------------------------
# §3.1 _extract_close_and_volume_by_stock — T1~T5
# ---------------------------------------------------------------------------


class TestExtractCloseAndVolumeByStock:
    def test_T1_nested_dict_shape(self) -> None:
        rows = (
            _daily_rows("2330", date(2026, 6, 1), 5, 100.0, 10000)
            + _daily_rows("2317", date(2026, 6, 1), 5, 50.0, 5000)
        )
        out = sa._extract_close_and_volume_by_stock(rows, universe={"2330", "2317"})
        assert set(out.keys()) == {"2330", "2317"}
        assert len(out["2330"]) == 5
        assert out["2330"][date(2026, 6, 1)] == (100.0, 10000)
        assert out["2330"][date(2026, 6, 4)] == (103.0, 10300)

    def test_T2_stock_not_in_universe_dropped(self) -> None:
        rows = _daily_rows("2330", date(2026, 6, 1), 3, 100.0, 10000) + _daily_rows(
            "0050", date(2026, 6, 1), 3, 200.0, 20000
        )
        out = sa._extract_close_and_volume_by_stock(rows, universe={"2330"})
        assert "0050" not in out
        assert "2330" in out

    def test_T3_row_missing_close_skipped(self) -> None:
        rows = [
            {"stock_id": "2330", "date": "2026-06-01", "close": 100.0, "Trading_Volume": 10000},
            {"stock_id": "2330", "date": "2026-06-02", "close": None, "Trading_Volume": 10000},
            {"stock_id": "2330", "date": "2026-06-03", "close": 102.0, "Trading_Volume": 10000},
        ]
        out = sa._extract_close_and_volume_by_stock(rows, universe={"2330"})
        assert date(2026, 6, 2) not in out["2330"]
        assert set(out["2330"].keys()) == {date(2026, 6, 1), date(2026, 6, 3)}

    def test_T4_duplicate_same_sid_date_later_wins(self) -> None:
        rows = [
            _row("2330", date(2026, 6, 1), 100.0, 10000),
            _row("2330", date(2026, 6, 1), 101.5, 12000),  # duplicate — later value
        ]
        out = sa._extract_close_and_volume_by_stock(rows, universe={"2330"})
        assert out["2330"][date(2026, 6, 1)] == (101.5, 12000)

    def test_T5_missing_volume_defaults_zero(self) -> None:
        rows = [
            {"stock_id": "2330", "date": "2026-06-01", "close": 100.0},  # no Trading_Volume
            {"stock_id": "2330", "date": "2026-06-02", "close": 101.0, "Trading_Volume": "bogus"},
        ]
        out = sa._extract_close_and_volume_by_stock(rows, universe={"2330"})
        assert out["2330"][date(2026, 6, 1)] == (100.0, 0)
        assert out["2330"][date(2026, 6, 2)] == (101.0, 0)


# ---------------------------------------------------------------------------
# §3.2 _compute_ma20 — T6~T9
# ---------------------------------------------------------------------------


class TestComputeMa20:
    def test_T6_exactly_20_closes(self) -> None:
        closes = [float(i) for i in range(1, 21)]  # 1..20
        assert sa._compute_ma20(closes, window=20) == pytest.approx(10.5)

    def test_T7_less_than_20_returns_none(self) -> None:
        closes = [float(i) for i in range(1, 20)]  # 19 elements
        assert sa._compute_ma20(closes, window=20) is None

    def test_T8_25_closes_takes_last_20(self) -> None:
        closes = [float(i) for i in range(1, 26)]  # 1..25, last 20 = 6..25, mean=15.5
        assert sa._compute_ma20(closes, window=20) == pytest.approx(15.5)

    def test_T9_custom_window(self) -> None:
        closes = [10.0, 20.0, 30.0, 40.0, 50.0]
        assert sa._compute_ma20(closes, window=5) == pytest.approx(30.0)


# ---------------------------------------------------------------------------
# §3.3 _aggregate_sector_breadth — T10~T18
# ---------------------------------------------------------------------------


def _build_by_stock(prices: list[dict], universe: set[str]) -> dict:
    """Shortcut using the extract fn (assumes T1 passes)."""
    return sa._extract_close_and_volume_by_stock(prices, universe)


class TestAggregateSectorBreadth:
    def test_T10_all_above_ma20(self) -> None:
        # 3 sectors × 1 stock each, 25 rows rising close → today > ma20
        rows = (
            _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
            + _daily_rows("2317", date(2026, 6, 1), 25, 50.0, 5000)
            + _daily_rows("2882", date(2026, 6, 1), 25, 60.0, 6000)
        )
        by_stock = _build_by_stock(rows, {"2330", "2317", "2882"})
        sector_map = {"2330": "半導體業", "2317": "其他電子業", "2882": "金融保險業"}
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        assert len(out) == 3
        assert all(r["pct"] == 1.0 for r in out)
        assert all(r["members"] == 1 and r["above_ma20"] == 1 for r in out)

    def test_T11_partial_above(self) -> None:
        # sector A: 3 stocks, 2 rising (above), 1 falling (below)
        rising_a = _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
        rising_b = _daily_rows("2454", date(2026, 6, 1), 25, 200.0, 20000)
        # falling: constant then last day below MA20
        falling_rows = []
        for i in range(25):
            d = date(2026, 6, 1) + timedelta(days=i)
            close = 100.0 if i < 24 else 50.0  # last day drops
            falling_rows.append(_row("6669", d, close, 5000))
        rows = rising_a + rising_b + falling_rows
        by_stock = _build_by_stock(rows, {"2330", "2454", "6669"})
        sector_map = {"2330": "半導體業", "2454": "半導體業", "6669": "半導體業"}
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        assert len(out) == 1
        assert out[0]["sector"] == "半導體業"
        assert out[0]["members"] == 3
        assert out[0]["above_ma20"] == 2
        assert out[0]["pct"] == pytest.approx(2 / 3)

    def test_T12_new_listing_less_than_20_days_skipped(self) -> None:
        # sector A: 3 stocks; 1 has only 15 days history → skipped
        established_a = _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
        established_b = _daily_rows("2454", date(2026, 6, 1), 25, 200.0, 20000)
        new = _daily_rows("6669", date(2026, 6, 11), 15, 50.0, 5000)  # only 15 days
        rows = established_a + established_b + new
        by_stock = _build_by_stock(rows, {"2330", "2454", "6669"})
        sector_map = {"2330": "半導體業", "2454": "半導體業", "6669": "半導體業"}
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        assert out[0]["members"] == 2  # new stock skipped

    def test_T13_stock_missing_today_close_skipped(self) -> None:
        established = _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
        # halted: 24 rows, no row on today_date=6/25
        halted = _daily_rows("2454", date(2026, 6, 1), 24, 200.0, 20000)
        rows = established + halted
        by_stock = _build_by_stock(rows, {"2330", "2454"})
        sector_map = {"2330": "半導體業", "2454": "半導體業"}
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        # today_date = max = 6/25 (established's last day, index 24)
        # halted's last day = 6/24 → no close on 6/25 → skipped
        assert out[0]["members"] == 1

    def test_T14_stock_not_in_sector_map_fallback_other(self) -> None:
        rows = (
            _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
            + _daily_rows("9999", date(2026, 6, 1), 25, 30.0, 3000)
        )
        by_stock = _build_by_stock(rows, {"2330", "9999"})
        sector_map = {"2330": "半導體業"}  # 9999 not mapped
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        sectors = {r["sector"] for r in out}
        assert "其他" in sectors

    def test_T15_empty_by_stock_returns_empty(self) -> None:
        assert sa._aggregate_sector_breadth({}, {}) == []

    def test_T16_sector_all_new_listings_omitted(self) -> None:
        established = _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
        new_in_sector_b = _daily_rows("6669", date(2026, 6, 11), 15, 50.0, 5000)
        rows = established + new_in_sector_b
        by_stock = _build_by_stock(rows, {"2330", "6669"})
        sector_map = {"2330": "半導體業", "6669": "其他電子業"}
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        sectors = {r["sector"] for r in out}
        assert "半導體業" in sectors
        assert "其他電子業" not in sectors  # all-new sector omitted

    def test_T17_window_less_than_ma_returns_empty(self) -> None:
        # only 15 days of history for every stock
        rows = _daily_rows("2330", date(2026, 6, 1), 15, 100.0, 10000)
        by_stock = _build_by_stock(rows, {"2330"})
        assert sa._aggregate_sector_breadth(by_stock, {"2330": "半導體業"}) == []

    def test_T18_sort_pct_desc_sector_asc(self) -> None:
        # sector A: pct=1.0, sector B: pct=1.0 tie → sort sector name ASC
        rows = (
            _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
            + _daily_rows("2454", date(2026, 6, 1), 25, 200.0, 20000)
            + _daily_rows("2317", date(2026, 6, 1), 25, 50.0, 5000)
        )
        by_stock = _build_by_stock(rows, {"2330", "2454", "2317"})
        # both sectors same pct=1.0; expect sort by sector ASC
        sector_map = {"2330": "半導體業", "2454": "半導體業", "2317": "其他電子業"}
        out = sa._aggregate_sector_breadth(by_stock, sector_map)
        assert len(out) == 2
        # 「其他電子業」 < 「半導體業」 by Unicode codepoint
        assert out[0]["sector"] < out[1]["sector"]


# ---------------------------------------------------------------------------
# §3.4 _aggregate_sector_volume_ratio — T19~T29
# ---------------------------------------------------------------------------


class TestAggregateSectorVolumeRatio:
    def test_T19_hot_2x_average(self) -> None:
        # 1 sector, 1 stock, 21 days: past 20 = vol 1000 each, today = 2000
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        rows.append(_row("2330", date(2026, 6, 21), 105.0, 2000))
        by_stock = _build_by_stock(rows, {"2330"})
        sector_map = {"2330": "半導體業"}
        out = sa._aggregate_sector_volume_ratio(by_stock, sector_map)
        assert len(out) == 1
        assert out[0]["sector"] == "半導體業"
        assert out[0]["today_vol_lots"] == 2  # 2000 // 1000
        assert out[0]["vol_ratio"] == pytest.approx(2.0)
        assert out[0]["flag"] == "hot"

    def test_T20_past_mean_zero_returns_none_ratio(self) -> None:
        # past 20 days all zero volume, today = 1000
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 0))
        rows.append(_row("2330", date(2026, 6, 21), 105.0, 1000))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["vol_ratio"] is None
        assert out[0]["flag"] is None

    def test_T21_today_no_volume_sector_omitted(self) -> None:
        # sector A has today volume, sector B does not (last row = yesterday)
        a_rows: list[dict] = []
        for i in range(21):
            d = date(2026, 6, 1) + timedelta(days=i)
            a_rows.append(_row("2330", d, 100.0, 1000))
        # sector B — 20 days but no today row
        b_rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            b_rows.append(_row("2317", d, 50.0, 500))
        rows = a_rows + b_rows
        by_stock = _build_by_stock(rows, {"2330", "2317"})
        sector_map = {"2330": "半導體業", "2317": "其他電子業"}
        out = sa._aggregate_sector_volume_ratio(by_stock, sector_map)
        sectors = {r["sector"] for r in out}
        assert "半導體業" in sectors
        assert "其他電子業" not in sectors

    def test_T22_four_way_sort_none_last(self) -> None:
        # hot (vr=2.0), normal (vr=1.0), cold (vr=0.5), None (past mean=0)
        # 4 sectors × 1 stock each, 21 days
        def sector_rows(sid: str, past_vol: int, today_vol: int) -> list[dict]:
            r: list[dict] = []
            for i in range(20):
                d = date(2026, 6, 1) + timedelta(days=i)
                r.append(_row(sid, d, 100.0, past_vol))
            r.append(_row(sid, date(2026, 6, 21), 105.0, today_vol))
            return r

        rows = (
            sector_rows("A1", 1000, 2000)  # hot
            + sector_rows("N1", 1000, 1000)  # normal
            + sector_rows("C1", 1000, 500)  # cold
            + sector_rows("Z1", 0, 5000)  # None ratio
        )
        by_stock = _build_by_stock(rows, {"A1", "N1", "C1", "Z1"})
        sector_map = {"A1": "A_hot", "N1": "N_normal", "C1": "C_cold", "Z1": "Z_none"}
        out = sa._aggregate_sector_volume_ratio(by_stock, sector_map)
        assert [r["sector"] for r in out] == ["A_hot", "N_normal", "C_cold", "Z_none"]
        assert out[-1]["vol_ratio"] is None

    def test_T23_flag_boundary_cold(self) -> None:
        # today vol / avg = exactly 0.5 → cold
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 2000))
        rows.append(_row("2330", date(2026, 6, 21), 105.0, 1000))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["vol_ratio"] == pytest.approx(0.5)
        assert out[0]["flag"] == "cold"

    def test_T24_empty_by_stock_returns_empty(self) -> None:
        assert sa._aggregate_sector_volume_ratio({}, {}) == []

    def test_T25_less_than_20_past_days_vol_ratio_none(self) -> None:
        # 10 past days + today
        rows: list[dict] = []
        for i in range(10):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        rows.append(_row("2330", date(2026, 6, 11), 100.0, 1000))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["vol_ratio"] is None

    def test_T26_today_vol_lots_is_int(self) -> None:
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        rows.append(_row("2330", date(2026, 6, 21), 105.0, 3456))  # 3456 // 1000 = 3
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert isinstance(out[0]["today_vol_lots"], int)
        assert out[0]["today_vol_lots"] == 3

    def test_T27_sort_tie_break_sector_asc(self) -> None:
        # two sectors same vol_ratio = 2.0 → sort by sector name ASC
        def sector_rows(sid: str) -> list[dict]:
            r: list[dict] = []
            for i in range(20):
                d = date(2026, 6, 1) + timedelta(days=i)
                r.append(_row(sid, d, 100.0, 1000))
            r.append(_row(sid, date(2026, 6, 21), 105.0, 2000))
            return r

        rows = sector_rows("2330") + sector_rows("2317")
        by_stock = _build_by_stock(rows, {"2330", "2317"})
        sector_map = {"2330": "半導體業", "2317": "其他電子業"}
        out = sa._aggregate_sector_volume_ratio(by_stock, sector_map)
        assert out[0]["sector"] < out[1]["sector"]

    def test_T28_vol_E3_new_stock_contributes_today_vol(self) -> None:
        # sector A: 2 established + 1 new (< 20 days) → new stock's today vol IS counted
        est_a = _daily_rows("2330", date(2026, 6, 1), 21, 100.0, 1000)
        est_b = _daily_rows("2454", date(2026, 6, 1), 21, 200.0, 2000)
        # new stock: 5 days including today (2026-06-21 is index 20 from 6/1)
        new_start = date(2026, 6, 17)
        new_stock = _daily_rows("6669", new_start, 5, 50.0, 500)
        rows = est_a + est_b + new_stock
        by_stock = _build_by_stock(rows, {"2330", "2454", "6669"})
        sector_map = {"2330": "半導體業", "2454": "半導體業", "6669": "半導體業"}
        out = sa._aggregate_sector_volume_ratio(by_stock, sector_map)
        # today 6/21 sector A vol = 2330's today (1000+20*100=3000)
        #                        + 2454's today (2000+20*100=4000)
        #                        + 6669's today (500+4*100=900)
        # 6669 last day index=4 (5 days from 6/17): 6/17,6/18,6/19,6/20,6/21 → today vol 500+4*100=900
        today_vol_shares = 3000 + 4000 + 900
        assert out[0]["today_vol_lots"] == today_vol_shares // 1000

    def test_T29_vol_E6_sector_map_fallback_other(self) -> None:
        # 1 stock not in sector_map → contributes to '其他' sector
        rows: list[dict] = []
        for i in range(21):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
            rows.append(_row("9999", d, 20.0, 200))  # not in sector_map
        by_stock = _build_by_stock(rows, {"2330", "9999"})
        sector_map = {"2330": "半導體業"}  # 9999 not mapped
        out = sa._aggregate_sector_volume_ratio(by_stock, sector_map)
        sectors = {r["sector"] for r in out}
        assert "其他" in sectors


# ---------------------------------------------------------------------------
# §3.6 compute_sector_breadth orchestrator — T30, T31, T-E9-breadth
# ---------------------------------------------------------------------------


class TestComputeSectorBreadthOrchestrator:
    async def test_T30_orchestrator_shape(self, monkeypatch) -> None:
        rows = (
            _daily_rows("2330", date(2026, 6, 1), 25, 100.0, 10000)
            + _daily_rows("2317", date(2026, 6, 1), 25, 50.0, 5000)
        )

        async def fake_prices(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", fake_prices)
        out = await sa.compute_sector_breadth(
            end_date=date(2026, 6, 25),
            universe={"2330", "2317"},
            sector_map={"2330": "半導體業", "2317": "其他電子業"},
        )
        assert isinstance(out, list)
        assert all("sector" in r and "pct" in r for r in out)
        assert len(out) == 2

    async def test_T31_empty_universe_raises(self) -> None:
        with pytest.raises(ValueError, match="universe_empty"):
            await sa.compute_sector_breadth(
                end_date=date(2026, 6, 25),
                universe=set(),
                sector_map={},
            )

    async def test_TE9_breadth_end_date_on_weekend_uses_max_date(self, monkeypatch) -> None:
        # rows go through 2026-06-26 (Fri); orchestrator called with 2026-06-28 (Sun)
        rows = _daily_rows("2330", date(2026, 6, 1), 26, 100.0, 10000)  # 6/1..6/26

        async def fake_prices(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", fake_prices)
        out = await sa.compute_sector_breadth(
            end_date=date(2026, 6, 28),  # Sunday
            universe={"2330"},
            sector_map={"2330": "半導體業"},
        )
        assert len(out) == 1  # uses max-date fallback = 6/26 Fri


# ---------------------------------------------------------------------------
# §3.7 compute_sector_volume_ratio orchestrator — T32, T33, T34, T-E9-vol
# ---------------------------------------------------------------------------


class TestComputeSectorVolumeRatioOrchestrator:
    async def test_T32_orchestrator_shape(self, monkeypatch) -> None:
        rows: list[dict] = []
        for i in range(21):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
            rows.append(_row("2317", d, 50.0, 500))
        # today = 6/21 → double the volume for both
        rows[-2] = _row("2330", date(2026, 6, 21), 105.0, 3000)
        rows[-1] = _row("2317", date(2026, 6, 21), 55.0, 1500)

        async def fake_prices(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", fake_prices)
        out = await sa.compute_sector_volume_ratio(
            end_date=date(2026, 6, 21),
            universe={"2330", "2317"},
            sector_map={"2330": "半導體業", "2317": "其他電子業"},
        )
        assert isinstance(out, list)
        assert all("sector" in r and "vol_ratio" in r and "flag" in r for r in out)

    async def test_T33_empty_universe_raises(self) -> None:
        with pytest.raises(ValueError, match="universe_empty"):
            await sa.compute_sector_volume_ratio(
                end_date=date(2026, 6, 25),
                universe=set(),
                sector_map={},
            )

    async def test_T34_flag_classification_hot_cold_normal(self, monkeypatch) -> None:
        def sector_rows(sid: str, past: int, today: int) -> list[dict]:
            r = []
            for i in range(20):
                d = date(2026, 6, 1) + timedelta(days=i)
                r.append(_row(sid, d, 100.0, past))
            r.append(_row(sid, date(2026, 6, 21), 105.0, today))
            return r

        rows = sector_rows("H1", 1000, 3000) + sector_rows("N1", 1000, 1000) + sector_rows("C1", 1000, 500)

        async def fake_prices(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", fake_prices)
        out = await sa.compute_sector_volume_ratio(
            end_date=date(2026, 6, 21),
            universe={"H1", "N1", "C1"},
            sector_map={"H1": "H", "N1": "N", "C1": "C"},
        )
        by_sector = {r["sector"]: r for r in out}
        assert by_sector["H"]["flag"] == "hot"
        assert by_sector["N"]["flag"] is None
        assert by_sector["C"]["flag"] == "cold"

    async def test_TE9_vol_end_date_on_weekend_uses_max_date(self, monkeypatch) -> None:
        rows: list[dict] = []
        for i in range(21):
            d = date(2026, 6, 1) + timedelta(days=i)  # 6/1..6/21
            rows.append(_row("2330", d, 100.0, 1000))

        async def fake_prices(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", fake_prices)
        out = await sa.compute_sector_volume_ratio(
            end_date=date(2026, 6, 28),  # Sunday
            universe={"2330"},
            sector_map={"2330": "半導體業"},
        )
        assert len(out) == 1  # falls back to max_date = 6/21


# ---------------------------------------------------------------------------
# §3.5 _fetch_prices_window — delegate propagation
# ---------------------------------------------------------------------------


class TestFetchPricesWindowDelegate:
    async def test_delegate_calls_market_breadth(self, monkeypatch) -> None:
        called = {}

        async def spy(start, end, refresh=False):
            called["start"] = start
            called["end"] = end
            called["refresh"] = refresh
            return [{"stock_id": "2330", "date": "2026-06-25", "close": 100.0, "Trading_Volume": 1000}]

        from services import market_breadth as mb

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", spy)
        result = await sa._fetch_prices_window(date(2026, 5, 1), date(2026, 6, 25), refresh=True)
        assert called == {"start": date(2026, 5, 1), "end": date(2026, 6, 25), "refresh": True}
        assert result[0]["stock_id"] == "2330"


# ---------------------------------------------------------------------------
# §3.8 Constants lock — R5 drift guard
# ---------------------------------------------------------------------------


class TestConstantsLock:
    def test_T35_p2_constants_stable(self) -> None:
        from services import market_breadth as mb

        assert mb._SLOW_EMA_PERIOD == 39
        assert mb._DEFAULT_LOOKBACK_DAYS == 60

    async def test_T36_p2_p3_share_fetch_window(self, monkeypatch) -> None:
        """Phase 4 review TC-1: lock cache_key reuse invariant.

        If P2 refactors its pad multiplier (currently 2.0 in market_breadth.py:
        compute_breadth), the numeric constants T35 locks stay valid but the
        window formula drifts silently. Spy on the shared fetcher and assert
        both orchestrators produce identical (start, end).
        """
        from services import market_breadth as mb
        from unittest.mock import patch as _patch

        seen_prices: list[tuple[date, date]] = []
        seen_taiex: list[tuple[date, date]] = []

        async def spy_prices(start, end, refresh=False):
            seen_prices.append((start, end))
            return []

        async def spy_taiex(start, end, refresh=False):
            seen_taiex.append((start, end))
            return []

        end = date(2026, 6, 30)
        universe = {"2330"}
        sector_map = {"2330": "半導體業"}

        with _patch("services.market_breadth._fetch_daily_prices_window", side_effect=spy_prices), \
             _patch("services.market_breadth._fetch_taiex_series", side_effect=spy_taiex):
            await mb.compute_breadth(end, universe)
            await sa.compute_sector_breadth(end, universe, sector_map)

        assert len(seen_prices) == 2  # once by P2 breadth, once by P3 sector_breadth
        assert seen_prices[0] == seen_prices[1], (
            f"cache_key drift! P2 fetch: {seen_prices[0]}, P3 fetch: {seen_prices[1]}"
        )

    async def test_T37_p4_amount_share_shares_fetch_window(self, monkeypatch) -> None:
        """P4 (SC-5) cache_key reuse lock — compute_sector_amount_share must derive
        the SAME (start, end) as P2 compute_breadth (CLAUDE.md §9: 常數同值 +
        公式同構兩者都要 lock). Pattern mirrors T36; taiex also patched (design v2 F4)."""
        from unittest.mock import patch as _patch

        from services import market_breadth as mb

        seen_prices: list[tuple[date, date]] = []

        async def spy_prices(start, end, refresh=False):
            seen_prices.append((start, end))
            return []

        async def spy_taiex(start, end, refresh=False):
            return []

        end = date(2026, 6, 30)
        universe = {"2330"}
        sector_map = {"2330": "半導體業"}

        with _patch("services.market_breadth._fetch_daily_prices_window", side_effect=spy_prices), \
             _patch("services.market_breadth._fetch_taiex_series", side_effect=spy_taiex):
            await mb.compute_breadth(end, universe)
            await sa.compute_sector_amount_share(end, universe, sector_map)

        assert len(seen_prices) == 2  # once by P2 breadth, once by P4 amount_share
        assert seen_prices[0] == seen_prices[1], (
            f"cache_key drift! P2 fetch: {seen_prices[0]}, P4 fetch: {seen_prices[1]}"
        )


# ---------------------------------------------------------------------------
# httpx.HTTPError propagation through orchestrator (SC-4/5 fetcher failure)
# ---------------------------------------------------------------------------


class TestOrchestratorFetcherFailure:
    async def test_compute_sector_breadth_propagates_httpx_error(self, monkeypatch) -> None:
        async def failing_fetch(start, end, refresh=False):
            raise httpx.HTTPError("fetch failed")

        monkeypatch.setattr(sa, "_fetch_prices_window", failing_fetch)
        with pytest.raises(httpx.HTTPError):
            await sa.compute_sector_breadth(
                end_date=date(2026, 6, 25),
                universe={"2330"},
                sector_map={"2330": "半導體業"},
            )

    async def test_compute_sector_volume_ratio_propagates_httpx_error(self, monkeypatch) -> None:
        async def failing_fetch(start, end, refresh=False):
            raise httpx.HTTPError("fetch failed")

        monkeypatch.setattr(sa, "_fetch_prices_window", failing_fetch)
        with pytest.raises(httpx.HTTPError):
            await sa.compute_sector_volume_ratio(
                end_date=date(2026, 6, 25),
                universe={"2330"},
                sector_map={"2330": "半導體業"},
            )

    async def test_compute_sector_breadth_empty_fetch_returns_empty_list(self, monkeypatch) -> None:
        """F3 — empty prices → return [] not raise ValueError."""

        async def empty_fetch(start, end, refresh=False):
            return []

        monkeypatch.setattr(sa, "_fetch_prices_window", empty_fetch)
        out = await sa.compute_sector_breadth(
            end_date=date(2026, 6, 25),
            universe={"2330"},
            sector_map={"2330": "半導體業"},
        )
        assert out == []


# ---------------------------------------------------------------------------
# Phase 4 review — TC-2 refresh propagation
# ---------------------------------------------------------------------------


class TestRefreshPropagation:
    async def test_compute_sector_breadth_forwards_refresh_true(self, monkeypatch) -> None:
        captured: dict = {}

        async def spy(start, end, refresh=False):
            captured["refresh"] = refresh
            return []

        monkeypatch.setattr(sa, "_fetch_prices_window", spy)
        await sa.compute_sector_breadth(
            end_date=date(2026, 6, 25),
            universe={"2330"},
            sector_map={"2330": "半導體業"},
            refresh=True,
        )
        assert captured["refresh"] is True

    async def test_compute_sector_volume_ratio_forwards_refresh_true(self, monkeypatch) -> None:
        captured: dict = {}

        async def spy(start, end, refresh=False):
            captured["refresh"] = refresh
            return []

        monkeypatch.setattr(sa, "_fetch_prices_window", spy)
        await sa.compute_sector_volume_ratio(
            end_date=date(2026, 6, 25),
            universe={"2330"},
            sector_map={"2330": "半導體業"},
            refresh=True,
        )
        assert captured["refresh"] is True


# ---------------------------------------------------------------------------
# Phase 4 review — TC-4 flag threshold boundary
# ---------------------------------------------------------------------------


class TestFlagThresholdBoundary:
    def test_vol_ratio_exactly_hot_threshold_flag_none(self) -> None:
        """vol_ratio == 1.5 exactly → flag=None (strict > semantics)."""
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        rows.append(_row("2330", date(2026, 6, 21), 100.0, 1500))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["vol_ratio"] == pytest.approx(1.5)
        assert out[0]["flag"] is None  # strict `>` — 1.5 exactly is NOT hot

    def test_vol_ratio_exactly_cold_threshold_flag_none(self) -> None:
        """vol_ratio == 0.7 exactly → flag=None (strict < semantics)."""
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        rows.append(_row("2330", date(2026, 6, 21), 100.0, 700))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["vol_ratio"] == pytest.approx(0.7)
        assert out[0]["flag"] is None  # strict `<` — 0.7 exactly is NOT cold

    def test_vol_ratio_just_above_hot_threshold_is_hot(self) -> None:
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        # 1500 + 1 share → ratio = 1.500...001 (just above 1.5)
        rows.append(_row("2330", date(2026, 6, 21), 100.0, 1501))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["flag"] == "hot"

    def test_vol_ratio_just_below_cold_threshold_is_cold(self) -> None:
        rows: list[dict] = []
        for i in range(20):
            d = date(2026, 6, 1) + timedelta(days=i)
            rows.append(_row("2330", d, 100.0, 1000))
        rows.append(_row("2330", date(2026, 6, 21), 100.0, 699))
        by_stock = _build_by_stock(rows, {"2330"})
        out = sa._aggregate_sector_volume_ratio(by_stock, {"2330": "半導體業"})
        assert out[0]["flag"] == "cold"


# ---------------------------------------------------------------------------
# P4 — sector amount share (market-sector-amount-share)
# Design: .claude/feat/market-sector-amount-share/design.md v2
# Implementation: .claude/feat/market-sector-amount-share/implementation/sector_aggregation.md
# Phase 3 TDD [red] batch — SC-1 (A1~A5 extract), SC-2 (A6~A10 today_share),
# SC-3 (A11~A15 share_delta), SC-4 (A16~A17 sort), SC-5 (A18~A23 orchestrator).
# ---------------------------------------------------------------------------

# P4 canonical weekday dates (2026-06-22 Mon .. 2026-06-26 Fri; 06-28 Sun)
_D_MON = date(2026, 6, 22)
_D_TUE = date(2026, 6, 23)
_D_WED = date(2026, 6, 24)
_D_THU = date(2026, 6, 25)
_D_FRI = date(2026, 6, 26)
_D_SUN = date(2026, 6, 28)


def _amt_row(
    stock_id: str,
    d: date,
    amount: float | None,
    *,
    close: float | None = 100.0,
) -> dict:
    """Price row with Trading_money; amount=None omits the field.

    close=None omits close (A5 locks close-independence of the P4 extract).
    """
    row: dict = {"stock_id": stock_id, "date": d.isoformat()}
    if close is not None:
        row["close"] = close
    if amount is not None:
        row["Trading_money"] = amount
    return row


class TestExtractAmountByStock:
    def test_A1_nested_dict_shape(self) -> None:
        rows = []
        for d in (_D_WED, _D_THU, _D_FRI):
            rows.append(_amt_row("2330", d, 1000.0))
            rows.append(_amt_row("2317", d, 500.0))
            rows.append(_amt_row("2454", d, 300.0))
        out = sa._extract_amount_by_stock(rows, {"2330", "2317", "2454"})
        assert set(out.keys()) == {"2330", "2317", "2454"}
        assert out["2330"][_D_WED] == 1000.0
        assert out["2454"][_D_FRI] == 300.0
        assert isinstance(out["2317"][_D_THU], float)

    def test_A2_stock_not_in_universe_dropped(self) -> None:
        rows = [_amt_row("2330", _D_FRI, 1000.0), _amt_row("0050", _D_FRI, 900.0)]
        out = sa._extract_amount_by_stock(rows, {"2330"})
        assert set(out.keys()) == {"2330"}

    def test_A3_row_missing_date_or_sid_skipped(self) -> None:
        rows = [
            {"stock_id": "2330", "close": 100.0, "Trading_money": 1000.0},  # no date
            {"date": _D_FRI.isoformat(), "close": 100.0, "Trading_money": 1000.0},  # no sid
            {"stock_id": "2330", "date": "not-a-date", "Trading_money": 1000.0},
            _amt_row("2330", _D_FRI, 500.0),
        ]
        out = sa._extract_amount_by_stock(rows, {"2330"})
        assert out == {"2330": {_D_FRI: 500.0}}

    def test_A4_duplicate_same_sid_date_later_wins(self) -> None:
        rows = [_amt_row("2330", _D_FRI, 100.0), _amt_row("2330", _D_FRI, 999.0)]
        out = sa._extract_amount_by_stock(rows, {"2330"})
        assert out["2330"][_D_FRI] == 999.0

    def test_A26_negative_trading_money_treated_as_corrupt_zero(self) -> None:
        # CORR-1 (Phase 4 review) — 負 turnover 不存在於 domain,視同 corrupt → 0.0
        # (對齊 E4 非數值慣例)。防 sector_today>0 但 today_total=0 的 ZeroDivisionError。
        rows = [
            _amt_row("2330", _D_FRI, -500.0),
            _amt_row("2317", _D_FRI, 500.0),
        ]
        out = sa._extract_amount_by_stock(rows, {"2330", "2317"})
        assert out["2330"][_D_FRI] == 0.0
        assert out["2317"][_D_FRI] == 500.0

    def test_A5_missing_trading_money_zero_and_close_independent(self) -> None:
        rows = [
            _amt_row("2330", _D_THU, None),  # missing Trading_money -> 0.0, row kept
            _amt_row("2330", _D_FRI, 700.0, close=None),  # missing close -> still kept
            {"stock_id": "2317", "date": _D_FRI.isoformat(),
             "Trading_money": "not-a-number"},  # non-numeric -> 0.0
        ]
        out = sa._extract_amount_by_stock(rows, {"2330", "2317"})
        assert out["2330"][_D_THU] == 0.0
        assert out["2330"][_D_FRI] == 700.0
        assert out["2317"][_D_FRI] == 0.0


class TestAggregateSectorAmountShare:
    _MAP3 = {"2330": "半導體業", "2317": "電子零組件業", "2603": "航運業"}

    def test_A6_today_share_hand_computed(self) -> None:
        by_stock = {
            "2330": {_D_FRI: 400.0},
            "2317": {_D_FRI: 300.0},
            "2603": {_D_FRI: 300.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3)
        # 0.4 first; 0.3 tie -> sector ASC (航運業 U+822A < 電子零組件業 U+96FB)
        assert [r["sector"] for r in out] == ["半導體業", "航運業", "電子零組件業"]
        assert out[0]["today_share"] == pytest.approx(0.4)
        assert out[1]["today_share"] == pytest.approx(0.3)
        assert sum(r["today_share"] for r in out) == pytest.approx(1.0)
        assert all(r["share_delta_20ma"] is None for r in out)  # no history

    def test_A7_sector_today_zero_absent(self) -> None:
        by_stock = {
            "2330": {_D_THU: 100.0, _D_FRI: 400.0},
            "2317": {_D_THU: 900.0},  # no row today -> absent
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3)
        assert [r["sector"] for r in out] == ["半導體業"]
        assert out[0]["today_share"] == pytest.approx(1.0)

    def test_A8_today_total_zero_returns_empty(self) -> None:
        # T-E2 / KG7 lock — rows exist today but all Trading_money = 0
        by_stock = {
            "2330": {_D_THU: 100.0, _D_FRI: 0.0},
            "2317": {_D_THU: 900.0, _D_FRI: 0.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3)
        assert out == []

    def test_A9_sector_map_fallback_other(self) -> None:
        by_stock = {"9999": {_D_FRI: 250.0}, "2330": {_D_FRI: 750.0}}
        out = sa._aggregate_sector_amount_share(by_stock, {"2330": "半導體業"})
        assert [r["sector"] for r in out] == ["半導體業", "其他"]
        assert out[1]["today_share"] == pytest.approx(0.25)

    def test_A10_empty_by_stock_returns_empty(self) -> None:
        assert sa._aggregate_sector_amount_share({}, self._MAP3) == []

    def _four_day_two_sector(self) -> dict[str, dict[date, float]]:
        # past 3 days share_半導體 = 0.25 (250/1000); today share = 0.4 (400/1000)
        return {
            "2330": {_D_MON: 250.0, _D_TUE: 250.0, _D_WED: 250.0, _D_THU: 400.0},
            "2317": {_D_MON: 750.0, _D_TUE: 750.0, _D_WED: 750.0, _D_THU: 600.0},
        }

    def test_A11_share_delta_positive_hand_computed(self) -> None:
        out = sa._aggregate_sector_amount_share(
            self._four_day_two_sector(), self._MAP3, avg_window=3
        )
        semi = next(r for r in out if r["sector"] == "半導體業")
        assert semi["today_share"] == pytest.approx(0.4)
        assert semi["share_delta_20ma"] == pytest.approx(0.15)  # 0.4 - mean(0.25 x3)

    def test_A12_share_delta_negative(self) -> None:
        out = sa._aggregate_sector_amount_share(
            self._four_day_two_sector(), self._MAP3, avg_window=3
        )
        elec = next(r for r in out if r["sector"] == "電子零組件業")
        assert elec["today_share"] == pytest.approx(0.6)
        assert elec["share_delta_20ma"] == pytest.approx(-0.15)  # 0.6 - mean(0.75 x3)

    def test_A13_new_sector_insufficient_history_delta_none(self) -> None:
        # E1 — 電子零組件業 has only 2 past days (avg_window=3) -> delta None
        by_stock = {
            "2330": {_D_MON: 250.0, _D_TUE: 250.0, _D_WED: 250.0, _D_THU: 400.0},
            "2317": {_D_TUE: 750.0, _D_WED: 750.0, _D_THU: 600.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3, avg_window=3)
        elec = next(r for r in out if r["sector"] == "電子零組件業")
        semi = next(r for r in out if r["sector"] == "半導體業")
        assert elec["today_share"] == pytest.approx(0.6)
        assert elec["share_delta_20ma"] is None
        assert semi["share_delta_20ma"] is not None

    def test_A14_past_day_total_zero_skipped(self) -> None:
        # T-E3 — IF1 fixture constraints:
        # 1) zero-total day built with rows present but Trading_money=0 (not missing rows)
        # 2) zero day (_D_WED) inside the most recent avg_window(3) past days
        #    (THU, WED, TUE) — a buggy impl without the total>0 filter hits 0/0 here
        by_stock = {
            "2330": {_D_MON: 250.0, _D_TUE: 250.0, _D_WED: 0.0, _D_THU: 250.0, _D_FRI: 400.0},
            "2317": {_D_MON: 750.0, _D_TUE: 750.0, _D_WED: 0.0, _D_THU: 750.0, _D_FRI: 600.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3, avg_window=3)
        semi = next(r for r in out if r["sector"] == "半導體業")
        # valid past days = THU, TUE, MON (WED skipped) -> mean 0.25 -> delta +0.15
        assert semi["share_delta_20ma"] == pytest.approx(0.15)

        # 對照組:3 past days with 1 zero-total day -> only 2 valid < 3 -> None
        by_stock2 = {
            "2330": {_D_MON: 250.0, _D_TUE: 0.0, _D_WED: 250.0, _D_THU: 400.0},
            "2317": {_D_MON: 750.0, _D_TUE: 0.0, _D_WED: 750.0, _D_THU: 600.0},
        }
        out2 = sa._aggregate_sector_amount_share(by_stock2, self._MAP3, avg_window=3)
        semi2 = next(r for r in out2 if r["sector"] == "半導體業")
        assert semi2["today_share"] == pytest.approx(0.4)
        assert semi2["share_delta_20ma"] is None

    def test_A15_window_excludes_today(self) -> None:
        # brainstorm 抉擇 3 — including today would give mean(0.4, 0.25) = 0.325
        # -> delta 0.075; correct (exclude today) -> 0.4 - 0.25 = 0.15
        by_stock = {
            "2330": {_D_TUE: 250.0, _D_WED: 250.0, _D_THU: 400.0},
            "2317": {_D_TUE: 750.0, _D_WED: 750.0, _D_THU: 600.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3, avg_window=2)
        semi = next(r for r in out if r["sector"] == "半導體業")
        assert semi["share_delta_20ma"] == pytest.approx(0.15)

    def test_A24_past_window_takes_most_recent_days(self) -> None:
        # TS-1 (Phase 4 review) — recency lock:valid past days(3)> avg_window(2),
        # 必須取「最近 N 日」。oldest-N mutation(reverse=False)→ mean(0.10, 0.25)
        # = 0.175 → delta 0.225 → 立紅。
        by_stock = {
            "2330": {_D_MON: 100.0, _D_TUE: 250.0, _D_WED: 250.0, _D_THU: 400.0},
            "2317": {_D_MON: 900.0, _D_TUE: 750.0, _D_WED: 750.0, _D_THU: 600.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3, avg_window=2)
        semi = next(r for r in out if r["sector"] == "半導體業")
        # recent 2 past days = WED, TUE → mean 0.25 → delta 0.15
        assert semi["share_delta_20ma"] == pytest.approx(0.15)

    def test_A25_past_day_sector_zero_but_total_positive_counts(self) -> None:
        # TS-3 (Phase 4 review) — sector 該日 amt=0 但 universe total>0 = valid
        # share-0.0 日,必須計入 window(拉低 mean)。過濾過寬 mutation
        # (past filter 加 day_amt>0)→ 只剩 2 valid 日 → None → 立紅。
        by_stock = {
            "2330": {_D_MON: 250.0, _D_TUE: 0.0, _D_WED: 250.0, _D_THU: 400.0},
            "2317": {_D_MON: 750.0, _D_TUE: 1000.0, _D_WED: 750.0, _D_THU: 600.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3, avg_window=3)
        semi = next(r for r in out if r["sector"] == "半導體業")
        # past shares = WED 0.25, TUE 0.0, MON 0.25 → mean 1/6 → delta = 0.4 − 1/6
        assert semi["share_delta_20ma"] == pytest.approx(0.4 - 1.0 / 6.0)

    def test_A16_sort_today_share_desc(self) -> None:
        by_stock = {
            "2330": {_D_FRI: 500.0},
            "2317": {_D_FRI: 300.0},
            "2603": {_D_FRI: 200.0},
        }
        out = sa._aggregate_sector_amount_share(by_stock, self._MAP3)
        assert [r["sector"] for r in out] == ["半導體業", "電子零組件業", "航運業"]

    def test_A17_sort_tie_break_sector_asc(self) -> None:
        by_stock = {
            "1101": {_D_FRI: 350.0},
            "2603": {_D_FRI: 350.0},
            "2330": {_D_FRI: 300.0},
        }
        sector_map = {"1101": "水泥工業", "2603": "航運業", "2330": "半導體業"}
        out = sa._aggregate_sector_amount_share(by_stock, sector_map)
        # 0.35 tie -> 水泥工業 (U+6C34) < 航運業 (U+822A)
        assert [r["sector"] for r in out] == ["水泥工業", "航運業", "半導體業"]


class TestComputeSectorAmountShareOrchestrator:
    _MAP2 = {"2330": "半導體業", "2317": "電子零組件業"}

    async def test_A18_orchestrator_shape(self, monkeypatch) -> None:
        rows: list[dict] = []
        day_amts = {
            _D_MON: (250.0, 750.0),
            _D_TUE: (250.0, 750.0),
            _D_WED: (250.0, 750.0),
            _D_THU: (400.0, 600.0),
        }
        for d, (a_amt, b_amt) in day_amts.items():
            rows.append(_amt_row("2330", d, a_amt))
            rows.append(_amt_row("2317", d, b_amt))

        async def stub(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", stub)
        out = await sa.compute_sector_amount_share(
            end_date=_D_THU,
            universe={"2330", "2317"},
            sector_map=self._MAP2,
            avg_window=3,
        )
        assert [r["sector"] for r in out] == ["電子零組件業", "半導體業"]
        assert set(out[0].keys()) == {"sector", "today_share", "share_delta_20ma"}
        assert out[0]["today_share"] == pytest.approx(0.6)
        assert out[1]["share_delta_20ma"] == pytest.approx(0.15)

    async def test_A19_empty_universe_raises(self) -> None:
        with pytest.raises(ValueError, match="universe_empty"):
            await sa.compute_sector_amount_share(
                end_date=_D_THU, universe=set(), sector_map=self._MAP2
            )

    async def test_A20_empty_prices_returns_empty(self, monkeypatch) -> None:
        async def empty_fetch(start, end, refresh=False):
            return []

        monkeypatch.setattr(sa, "_fetch_prices_window", empty_fetch)
        out = await sa.compute_sector_amount_share(
            end_date=_D_THU, universe={"2330"}, sector_map=self._MAP2
        )
        assert out == []

    async def test_A21_httpx_error_propagates(self, monkeypatch) -> None:
        async def failing_fetch(start, end, refresh=False):
            raise httpx.HTTPError("fetch failed")

        monkeypatch.setattr(sa, "_fetch_prices_window", failing_fetch)
        with pytest.raises(httpx.HTTPError):
            await sa.compute_sector_amount_share(
                end_date=_D_THU, universe={"2330"}, sector_map=self._MAP2
            )

    async def test_A22_refresh_forwarded(self, monkeypatch) -> None:
        seen: list[bool] = []

        async def recording_fetch(start, end, refresh=False):
            seen.append(refresh)
            return []

        monkeypatch.setattr(sa, "_fetch_prices_window", recording_fetch)
        await sa.compute_sector_amount_share(
            end_date=_D_THU, universe={"2330"}, sector_map=self._MAP2, refresh=True
        )
        assert seen == [True]

    async def test_A23_end_date_on_weekend_uses_max_date(self, monkeypatch) -> None:
        # T-E6 — end_date Sunday, latest fixture row Friday -> today_date = Friday (F7)
        rows: list[dict] = []
        day_amts = {
            _D_TUE: (100.0, 900.0),
            _D_WED: (100.0, 900.0),
            _D_THU: (100.0, 900.0),
            _D_FRI: (400.0, 600.0),
        }
        for d, (a_amt, b_amt) in day_amts.items():
            rows.append(_amt_row("2330", d, a_amt))
            rows.append(_amt_row("2317", d, b_amt))

        async def stub(start, end, refresh=False):
            return rows

        monkeypatch.setattr(sa, "_fetch_prices_window", stub)
        out = await sa.compute_sector_amount_share(
            end_date=_D_SUN,
            universe={"2330", "2317"},
            sector_map=self._MAP2,
            avg_window=3,
        )
        semi = next(r for r in out if r["sector"] == "半導體業")
        assert semi["today_share"] == pytest.approx(0.4)  # Friday used as today
        assert semi["share_delta_20ma"] == pytest.approx(0.3)
