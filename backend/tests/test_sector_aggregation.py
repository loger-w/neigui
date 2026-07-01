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
