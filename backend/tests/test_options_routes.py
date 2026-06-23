"""Tests for routes/options.py — options API endpoints."""
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def mock_fm():
    svc = AsyncMock()
    svc.fetch_oi_large_traders = AsyncMock(return_value={
        "contract": "TXO202607", "date": "2026-06-23", "fetched_at": "x",
        "current": {"top5_prop": {"long": 1, "short": 1, "net": 0}},
        "series": [],
    })
    svc.fetch_strike_volume = AsyncMock(return_value={
        "contract": "TXO202607", "date": "2026-06-23", "fetched_at": "x",
        "call": [], "put": [],
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


def test_oi_lt_no_trading_day_returns_200_with_flag(mock_fm):
    """When FinMind returns no rows for today, route returns 200 + flag."""
    mock_fm.fetch_oi_large_traders.return_value = {
        "contract": "TXO202607", "date": _today(), "fetched_at": "x",
        "current": {
            "top5_prop": {"long": 0, "short": 0, "net": 0},
            "top10_prop": {"long": 0, "short": 0, "net": 0},
            "top5_all":  {"long": 0, "short": 0, "net": 0},
            "top10_all": {"long": 0, "short": 0, "net": 0},
        },
        "series": [],
    }
    from services.finmind_options import list_active_contracts
    code = f"{list_active_contracts(date.today())[0]['option_id']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(f"/api/options/oi_large_traders?contract={code}")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("no_trading_day") is True
