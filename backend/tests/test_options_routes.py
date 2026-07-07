"""Tests for routes/options.py — options API endpoints."""

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def mock_fm():
    """Mocks default to as_of_date == requested date (no banner). Individual
    tests override as_of_date to exercise the mismatch / banner path."""
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_oi_large_traders = AsyncMock(
        return_value={
            "contract": "TXO202607",
            "date": today,
            "fetched_at": "x",
            "current": {"top5_prop": {"long": 1, "short": 1, "net": 0}},
            "series": [{"date": today, "top10_all_net": 1, "top10_prop_net": 1}],
            "as_of_date": today,
        }
    )
    svc.fetch_strike_volume = AsyncMock(
        return_value={
            "contract": "TXO202607",
            "date": today,
            "fetched_at": "x",
            "call": [],
            "put": [],
            "as_of_date": today,
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def _today():
    return date.today().isoformat()


def test_oi_lt_requires_contract():
    resp = TestClient(app).get("/api/options/oi_large_traders")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "contract_required"


def test_oi_lt_invalid_contract_400():
    resp = TestClient(app).get(
        "/api/options/oi_large_traders?contract=BOGUS999999",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "invalid_contract"


def test_oi_lt_happy_path(mock_fm):
    from services.finmind_options import list_active_contracts

    contract = list_active_contracts(date.today())[0]
    code = f"{contract['option_id']}{contract['contract_date']}"
    resp = TestClient(app).get(f"/api/options/oi_large_traders?contract={code}")
    assert resp.status_code == 200
    assert resp.json()["contract"] == "TXO202607"
    mock_fm.fetch_oi_large_traders.assert_awaited_once()


def test_strike_vol_silently_ignores_legacy_top_n_param(mock_fm):
    """Stale URL with ?top_n=N from v1 callers should not 400; param is just
    ignored (FastAPI default behavior for undeclared query params)."""
    code = _today_code_via_helper()
    resp = TestClient(app).get(
        f"/api/options/strike_volume?contract={code}&top_n=99",
    )
    assert resp.status_code == 200


def test_strike_vol_happy_path(mock_fm):
    from services.finmind_options import list_active_contracts

    code = f"{list_active_contracts(date.today())[0]['option_id']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(f"/api/options/strike_volume?contract={code}")
    assert resp.status_code == 200
    assert resp.json()["call"] == []
    mock_fm.fetch_strike_volume.assert_awaited_once()


def test_oi_lt_no_trading_day_when_as_of_date_is_none(mock_fm):
    """FinMind returned nothing → as_of_date is None → banner fires."""
    mock_fm.fetch_oi_large_traders.return_value = {
        "contract": "TXO202607",
        "date": _today(),
        "fetched_at": "x",
        "current": {
            "top5_prop": {"long": 0, "short": 0, "net": 0},
            "top10_prop": {"long": 0, "short": 0, "net": 0},
            "top5_all": {"long": 0, "short": 0, "net": 0},
            "top10_all": {"long": 0, "short": 0, "net": 0},
        },
        "series": [],
        "as_of_date": None,
    }
    from services.finmind_options import list_active_contracts

    code = f"{list_active_contracts(date.today())[0]['option_id']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(f"/api/options/oi_large_traders?contract={code}")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_oi_lt_no_trading_day_when_requested_date_differs_from_as_of(mock_fm):
    """User picks Saturday 2026-06-20, parser falls back to Friday 2026-06-19
    → as_of_date != requested → banner fires. This is the Scenario 5 bug fix."""
    saturday = "2026-06-20"
    friday = "2026-06-19"
    mock_fm.fetch_oi_large_traders.return_value = {
        "contract": "TXO202607",
        "date": saturday,
        "fetched_at": "x",
        "current": {
            "top5_prop": {"long": 100, "short": 50, "net": 50},
            "top10_prop": {"long": 200, "short": 100, "net": 100},
            "top5_all": {"long": 300, "short": 200, "net": 100},
            "top10_all": {"long": 400, "short": 300, "net": 100},
        },
        "series": [{"date": friday, "top10_all_net": 100, "top10_prop_net": 100}],
        "as_of_date": friday,
    }
    from services.finmind_options import list_active_contracts

    code = f"{list_active_contracts(date.today())[0]['option_id']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(
        f"/api/options/oi_large_traders?contract={code}&date={saturday}",
    )
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_oi_lt_no_banner_when_requested_date_matches_as_of(mock_fm):
    """Real trading day with current-date data → no banner."""
    code = _today_code_via_helper()
    resp = TestClient(app).get(f"/api/options/oi_large_traders?contract={code}")
    assert resp.status_code == 200
    # Default mock_fm fixture has as_of_date == _today, so banner must NOT fire
    assert resp.json().get("no_trading_day") is None


def test_strike_vol_no_trading_day_when_requested_date_differs_from_as_of(mock_fm):
    """Strike volume parser falls back to Friday on a Saturday request →
    banner fires. The actual bug from Workflow D Scenario 5."""
    saturday = "2026-06-20"
    friday = "2026-06-19"
    mock_fm.fetch_strike_volume.return_value = {
        "contract": "TXO202607",
        "date": saturday,
        "fetched_at": "x",
        "call": [{"strike": 22000, "volume": 10000, "oi": 30000, "oi_change": 100}],
        "put": [{"strike": 21500, "volume": 8000, "oi": 25000, "oi_change": 50}],
        "as_of_date": friday,
    }
    code = _today_code_via_helper()
    resp = TestClient(app).get(
        f"/api/options/strike_volume?contract={code}&date={saturday}",
    )
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_strike_vol_no_banner_when_requested_date_matches_as_of(mock_fm):
    code = _today_code_via_helper()
    # Default mock returns as_of_date == today (no banner expected).
    resp = TestClient(app).get(f"/api/options/strike_volume?contract={code}")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is None


def _today_code_via_helper() -> str:
    from services.finmind_options import list_active_contracts

    c = list_active_contracts(date.today())[0]
    return f"{c['option_id']}{c['contract_date']}"


@pytest.fixture
def mock_fm_with_spot():
    """Mocks default to as_of_date == today (no banner)."""
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_spot = AsyncMock(
        return_value={
            "date": today,
            "fetched_at": "x",
            "as_of_date": today,
            "spot": 53420.0,
            "prev_close": 53300.0,
            "change": 120.0,
            "change_pct": 0.2251,
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_spot_happy_path(mock_fm_with_spot):
    resp = TestClient(app).get("/api/options/spot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["spot"] == 53420.0
    assert body["change"] == 120.0
    assert body.get("no_trading_day") is None
    mock_fm_with_spot.fetch_spot.assert_awaited_once()


def test_spot_no_trading_day_when_as_of_differs(mock_fm_with_spot):
    """Saturday request; FinMind returns Friday data."""
    saturday = "2026-06-20"
    friday = "2026-06-19"
    mock_fm_with_spot.fetch_spot.return_value = {
        "date": saturday,
        "fetched_at": "x",
        "as_of_date": friday,
        "spot": 53300.0,
        "prev_close": 53180.0,
        "change": 120.0,
        "change_pct": 0.2257,
    }
    resp = TestClient(app).get(f"/api/options/spot?date={saturday}")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_spot_finmind_error_502(mock_fm_with_spot):
    import httpx

    mock_fm_with_spot.fetch_spot.side_effect = httpx.ConnectError("boom")
    resp = TestClient(app).get("/api/options/spot")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_error"


# ============================================================================
# SC-1 / SC-5: /api/options/max_pain route
# ============================================================================


@pytest.fixture
def mock_fm_with_max_pain():
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_max_pain = AsyncMock(
        return_value={
            "contract": "TXO202607",
            "date": today,
            "fetched_at": "x",
            "as_of_date": today,
            "current": {
                "max_pain": 21000,
                "total_loss_ntd": 10_000_000,
                "strike_count": 3,
                "strikes_with_call_oi_only": 0,
                "strikes_with_put_oi_only": 0,
            },
            "hit_rate": None,
            "latest_settlement_pending": False,
            "data_quality_warnings": [],
            "insufficient_data": {"reason": "no_settlements_fetched_in_mvp", "required_days": 0},
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_max_pain_requires_contract():
    resp = TestClient(app).get("/api/options/max_pain")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "contract_required"


def test_max_pain_invalid_contract_400():
    resp = TestClient(app).get("/api/options/max_pain?contract=BOGUS999")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "invalid_contract"


def test_max_pain_lookback_exceeds_canonical_window_400():
    """N11: lookback × 21 (worst-case monthly) > CHIP_WINDOW_TD=250 → 400."""
    from services.finmind_options import list_active_contracts

    today = date.today()
    c = next(iter(list_active_contracts(today)))
    contract_id = f"{c['option_id']}{c['contract_date']}"
    # 50 settled contracts × 21 td/month = 1050 > 250 → invariant violated
    resp = TestClient(app).get(f"/api/options/max_pain?contract={contract_id}&lookback=50")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "lookback_exceeds_canonical_window"


def test_max_pain_happy_path(mock_fm_with_max_pain):
    from services.finmind_options import list_active_contracts

    today = date.today()
    c = next(iter(list_active_contracts(today)))
    contract_id = f"{c['option_id']}{c['contract_date']}"
    resp = TestClient(app).get(f"/api/options/max_pain?contract={contract_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"]["max_pain"] == 21000
    assert body["current"]["total_loss_ntd"] == 10_000_000


def test_max_pain_no_trading_day_banner(mock_fm_with_max_pain):
    from services.finmind_options import list_active_contracts

    today = date.today()
    c = next(iter(list_active_contracts(today)))
    contract_id = f"{c['option_id']}{c['contract_date']}"
    # Override as_of_date to differ from requested → banner
    mock_fm_with_max_pain.fetch_max_pain.return_value = {
        **mock_fm_with_max_pain.fetch_max_pain.return_value,
        "as_of_date": "2026-06-20",
    }
    resp = TestClient(app).get(f"/api/options/max_pain?contract={contract_id}&date=2026-06-21")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_max_pain_finmind_error_502(mock_fm_with_max_pain):
    import httpx
    from services.finmind_options import list_active_contracts

    today = date.today()
    c = next(iter(list_active_contracts(today)))
    contract_id = f"{c['option_id']}{c['contract_date']}"
    mock_fm_with_max_pain.fetch_max_pain.side_effect = httpx.ConnectError("boom")
    resp = TestClient(app).get(f"/api/options/max_pain?contract={contract_id}")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_error"


# ============================================================================
# SC-2 / SC-6: /api/options/oi_walls route
# ============================================================================


@pytest.fixture
def mock_fm_with_oi_walls():
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_oi_walls = AsyncMock(
        return_value={
            "contract": "TXO202607",
            "date": today,
            "fetched_at": "x",
            "as_of_date": today,
            "current": {
                "static_call_wall": {"strike": 22000, "oi": 500},
                "static_put_wall": {"strike": 20000, "oi": 500},
                "dynamic_call_wall": {
                    "strike": 22000,
                    "window_net_increase_oi": 800,
                    "partial_window": False,
                },
                "dynamic_put_wall": {
                    "strike": 20000,
                    "window_net_increase_oi": 600,
                    "partial_window": False,
                },
                "band_width_pct": 9.5,
                "data_quality_warnings": [],
            },
            "hit_rate": None,
            "latest_settlement_pending": False,
            "data_quality_warnings": [],
            "insufficient_data": None,
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_oi_walls_happy_path(mock_fm_with_oi_walls):
    from services.finmind_options import list_active_contracts

    today = date.today()
    c = next(iter(list_active_contracts(today)))
    contract_id = f"{c['option_id']}{c['contract_date']}"
    resp = TestClient(app).get(f"/api/options/oi_walls?contract={contract_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"]["static_call_wall"]["strike"] == 22000


def test_oi_walls_requires_contract():
    resp = TestClient(app).get("/api/options/oi_walls")
    assert resp.status_code == 400


# ============================================================================
# SC-3 / SC-7: /api/options/pcr route
# ============================================================================


@pytest.fixture
def mock_fm_with_pcr():
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_pcr = AsyncMock(
        return_value={
            "date": today,
            "scope": "all_months",
            "contract": None,
            "fetched_at": "x",
            "as_of_date": today,
            "current": {
                "pcr": 0.85,
                "percentile": 65.0,
                "region": "neutral",
                "thresholds": {"high_pct": 70.0, "low_pct": 30.0},
            },
            "next_day_stats": None,
            "data_quality_warnings": [],
            "insufficient_data": None,
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_pcr_route_per_contract_missing_contract_400():
    resp = TestClient(app).get("/api/options/pcr?scope=per_contract")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "missing_contract_for_per_contract_scope"


def test_pcr_route_all_months_with_contract_400():
    from services.finmind_options import list_active_contracts

    today = date.today()
    c = next(iter(list_active_contracts(today)))
    contract_id = f"{c['option_id']}{c['contract_date']}"
    resp = TestClient(app).get(f"/api/options/pcr?scope=all_months&contract={contract_id}")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "contract_not_applicable_for_scope"


def test_pcr_route_invalid_scope_400():
    resp = TestClient(app).get("/api/options/pcr?scope=bogus")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "invalid_scope"


def test_pcr_route_all_months_happy(mock_fm_with_pcr):
    resp = TestClient(app).get("/api/options/pcr")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"]["region"] == "neutral"


# ============================================================================
# SC-4 / SC-8: /api/options/institutional route
# ============================================================================


@pytest.fixture
def mock_fm_with_inst():
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_institutional = AsyncMock(
        return_value={
            "date": today,
            "fetched_at": "x",
            "as_of_date": today,
            "current": {
                "foreign": {"call_net": 500, "put_net": -300, "total_net": 200, "day_change": 0},
                "dealer": {"call_net": 100, "put_net": 50, "total_net": 150, "day_change": 0},
                "trust": {"call_net": 20, "put_net": -10, "total_net": 10, "day_change": 0},
                "session_breakdown": {"day_session": {}, "after_hours": None},
            },
            "correlation": None,
            "data_quality_warnings": [],
            "insufficient_data": None,
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_institutional_happy_path(mock_fm_with_inst):
    resp = TestClient(app).get("/api/options/institutional")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"]["foreign"]["call_net"] == 500
    assert "dealer" in body["current"]  # F3-int: NOT prop
    assert "prop" not in body["current"]


# ============================================================================
# options-page-v2 SC-4 / SC-5: /api/options/retail_mtx + /foreign_futures
# ============================================================================


@pytest.fixture
def mock_fm_futures():
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_retail_mtx = AsyncMock(
        return_value={
            "date": today,
            "fetched_at": "x",
            "as_of_date": today,
            "current": {"retail_long": 36000, "retail_short": 31000, "ratio": 0.12},
            "series": [{"date": today, "ratio": 0.12}],
            "dropped_days": 0,
            "data_quality_warnings": [],
        }
    )
    svc.fetch_foreign_futures = AsyncMock(
        return_value={
            "date": today,
            "fetched_at": "x",
            "as_of_date": today,
            "current": {"long_oi": 6178, "short_oi": 87230, "net_oi": -81052},
            "series": [{"date": today, "net_oi": -81052}],
            "data_quality_warnings": [],
        }
    )
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_retail_mtx_happy(mock_fm_futures):
    resp = TestClient(app).get("/api/options/retail_mtx")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"]["ratio"] == 0.12
    assert body["series"][0]["ratio"] == 0.12
    assert body.get("no_trading_day") is None
    mock_fm_futures.fetch_retail_mtx.assert_awaited_once()


def test_retail_mtx_no_trading_day_when_as_of_none(mock_fm_futures):
    mock_fm_futures.fetch_retail_mtx.return_value = {
        "date": _today(),
        "fetched_at": "x",
        "as_of_date": None,
        "current": None,
        "series": [],
        "dropped_days": 0,
        "data_quality_warnings": [],
    }
    resp = TestClient(app).get("/api/options/retail_mtx")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_retail_mtx_missing_inst_days_warning(mock_fm_futures):
    """SC-4 / impl-review R3:缺法人日的 warning + dropped_days 透出 route。"""
    today = _today()
    mock_fm_futures.fetch_retail_mtx.return_value = {
        "date": today,
        "fetched_at": "x",
        "as_of_date": today,
        "current": {"retail_long": 36000, "retail_short": 31000, "ratio": 0.12},
        "series": [{"date": today, "ratio": 0.12}],
        "dropped_days": 3,
        "data_quality_warnings": ["retail_mtx_days_dropped"],
    }
    resp = TestClient(app).get("/api/options/retail_mtx")
    assert resp.status_code == 200
    body = resp.json()
    assert body["dropped_days"] == 3
    assert "retail_mtx_days_dropped" in body["data_quality_warnings"]


def test_retail_mtx_finmind_error_502(mock_fm_futures):
    import httpx

    mock_fm_futures.fetch_retail_mtx.side_effect = httpx.ConnectError("boom")
    resp = TestClient(app).get("/api/options/retail_mtx")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_error"


def test_foreign_futures_happy(mock_fm_futures):
    resp = TestClient(app).get("/api/options/foreign_futures")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"]["net_oi"] == -81052
    mock_fm_futures.fetch_foreign_futures.assert_awaited_once()


def test_foreign_futures_no_trading_day_when_as_of_none(mock_fm_futures):
    mock_fm_futures.fetch_foreign_futures.return_value = {
        "date": _today(),
        "fetched_at": "x",
        "as_of_date": None,
        "current": None,
        "series": [],
        "data_quality_warnings": [],
    }
    resp = TestClient(app).get("/api/options/foreign_futures")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True
