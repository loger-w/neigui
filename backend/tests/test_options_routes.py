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
    svc.fetch_oi_large_traders = AsyncMock(return_value={
        "contract": "TXO202607", "date": today, "fetched_at": "x",
        "current": {"top5_prop": {"long": 1, "short": 1, "net": 0}},
        "series": [{"date": today, "top10_all_net": 1, "top10_prop_net": 1}],
        "as_of_date": today,
    })
    svc.fetch_strike_volume = AsyncMock(return_value={
        "contract": "TXO202607", "date": today, "fetched_at": "x",
        "call": [], "put": [], "as_of_date": today,
    })
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


def test_strike_vol_top_n_out_of_range_400():
    from services.finmind_options import list_active_contracts
    code = f"{list_active_contracts(date.today())[0]['option_id']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(
        f"/api/options/strike_volume?contract={code}&top_n=99",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "top_n_out_of_range"


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
        "contract": "TXO202607", "date": _today(), "fetched_at": "x",
        "current": {
            "top5_prop": {"long": 0, "short": 0, "net": 0},
            "top10_prop": {"long": 0, "short": 0, "net": 0},
            "top5_all":  {"long": 0, "short": 0, "net": 0},
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
        "contract": "TXO202607", "date": saturday, "fetched_at": "x",
        "current": {
            "top5_prop":  {"long": 100, "short": 50,  "net": 50},
            "top10_prop": {"long": 200, "short": 100, "net": 100},
            "top5_all":   {"long": 300, "short": 200, "net": 100},
            "top10_all":  {"long": 400, "short": 300, "net": 100},
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
        "contract": "TXO202607", "date": saturday, "fetched_at": "x",
        "call": [{"strike": 22000, "volume": 10000, "oi": 30000, "oi_change": 100}],
        "put":  [{"strike": 21500, "volume":  8000, "oi": 25000, "oi_change":  50}],
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
