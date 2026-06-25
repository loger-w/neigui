"""SC-0: FinMind dataset schema probe for txo-chip-framework MVP1.

One-off script that fetches sample rows from the 5 datasets the new chip
pipeline depends on, and writes the raw payloads to
``backend/tests/fixtures/options_chip/probe/`` for downstream parser fixtures.

Probed datasets:
- ``TaiwanOptionDaily``               -> per-strike OI/volume
- ``TaiwanOptionInstitutionalInvestors``           -> 日盤 法人買賣權
- ``TaiwanOptionInstitutionalInvestorsAfterHours`` -> 夜盤 (>= 2021-10-13)
- ``TaiwanOptionFinalSettlementPrice``             -> 結算價 (for SC-5/SC-6 hit rate)
- ``TaiwanFuturesDaily``                            -> TX returns + trading-day calendar

Also tests whether the institutional datasets accept ``start_date``/``end_date``
range queries (open question C1 in design-review-round-3.json).

Run from project root:

    cd backend && python -m tests.fixtures.options_chip.probe

Reads ``FINMIND_TOKEN`` from ``backend/.env`` (loaded by python-dotenv).
Output: ``backend/tests/fixtures/options_chip/probe/{dataset}.json``
(one file per dataset, raw JSON envelope).

The probe sanitises auth-identifying metadata (``__user``, ``__tier``)
before writing so committed files do not leak the token tier.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
PROBE_DIR = Path(__file__).parent / "probe"
SENSITIVE_KEYS = ("__user", "__tier", "user", "tier")


def _load_token() -> str:
    """Load FINMIND_TOKEN from backend/.env (run from backend/ cwd)."""
    load_dotenv()
    token = os.environ.get("FINMIND_TOKEN", "").strip()
    if not token:
        sys.exit("error: FINMIND_TOKEN missing in backend/.env")
    return token


def _sanitize(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop auth-identifying metadata so committed probe files do not leak tier."""
    return {k: v for k, v in payload.items() if k not in SENSITIVE_KEYS}


def _save(name: str, payload: dict[str, Any]) -> None:
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    out = PROBE_DIR / f"{name}.json"
    out.write_text(json.dumps(_sanitize(payload), ensure_ascii=False, indent=2))
    rows = payload.get("data", [])
    print(f"  -> {out.name}: {len(rows)} rows, top-level keys={sorted(payload.keys())}")
    if rows:
        print(f"     sample row keys = {sorted(rows[0].keys())}")


def _get(client: httpx.Client, dataset: str, params: dict[str, Any], token: str) -> dict[str, Any]:
    """Sponsor tier requires Bearer header (not ?token= query)."""
    full = {"dataset": dataset, **params}
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get(FINMIND_URL, params=full, headers=headers)
    if r.status_code >= 400:
        print(f"  !! HTTP {r.status_code}: body={r.text[:500]}")
        r.raise_for_status()
    return r.json()


def _recent_weekday(offset_days: int = 1) -> date:
    """Walk back from today to a likely-already-published trading day."""
    d = date.today() - timedelta(days=offset_days)
    while d.weekday() >= 5:  # 5=Sat, 6=Sun
        d -= timedelta(days=1)
    return d


def probe_taiwan_option_daily(client: httpx.Client, token: str, target: date) -> None:
    """SC-1/SC-2/SC-3 base data: per-strike OI/volume for all TXO contracts on one day."""
    print(f"[1/5] TaiwanOptionDaily on {target} (data_id=TXO)")
    payload = _get(client, "TaiwanOptionDaily", {
        "data_id": "TXO", "start_date": target.isoformat(),
        "end_date": target.isoformat()}, token)
    _save("taiwan_option_daily", payload)


def probe_taiwan_option_institutional(client: httpx.Client, token: str, target: date) -> None:
    """SC-4 day session: 三大法人買賣權. Also probe whether range query works (C1)."""
    print(f"[2/5] TaiwanOptionInstitutionalInvestors single day {target}")
    single = _get(client, "TaiwanOptionInstitutionalInvestors", {
        "data_id": "TXO", "start_date": target.isoformat(),
        "end_date": target.isoformat()}, token)
    _save("taiwan_option_institutional_single", single)

    week_ago = target - timedelta(days=7)
    print(f"[2.5/5] TaiwanOptionInstitutionalInvestors range {week_ago}..{target} (C1 check)")
    ranged = _get(client, "TaiwanOptionInstitutionalInvestors", {
        "data_id": "TXO", "start_date": week_ago.isoformat(),
        "end_date": target.isoformat()}, token)
    _save("taiwan_option_institutional_range", ranged)
    print(f"     C1 result: range returns {len(ranged.get('data', []))} rows (>1 row => range supported)")


def probe_taiwan_option_institutional_after_hours(
    client: httpx.Client, token: str, target: date
) -> None:
    """SC-4 night session. Probe earliest available date too (R3 check)."""
    print(f"[3/5] TaiwanOptionInstitutionalInvestorsAfterHours single day {target}")
    payload = _get(client, "TaiwanOptionInstitutionalInvestorsAfterHours", {
        "data_id": "TXO", "start_date": target.isoformat(),
        "end_date": target.isoformat()}, token)
    _save("taiwan_option_institutional_after_hours_single", payload)

    print("[3.5/5] AfterHours range 2021-10-11..2021-10-15 (R3 earliest-available probe)")
    early = _get(client, "TaiwanOptionInstitutionalInvestorsAfterHours", {
        "data_id": "TXO", "start_date": "2021-10-11",
        "end_date": "2021-10-15"}, token)
    _save("taiwan_option_institutional_after_hours_earliest", early)
    if early.get("data"):
        first_date = min(row["date"] for row in early["data"])
        print(f"     R3 result: earliest AfterHours row in 2021-10-11..15 = {first_date}")
    else:
        print("     R3 result: NO data in 2021-10-11..15 — earliest available is later")


def probe_taiwan_option_final_settlement_price(
    client: httpx.Client, token: str, end: date
) -> None:
    """SC-5/SC-6 hit rate ground truth. Pull last 6 months of settlements."""
    start = end - timedelta(days=180)
    print(f"[4/5] TaiwanOptionFinalSettlementPrice {start}..{end}")
    payload = _get(client, "TaiwanOptionFinalSettlementPrice", {
        "data_id": "TXO", "start_date": start.isoformat(),
        "end_date": end.isoformat()}, token)
    _save("taiwan_option_final_settlement_price", payload)


def probe_taiwan_futures_daily(client: httpx.Client, token: str, end: date) -> None:
    """SC-7 tx_returns + trading-day calendar + R9 publication-lag check."""
    start = end - timedelta(days=45)
    print(f"[5/5] TaiwanFuturesDaily TX {start}..{end} (publication-lag check)")
    payload = _get(client, "TaiwanFuturesDaily", {
        "data_id": "TX", "start_date": start.isoformat(),
        "end_date": end.isoformat()}, token)
    _save("taiwan_futures_daily", payload)
    rows = payload.get("data", [])
    if rows:
        latest = max(row["date"] for row in rows)
        print(f"     R9 result: latest TaiwanFuturesDaily row = {latest} (probe ran {end})")


def main() -> None:
    token = _load_token()
    # Use end_date 2 trading days back to dodge publication lag
    end = _recent_weekday(offset_days=3)
    with httpx.Client(timeout=30.0) as client:
        probe_taiwan_option_daily(client, token, end)
        probe_taiwan_option_institutional(client, token, end)
        probe_taiwan_option_institutional_after_hours(client, token, end)
        probe_taiwan_option_final_settlement_price(client, token, end)
        probe_taiwan_futures_daily(client, token, end)
    print(f"\nSC-0 probe complete. Outputs in: {PROBE_DIR}")


if __name__ == "__main__":
    main()
