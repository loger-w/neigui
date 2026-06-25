"""Tests for backend.utils.cache.delete_by_prefix (SC-0 / R12 support)."""
from __future__ import annotations

from pathlib import Path

from utils.cache import atomic_write_json, chip_cache_dir, delete_by_prefix


def _write(name: str, payload: dict) -> Path:
    p = chip_cache_dir() / f"{name}.json"
    atomic_write_json(p, payload)
    return p


def test_delete_by_prefix_returns_count_zero_when_no_match(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    _write("unrelated_key", {"x": 1})
    assert delete_by_prefix("max_pain_") == 0
    # unrelated file untouched
    assert (chip_cache_dir() / "unrelated_key.json").exists()


def test_delete_by_prefix_removes_matching_files_only(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    _write("max_pain_TXO202607_2026-06-25_lb20", {"v": 1})
    _write("max_pain_TXO202608_2026-06-25_lb20", {"v": 2})
    _write("oi_walls_TXO202607_2026-06-25_lb20_dw5", {"v": 3})
    _write("unrelated", {"v": 4})

    deleted = delete_by_prefix("max_pain_TXO202607_2026-06-25_")

    assert deleted == 1
    assert not (chip_cache_dir() / "max_pain_TXO202607_2026-06-25_lb20.json").exists()
    # different contract not deleted
    assert (chip_cache_dir() / "max_pain_TXO202608_2026-06-25_lb20.json").exists()
    # different endpoint not deleted
    assert (chip_cache_dir() / "oi_walls_TXO202607_2026-06-25_lb20_dw5.json").exists()
    # unrelated file not deleted
    assert (chip_cache_dir() / "unrelated.json").exists()


def test_delete_by_prefix_invalidates_across_lookback_variants(tmp_path, monkeypatch):
    """N12 修:refresh on max_pain must invalidate ALL lookback variants
    (different lookback values produce different cache keys but share the
    same upstream window data — they're all stale together)."""
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    contract_date_prefix = "max_pain_TXO202607_2026-06-25_"
    _write(f"{contract_date_prefix}lb20", {"v": 1})
    _write(f"{contract_date_prefix}lb30", {"v": 2})
    _write(f"{contract_date_prefix}lb50", {"v": 3})

    deleted = delete_by_prefix(contract_date_prefix)

    assert deleted == 3
    assert not any(p.name.startswith(contract_date_prefix) for p in chip_cache_dir().iterdir())


def test_delete_by_prefix_ignores_non_json_files(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    (chip_cache_dir() / "max_pain_TXO_2026-06-25_lb20.txt").write_text("noise")
    _write("max_pain_TXO_2026-06-25_lb20", {"v": 1})

    deleted = delete_by_prefix("max_pain_")

    assert deleted == 1  # only the .json removed
    assert (chip_cache_dir() / "max_pain_TXO_2026-06-25_lb20.txt").exists()
