"""Futures dataset schema probe for options-page-v2 (SC-4 / SC-5).

One-off script; sister to ``tests/fixtures/options_chip/probe.py``. Fetches
sample + window payloads for the two futures datasets the retail-MTX /
foreign-futures endpoints depend on, and writes:

1. ``backend/tests/fixtures/futures/probe/{name}.json``
   — raw payloads for parser fixtures + schema-drift checks.
2. ``backend/tests_e2e/fixtures/{Dataset}_{data_id}_{start}_{end}.json``
   — FAKE_FINMIND e2e fixtures (baseline window aligned with the existing
   2026-06-26 fixture set; MANIFEST entries added in the same commit).

Probed datasets (schema verified live 2026-07-07, see
``.claude/feat/options-page-v2/probe-futures-2026-07-07.md``):
- ``TaiwanFuturesDaily`` data_id=MTX
    total OI lives ONLY on trading_session == "position" rows
    (after_market rows carry open_interest == 0); contract_date includes
    weekly contracts (e.g. ``202607W2``).
- ``TaiwanFuturesInstitutionalInvestors`` data_id=MTX / TX
    product-level rows (no contract_date); keys: institutional_investors
    (外資/自營商/投信), long/short_open_interest_balance_volume.

Run from project root:

    cd backend && python -m tests.fixtures.futures.probe

Reads ``FINMIND_TOKEN`` from ``backend/.env``. Sponsor tier requires the
``Authorization: Bearer`` header (NOT ``?token=`` query).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
PROBE_DIR = Path(__file__).parent / "probe"
E2E_FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests_e2e" / "fixtures"
SENSITIVE_KEYS = ("__user", "__tier", "user", "tier")

# e2e clock-frozen baseline (keep aligned with e2e-conventions fixture set;
# update both together on fixture rotation)
E2E_END = "2026-06-26"
E2E_START = "2026-05-26"

# pytest parser-fixture window: 20 trading days ≈ 40 calendar days
PYTEST_END = "2026-07-06"
PYTEST_START = "2026-05-26"


def _load_token() -> str:
    load_dotenv()
    token = os.environ.get("FINMIND_TOKEN", "").strip()
    if not token:
        sys.exit("error: FINMIND_TOKEN missing in backend/.env")
    return token


def _sanitize(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if k not in SENSITIVE_KEYS}


def _get(client: httpx.Client, dataset: str, params: dict[str, Any], token: str) -> dict[str, Any]:
    full = {"dataset": dataset, **params}
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get(FINMIND_URL, params=full, headers=headers)
    if r.status_code >= 400:
        print(f"  !! HTTP {r.status_code}: body={r.text[:500]}")
        r.raise_for_status()
    return r.json()


def _save(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_sanitize(payload), ensure_ascii=False, indent=2), encoding="utf-8")
    rows = payload.get("data", [])
    print(f"  -> {path.name}: {len(rows)} rows")
    if rows:
        print(f"     sample row keys = {sorted(rows[0].keys())}")


def main() -> None:
    token = _load_token()
    jobs_probe = [
        ("TaiwanFuturesDaily_MTX_window", "TaiwanFuturesDaily", "MTX", PYTEST_START, PYTEST_END),
        (
            "TaiwanFuturesInstitutionalInvestors_MTX_window",
            "TaiwanFuturesInstitutionalInvestors",
            "MTX",
            PYTEST_START,
            PYTEST_END,
        ),
        (
            "TaiwanFuturesInstitutionalInvestors_TX_window",
            "TaiwanFuturesInstitutionalInvestors",
            "TX",
            PYTEST_START,
            PYTEST_END,
        ),
    ]
    jobs_e2e = [
        ("TaiwanFuturesDaily", "MTX"),
        ("TaiwanFuturesInstitutionalInvestors", "MTX"),
        ("TaiwanFuturesInstitutionalInvestors", "TX"),
    ]
    with httpx.Client(timeout=30.0) as client:
        print("probe fixtures (pytest):")
        for name, dataset, data_id, start, end in jobs_probe:
            payload = _get(
                client,
                dataset,
                {"data_id": data_id, "start_date": start, "end_date": end},
                token,
            )
            _save(PROBE_DIR / f"{name}.json", payload)

        print("e2e FAKE fixtures:")
        for dataset, data_id in jobs_e2e:
            payload = _get(
                client,
                dataset,
                {"data_id": data_id, "start_date": E2E_START, "end_date": E2E_END},
                token,
            )
            _save(E2E_FIXTURE_DIR / f"{dataset}_{data_id}_{E2E_START}_{E2E_END}.json", payload)

    print("done. Remember: add MANIFEST.json entries in the SAME commit.")


if __name__ == "__main__":
    main()
