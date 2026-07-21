"""mod/market-today-only — services/industry_chain.py.

Spec: .claude/mod/market-today-only/change-spec.md §3(新資料源)/ §4 Backend A。

覆蓋:
- cache 命中零 call
- TTL 過期重抓
- FAKE_FINMIND=1 不落檔(只用 mem)
- 失敗 propagate(不 swallow)
- rows → map 轉換正確(含同股多桶)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import httpx
import pytest

import services.industry_chain as ic


@pytest.fixture(autouse=True)
def _reset_industry_chain_module_state(monkeypatch):
    """每測試起點清 module-level mem cache(FAKE 分支專用 mem cache 沒有
    conftest autouse 覆蓋,需要自己重置;_inflight 已由 conftest
    _reset_realtime_task_registries 統一清)。"""
    monkeypatch.setattr(ic, "_mem_cache", None)


# ---------------------------------------------------------------------------
# rows → map(純函式)
# ---------------------------------------------------------------------------


def test_rows_to_map_builds_industry_sub_structure() -> None:
    rows = [
        {"stock_id": "2330", "industry": "半導體業", "sub_industry": "晶圓代工", "date": "2026-06-26"},
        {"stock_id": "2454", "industry": "半導體業", "sub_industry": "IC設計", "date": "2026-06-26"},
        {"stock_id": "2412", "industry": "電子零組件業", "sub_industry": "被動元件", "date": "2026-06-26"},
    ]
    out = ic._rows_to_map(rows)
    assert out == {
        "半導體業": {"晶圓代工": ["2330"], "IC設計": ["2454"]},
        "電子零組件業": {"被動元件": ["2412"]},
    }


def test_rows_to_map_dedups_same_stock_same_bucket() -> None:
    """同一 (industry, sub_industry) 內同 stock_id 重複列(上游髒資料)只留一次。"""
    rows = [
        {"stock_id": "2330", "industry": "半導體業", "sub_industry": "晶圓代工", "date": "2026-06-26"},
        {"stock_id": "2330", "industry": "半導體業", "sub_industry": "晶圓代工", "date": "2026-06-27"},
    ]
    out = ic._rows_to_map(rows)
    assert out["半導體業"]["晶圓代工"] == ["2330"]


def test_rows_to_map_same_stock_multiple_buckets_allowed() -> None:
    """一檔多桶(集團股):同 stock_id 出現在不同 (industry, sub) 皆保留(SC-3)。"""
    rows = [
        {"stock_id": "1303", "industry": "塑膠工業", "sub_industry": "泛用塑膠", "date": "2026-06-26"},
        {"stock_id": "1303", "industry": "電子零組件業", "sub_industry": "被動元件", "date": "2026-06-26"},
    ]
    out = ic._rows_to_map(rows)
    assert out["塑膠工業"]["泛用塑膠"] == ["1303"]
    assert out["電子零組件業"]["被動元件"] == ["1303"]


def test_rows_to_map_skips_incomplete_rows() -> None:
    rows = [
        {"stock_id": "2330", "industry": "半導體業", "sub_industry": "", "date": "2026-06-26"},
        {"stock_id": "", "industry": "半導體業", "sub_industry": "IC設計", "date": "2026-06-26"},
        {"stock_id": "2454", "industry": None, "sub_industry": "IC設計", "date": "2026-06-26"},
    ]
    out = ic._rows_to_map(rows)
    assert out == {}


# ---------------------------------------------------------------------------
# get_chain — disk cache / TTL / dedup(real mode)
# ---------------------------------------------------------------------------


_ROWS = [
    {"stock_id": "2330", "industry": "半導體業", "sub_industry": "晶圓代工", "date": "2026-06-26"},
    {"stock_id": "2454", "industry": "半導體業", "sub_industry": "IC設計", "date": "2026-06-26"},
]


@pytest.fixture
def mock_finmind_chain(monkeypatch):
    calls: list[dict] = []

    class _MockClient:
        async def _get(self, url: str, params: dict) -> list:
            calls.append({"url": url, "params": dict(params)})
            return _ROWS

    monkeypatch.setattr(ic, "get_finmind", lambda: _MockClient())
    return calls


async def test_get_chain_fetches_and_caches(mock_finmind_chain) -> None:
    out = await ic.get_chain()
    assert out == {"半導體業": {"晶圓代工": ["2330"], "IC設計": ["2454"]}}
    assert len(mock_finmind_chain) == 1


async def test_get_chain_cache_hit_zero_calls(mock_finmind_chain) -> None:
    """暖 cache 後第二次呼叫零 FinMind call(TTL 未過期)。"""
    await ic.get_chain()
    await ic.get_chain()
    assert len(mock_finmind_chain) == 1


async def test_get_chain_concurrent_dedup(mock_finmind_chain) -> None:
    """並發 ×2 → inflight 合流,FinMind 只 call 一次(characterization,
    refactor F-3:遷移前拍「合流」現狀 — 此性質新舊兩版 _run_once 皆成立)。"""
    out = await asyncio.gather(ic.get_chain(), ic.get_chain())
    assert out[0] == out[1] == {"半導體業": {"晶圓代工": ["2330"], "IC設計": ["2454"]}}
    assert len(mock_finmind_chain) == 1


async def test_get_chain_ttl_expired_refetches(mock_finmind_chain, monkeypatch) -> None:
    """TTL(7 天)過期後第二次呼叫重抓。"""
    await ic.get_chain()
    assert len(mock_finmind_chain) == 1

    cached = ic._read_cache()
    stale_fetched_at = (
        datetime.fromisoformat(cached["fetched_at"]) - timedelta(hours=ic._CHAIN_TTL_HOURS + 1)
    ).isoformat(timespec="seconds")
    ic._write_cache({**cached, "fetched_at": stale_fetched_at})

    await ic.get_chain()
    assert len(mock_finmind_chain) == 2


# ---------------------------------------------------------------------------
# FAKE_FINMIND=1 — mem-only cache,不落檔(R10)
# ---------------------------------------------------------------------------


async def test_get_chain_fake_mode_does_not_write_disk(
    mock_finmind_chain, monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv("FAKE_FINMIND", "1")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))

    out = await ic.get_chain()
    assert out == {"半導體業": {"晶圓代工": ["2330"], "IC設計": ["2454"]}}

    cache_dir = tmp_path / "cache" / "chip"
    written = list(cache_dir.glob("industry_chain*.json")) if cache_dir.exists() else []
    assert written == [], f"FAKE_FINMIND=1 不該落檔,卻寫了 {written}"


async def test_get_chain_fake_mode_cache_hit_zero_calls(
    mock_finmind_chain, monkeypatch, tmp_path
) -> None:
    """FAKE 模式下 mem cache 一樣要生效(零 call on second hit)。"""
    monkeypatch.setenv("FAKE_FINMIND", "1")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))

    await ic.get_chain()
    await ic.get_chain()
    assert len(mock_finmind_chain) == 1


# ---------------------------------------------------------------------------
# 失敗 propagate — 不 swallow(caller 負責降級)
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_finmind_chain_raises(monkeypatch):
    calls: list[dict] = []

    class _RaisingClient:
        async def _get(self, url: str, params: dict) -> list:
            calls.append({"url": url, "params": dict(params)})
            raise httpx.ConnectError("simulated upstream blip")

    monkeypatch.setattr(ic, "get_finmind", lambda: _RaisingClient())
    return calls


async def test_get_chain_propagates_http_error(mock_finmind_chain_raises) -> None:
    with pytest.raises(httpx.ConnectError):
        await ic.get_chain()
    assert len(mock_finmind_chain_raises) == 1
    # 失敗不寫 cache(不 swallow 成假成功)
    assert ic._read_cache() is None
