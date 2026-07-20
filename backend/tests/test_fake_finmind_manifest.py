"""MANIFEST consistency gate(R3-P0-PARSE + R4-P1 + R4-P2 + R5-P1)。

Phase 3 gate(寫紅先行,設計 design.md v6 §3 SC-2 / §6):
- test_manifest_includes_every_fixture:fixture dir 與 MANIFEST 雙向相容
- test_manifest_no_store_key_collision:non-skip entries (dataset,data_id)
  uniqueness — 防 R4-P1 互蓋 risk
- test_manifest_keys_match_real_get_call_shapes:MANIFEST dataset 名必須
  真的出現在 services/finmind*.py 的 _get literal OR URL-tail 形式 — 防
  typo dataset 致 silent MISS(R5-P1 URL-tail union 修正)

痛點(/goal):
- 沒寫第 1 個 test → fixture 新增但沒進 MANIFEST → FakeFinMindClient init
  silent 略過 → Phase 3 SC-3/4/5 silent green with empty data
- 沒寫第 2 個 test → MANIFEST 雙條對映同 key → preload last-write-wins,
  window query 降級成單日(fetch_tx_close_history 400 日 window 變 1 日)
- 沒寫第 3 個 test → MANIFEST 寫 typo dataset 名 → FakeFinMindClient._get
  lookup 永遠 MISS → silent [] → SC tautological green
"""

from __future__ import annotations

import json
import re
from pathlib import Path


_FIXTURE_DIR = Path(__file__).resolve().parent.parent / "tests_e2e" / "fixtures"
_SERVICES_DIR = Path(__file__).resolve().parent.parent / "services"


def _load_manifest() -> dict[str, dict]:
    return json.loads((_FIXTURE_DIR / "MANIFEST.json").read_text(encoding="utf-8"))


def test_manifest_includes_every_fixture():
    manifest = _load_manifest()
    actual_files = {p.name for p in _FIXTURE_DIR.glob("*.json") if p.name != "MANIFEST.json"}
    listed_files = set(manifest.keys())
    extra_in_dir = actual_files - listed_files
    extra_in_manifest = listed_files - actual_files
    assert not extra_in_dir, f"fixtures 沒列進 MANIFEST: {extra_in_dir}"
    assert not extra_in_manifest, f"MANIFEST 列了但 fixture 不存在: {extra_in_manifest}"


def test_manifest_no_store_key_collision():
    """R4-P1 鎖:non-skip_store 條目 (dataset, data_id) 不可碰撞。"""
    manifest = _load_manifest()
    non_skip = [v for v in manifest.values() if not v.get("skip_store")]
    keys = [(v["dataset"], v.get("data_id", "")) for v in non_skip]
    assert len(keys) == len(set(keys)), f"_store key collision: {keys}"


def test_manifest_keys_match_real_get_call_shapes():
    """R4-P2 + R5-P1:MANIFEST dataset 必須有 services 層 _get 真實用到。

    覆蓋兩種寫法:
    - "dataset": "Xxx" literal(在 _get params dict 內)
    - f"{_FINMIND_BASE}/<name>" URL-tail(taiwan_stock_trading_daily_report 等
      自定 path 端點,對應 FakeFinMindClient._get 的 url.rsplit('/', 1)[-1]
      fallback)
    """
    manifest = _load_manifest()
    # market-today-only(2026-07-20):services/industry_chain.py 呼叫 FinMind
    # 但檔名不合 `finmind*.py` glob(finmind-conventions per-module wrap 慣例
    # 允許任意檔名)。顯式併入掃描來源,否則新 dataset 永遠被判 unknown_in_manifest
    # 誤殺(非真的 typo / 失效 fixture)。
    scan_paths = list(_SERVICES_DIR.glob("finmind*.py")) + [_SERVICES_DIR / "industry_chain.py"]
    src = "\n".join(p.read_text(encoding="utf-8") for p in scan_paths)
    literal_datasets = set(re.findall(r'["\']dataset["\']\s*:\s*["\']([A-Za-z_][\w]*)["\']', src))
    url_datasets = set(re.findall(r"_FINMIND_BASE\}/([a-z][\w]*)", src))
    real_datasets = literal_datasets | url_datasets
    manifest_datasets = {v["dataset"] for v in manifest.values()}
    unknown_in_manifest = manifest_datasets - real_datasets
    assert not unknown_in_manifest, (
        f"MANIFEST 列了 {unknown_in_manifest} 但 services/finmind*.py 沒 _get 用到 — "
        "dataset 名拼錯或 fixture 已失效"
    )
