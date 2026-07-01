"""Tests for services/market_breadth.py — SC-1~5 coverage.

Design: .claude/feat/market-breadth-mcclellan/design.md v2
Implementation: .claude/feat/market-breadth-mcclellan/implementation/market_breadth.md
Batch A: pure functions (SC-1/2/3 + F5 _count_daily_ups_downs).
Batch B: orchestrator + fetcher + edge (SC-4/5).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from services import market_breadth as mb


# ---------------------------------------------------------------------------
# Batch A — SC-1 compute_ad_line
# ---------------------------------------------------------------------------


class TestComputeAdLine:
    def test_compute_ad_line_accumulates(self) -> None:
        counts = [
            (date(2026, 6, 20), 100, 50),  # +50
            (date(2026, 6, 21), 80, 90),  # -10 → 40
            (date(2026, 6, 22), 200, 100),  # +100 → 140
        ]
        result = mb.compute_ad_line(counts)
        assert [r["date"] for r in result] == ["2026-06-20", "2026-06-21", "2026-06-22"]
        assert [r["value"] for r in result] == [50.0, 40.0, 140.0]


# ---------------------------------------------------------------------------
# Batch A — SC-2 compute_rana
# ---------------------------------------------------------------------------


class TestComputeRana:
    def test_rana_normal(self) -> None:
        counts = [
            (date(2026, 6, 20), 100, 50),  # 50/150
            (date(2026, 6, 21), 80, 80),  # 0/160
        ]
        result = mb.compute_rana(counts)
        assert result[0]["value"] == pytest.approx(50 / 150)
        assert result[1]["value"] == 0.0

    def test_rana_zero_denominator(self) -> None:
        counts = [(date(2026, 6, 20), 0, 0)]
        result = mb.compute_rana(counts)
        assert result[0]["value"] == 0.0


# ---------------------------------------------------------------------------
# Batch A — SC-2 compute_mcclellan
# ---------------------------------------------------------------------------


class TestComputeMcclellan:
    def test_mcclellan_warmup_returns_none(self) -> None:
        rana = [{"date": f"2026-06-{i:02d}", "value": 0.1 * i} for i in range(1, 10)]
        result = mb.compute_mcclellan(rana, fast=19, slow=39)
        assert all(r["value"] is None for r in result)
        assert len(result) == 9

    def test_mcclellan_small_periods_hand_calc(self) -> None:
        # fast=2, slow=3;RANA = [1,2,3,4,5]
        # slow(3): seed at idx=2 = (1+2+3)/3 = 2.0
        #   idx=3: α=0.5, prev=2.0 → (4-2.0)*0.5+2.0 = 3.0
        #   idx=4: (5-3.0)*0.5+3.0 = 4.0
        # fast(2): seed at idx=1 = (1+2)/2 = 1.5
        #   idx=2: α=2/3, prev=1.5 → (3-1.5)*(2/3)+1.5 = 2.5
        #   idx=3: (4-2.5)*(2/3)+2.5 = 3.5
        #   idx=4: (5-3.5)*(2/3)+3.5 = 4.5
        # mcclellan = fast - slow:
        #   idx=0,1 None
        #   idx=2: 2.5 - 2.0 = 0.5
        #   idx=3: 3.5 - 3.0 = 0.5
        #   idx=4: 4.5 - 4.0 = 0.5
        rana = [{"date": f"d{i}", "value": float(i)} for i in range(1, 6)]
        result = mb.compute_mcclellan(rana, fast=2, slow=3)
        assert result[0]["value"] is None
        assert result[1]["value"] is None
        assert result[2]["value"] == pytest.approx(0.5)
        assert result[3]["value"] == pytest.approx(0.5)
        assert result[4]["value"] == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# Batch A — SC-3 signal detectors
# ---------------------------------------------------------------------------


class TestSignalDetectors:
    def test_thrust_dot_above_plus_100(self) -> None:
        series = [{"date": "d1", "value": 105.0}]
        assert mb.detect_thrust_dot(series) == "above_plus_100"

    def test_thrust_dot_below_minus_100(self) -> None:
        series = [{"date": "d1", "value": -110.0}]
        assert mb.detect_thrust_dot(series) == "below_minus_100"

    def test_thrust_dot_within_returns_none(self) -> None:
        series = [{"date": "d1", "value": 50.0}]
        assert mb.detect_thrust_dot(series) is None

    def test_thrust_dot_last_none_returns_none(self) -> None:
        series = [{"date": "d1", "value": None}]
        assert mb.detect_thrust_dot(series) is None

    def test_centerline_cross_up(self) -> None:
        series = [{"date": "d0", "value": -5.0}, {"date": "d1", "value": 10.0}]
        assert mb.detect_centerline_cross(series) == "above"

    def test_centerline_cross_down(self) -> None:
        series = [{"date": "d0", "value": 5.0}, {"date": "d1", "value": -10.0}]
        assert mb.detect_centerline_cross(series) == "below"

    def test_centerline_same_sign_none(self) -> None:
        series = [{"date": "d0", "value": 5.0}, {"date": "d1", "value": 10.0}]
        assert mb.detect_centerline_cross(series) is None

    def test_divergence_bearish(self) -> None:
        # TAIEX 越後越高;mcc 越後越低
        mcc = [{"date": f"d{i}", "value": 100 - i * 5} for i in range(20)]
        taiex = [{"date": f"d{i}", "value": float(1000 + i * 10)} for i in range(20)]
        assert mb.detect_divergence(mcc, taiex, window=20) == "bearish"

    def test_divergence_bullish(self) -> None:
        # TAIEX 越後越低;mcc 越後越高
        mcc = [{"date": f"d{i}", "value": -100 + i * 5} for i in range(20)]
        taiex = [{"date": f"d{i}", "value": float(1000 - i * 10)} for i in range(20)]
        assert mb.detect_divergence(mcc, taiex, window=20) == "bullish"

    def test_divergence_taiex_empty_returns_none(self) -> None:
        mcc = [{"date": "d1", "value": 50.0}]
        assert mb.detect_divergence(mcc, [], window=20) is None


# ---------------------------------------------------------------------------
# Batch A — F5 / E2/E4 _count_daily_ups_downs
# ---------------------------------------------------------------------------


class TestCountDailyUpsDowns:
    def test_count_basic(self) -> None:
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "2317", "date": "2026-06-20", "close": 50.0},
            {"stock_id": "2317", "date": "2026-06-21", "close": 45.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330", "2317"})
        assert counts == [(date(2026, 6, 21), 1, 1)]

    def test_count_skips_non_universe(self) -> None:
        prices = [
            {"stock_id": "0050", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "0050", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "2330", "date": "2026-06-20", "close": 500.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 490.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        assert counts == [(date(2026, 6, 21), 0, 1)]

    def test_count_flat_not_counted(self) -> None:
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 100.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        assert counts == [(date(2026, 6, 21), 0, 0)]

    def test_count_missing_row_skipped(self) -> None:
        # E2:新上市股 06-20 無 row → 06-21 該股無 prev_close → skip
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "NEW1", "date": "2026-06-21", "close": 30.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330", "NEW1"})
        assert counts == [(date(2026, 6, 21), 1, 0)]

    def test_count_sparse_dates_natural_axis(self) -> None:
        # E4:連假,日期軸走實際回傳
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-23", "close": 110.0},
            {"stock_id": "2330", "date": "2026-06-24", "close": 105.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        dates = [d for d, _, _ in counts]
        assert dates == [date(2026, 6, 23), date(2026, 6, 24)]

    def test_count_two_stocks_disjoint_dates_union(self) -> None:
        # TC_F5 — 兩 stock disjoint sparse dates,axis 走 union
        # 2330: 06-20, 06-24 (06-24 = up vs 06-20 → up=1)
        # 2317: 06-21, 06-23 (06-23 = down vs 06-21 → down=1)
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-24", "close": 110.0},
            {"stock_id": "2317", "date": "2026-06-21", "close": 50.0},
            {"stock_id": "2317", "date": "2026-06-23", "close": 45.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330", "2317"})
        # 06-23 (2317 down) → (0, 1);06-24 (2330 up) → (1, 0)
        assert counts == [(date(2026, 6, 23), 0, 1), (date(2026, 6, 24), 1, 0)]

    def test_count_dedupes_duplicate_row_per_stock(self) -> None:
        # F6 — FinMind duplicate row 防禦:same (sid, date) 兩 row,keep last close
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},  # duplicate
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        # duplicate 首日不生 phantom (0,0) entry;只有 06-21 一筆
        assert counts == [(date(2026, 6, 21), 1, 0)]


# ---------------------------------------------------------------------------
# Batch B — SC-4 compute_breadth orchestrator
# ---------------------------------------------------------------------------


class TestComputeBreadth:
    async def test_compute_breadth_shape(self, monkeypatch) -> None:
        # F2 fix — 60 天 fixture
        prices = []
        base = date(2026, 4, 1)
        dates_iso = [(base + timedelta(days=i)).isoformat() for i in range(60)]
        for i, d in enumerate(dates_iso):
            prices.append({"stock_id": "2330", "date": d, "close": 100.0 + i})
            prices.append({"stock_id": "2317", "date": d, "close": 50.0 - i * 0.5})
        taiex = [{"date": d, "close": 17000.0 + i * 10} for i, d in enumerate(dates_iso)]

        async def fake_prices(start, end, refresh=False):
            return prices

        async def fake_taiex(start, end, refresh=False):
            return taiex

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)

        result = await mb.compute_breadth(
            end_date=date(2026, 5, 30),
            universe={"2330", "2317"},
            lookback_days=30,
        )
        assert "ad_line_value" in result
        assert "mcclellan_oscillator" in result
        assert isinstance(result["ad_line_series"], list)
        assert isinstance(result["mcclellan_series"], list)
        assert all("date" in r and "value" in r for r in result["ad_line_series"])
        assert result["known_gaps"] == []
        # TC_F2 numerical asserts:fixture net-zero (2330 每天 +1, 2317 每天 -0.5)
        # → daily net = 0 → AD Line ≡ 0, RANA ≡ 0, McClellan ≡ 0(warmup 過後)
        assert len(result["ad_line_series"]) == 59  # 60 天扣掉首日無 prev_close
        assert result["ad_line_value"] == pytest.approx(0.0)
        assert result["mcclellan_oscillator"] == pytest.approx(0.0)

    async def test_compute_breadth_uses_injected_universe(self, monkeypatch) -> None:
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "0050", "date": "2026-06-20", "close": 200.0},
            {"stock_id": "0050", "date": "2026-06-21", "close": 100.0},
        ]

        async def fake_prices(*a, **kw):
            return prices

        async def fake_taiex(*a, **kw):
            return []

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)

        result = await mb.compute_breadth(
            end_date=date(2026, 6, 21),
            universe={"2330"},
            lookback_days=5,
        )
        assert result["ad_line_value"] == 1.0
        assert result["divergence_dot"] is None
        assert "taiex_unavailable" in result["known_gaps"]


# ---------------------------------------------------------------------------
# Batch B — F3 _fetch_taiex_series fallback loop coverage
# ---------------------------------------------------------------------------


class TestFetchTaiexSeriesFallback:
    async def test_fetch_taiex_series_all_sid_fail_returns_empty(self, monkeypatch) -> None:
        calls: list[str] = []

        class FakeClient:
            async def _get(self, url, params):
                calls.append(params.get("data_id"))
                return []

        monkeypatch.setattr(mb, "get_finmind", lambda: FakeClient())

        end = date(2026, 12, 31)
        start = end - timedelta(days=90)
        result = await mb._fetch_taiex_series(start, end, refresh=True)

        assert result == []
        assert calls == ["TAIEX", "0001"]
        cached = mb._read_cache(f"breadth_taiex_{end.isoformat()}")
        assert cached is not None
        assert cached["rows"] == []

    async def test_fetch_taiex_series_taiex_ok_no_fallback(self, monkeypatch) -> None:
        calls: list[str] = []

        class FakeClient:
            async def _get(self, url, params):
                sid = params.get("data_id")
                calls.append(sid)
                if sid == "TAIEX":
                    return [{"date": "2026-06-30", "close": 17000.0}]
                return []

        monkeypatch.setattr(mb, "get_finmind", lambda: FakeClient())
        end = date(2026, 6, 30)
        start = end - timedelta(days=90)
        result = await mb._fetch_taiex_series(start, end, refresh=True)

        assert calls == ["TAIEX"]
        assert len(result) == 1
        assert result[0]["close"] == 17000.0

    async def test_fetch_taiex_series_all_sid_raise_propagates(self, monkeypatch) -> None:
        # TC_F3 + F1 fix — 兩 sid 全 raise httpx.HTTPError → re-raise
        # (不寫 empty cache → 避免 24h pin transient failure)
        import httpx

        class FakeClient:
            async def _get(self, url, params):
                raise httpx.HTTPError("boom")

        monkeypatch.setattr(mb, "get_finmind", lambda: FakeClient())
        end = date(2026, 12, 30)
        start = end - timedelta(days=90)
        with pytest.raises(httpx.HTTPError):
            await mb._fetch_taiex_series(start, end, refresh=True)
        # cache 不該被寫入(避免 pin transient failure 到 24h)
        assert mb._read_cache(f"breadth_taiex_{end.isoformat()}") is None


# ---------------------------------------------------------------------------
# Batch B — SC-5 edge cases
# ---------------------------------------------------------------------------


class TestComputeBreadthEdges:
    async def test_compute_breadth_empty_universe_raises(self) -> None:
        with pytest.raises(ValueError, match="universe_empty"):
            await mb.compute_breadth(
                end_date=date(2026, 6, 30),
                universe=set(),
            )

    async def test_compute_breadth_taiex_fetch_fail_divergence_null(self, monkeypatch) -> None:
        async def fake_prices(*a, **kw):
            return [
                {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
                {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            ]

        async def fake_taiex(*a, **kw):
            return []

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)
        result = await mb.compute_breadth(
            end_date=date(2026, 6, 21),
            universe={"2330"},
            lookback_days=5,
        )
        assert result["divergence_dot"] is None
        assert "taiex_unavailable" in result["known_gaps"]
        assert result["ad_line_series"]

    async def test_compute_breadth_warmup_insufficient_returns_none_signals(
        self, monkeypatch
    ) -> None:
        # TC_F4 — orchestrator handoff:< 39 天 counts → mcclellan_oscillator / thrust_dot /
        # centerline_cross 全 None;AD Line 仍算(無 warmup)
        # Fixture:2330 只 5 天,each up +1
        prices = []
        base = date(2026, 6, 1)
        dates_iso = [(base + timedelta(days=i)).isoformat() for i in range(5)]
        for i, d in enumerate(dates_iso):
            prices.append({"stock_id": "2330", "date": d, "close": 100.0 + i})

        async def fake_prices(*a, **kw):
            return prices

        async def fake_taiex(*a, **kw):
            return []  # 不影響 mcclellan warmup 判斷

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)
        result = await mb.compute_breadth(
            end_date=date(2026, 6, 5),
            universe={"2330"},
            lookback_days=3,
        )
        # 5 天 - 首日無 prev = 4 counts → 遠低於 slow=39 → mcclellan 全 None
        assert result["mcclellan_oscillator"] is None
        assert result["thrust_dot"] is None
        assert result["centerline_cross"] is None
        # AD Line 有值(累加無 warmup)
        assert isinstance(result["ad_line_value"], float)
        assert result["ad_line_series"]
