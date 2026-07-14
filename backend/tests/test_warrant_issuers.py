"""warrant_issuers service 測試(mod/warrant-selector-enhance SC-1/SC-2)。

fixture 形狀 = 2026-07-14 probe 真實 payload 縮樣(t187ap36_L / mopsfin_t187ap36_O
欄名原樣);排行純函式走 known-answer 建構資料。
"""

from __future__ import annotations

import asyncio
from datetime import date as date_type

import httpx
import pytest

from services import clock
from services import warrant_issuers as wi
from utils.cache import chip_cache_dir, read_json


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """module-level state reset 慣例(同 test_warrant_iv_history)。"""
    monkeypatch.setattr(wi, "_client", None)
    monkeypatch.setattr(wi, "_map_mem", None)
    monkeypatch.setattr(wi, "_rank_mem", None)
    monkeypatch.setattr(wi, "_rank_disk_checked", False)
    monkeypatch.setattr(wi, "_map_bg_task", None)
    monkeypatch.setattr(wi, "_last_map_attempt", None)
    wi._inflight.clear()


@pytest.fixture(autouse=True)
def _freeze_today(monkeypatch):
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 14))


# ---------------------------------------------------------------- helpers


TWSE_ROWS = [
    {
        "出表日期": "1150106",
        "發行人代號": "5380",
        "發行人名稱": "第一金證券股份有限公司",
        "權證代號": "074888",
        "名稱": "台玻第一49購01",
        "標的代號": "1802",
        "標的名稱": "台灣玻璃工業股份有限公司",
        "申請發行日期": "1140312",
    },
    {
        "出表日期": "1150106",
        "發行人代號": "9200",
        "發行人名稱": "凱基證券股份有限公司",
        "權證代號": "030012",
        "名稱": "AES凱基57購02",
        "標的代號": "6781",
        "標的名稱": "AES-KY",
        "申請發行日期": "1140401",
    },
]

TPEX_ROWS = [
    {
        "Date": "1150106",
        "發行人代號": "5380",
        "發行人名稱": "第一金",
        "權證代號": "730208",
        "名稱": "宜鼎第一48購01",
        "標的代號": "5289",
        "標的名稱": "宜鼎國際股份有限公司",
        "申請發行日期": "1140212",
    },
]


def patch_fetch(monkeypatch, twse=None, tpex=None):
    async def fake_fetch_twse():
        if isinstance(twse, Exception):
            raise twse
        return TWSE_ROWS if twse is None else twse

    async def fake_fetch_tpex():
        if isinstance(tpex, Exception):
            raise tpex
        return TPEX_ROWS if tpex is None else tpex

    monkeypatch.setattr(wi, "_fetch_twse_rows", fake_fetch_twse)
    monkeypatch.setattr(wi, "_fetch_tpex_rows", fake_fetch_tpex)


def make_archives(ivb_by_wid: dict[str, list], *, base_day: int = 1, ba: dict | None = None):
    """依 wid→ivb 序列建 [(date, payload)];b/a 預設健康(0.5/0.52)。"""
    n_days = max(len(v) for v in ivb_by_wid.values())
    out = []
    for i in range(n_days):
        d = f"2026-07-{base_day + i:02d}"
        warrants = {}
        for wid, series in ivb_by_wid.items():
            if i < len(series):
                pair = (ba or {}).get(wid, (0.5, 0.52))
                warrants[wid] = {
                    "b": pair[0], "a": pair[1], "c": 0.51, "s": 100.0,
                    "ivb": series[i], "iva": series[i],
                }
        out.append((d, {"_cache_version": 1, "date": d, "warrants": warrants}))
    return out


def make_terms(wids: list[str], ltd: str = "2026-12-30") -> dict:
    return {w: {"last_trading_date": ltd} for w in wids}


STABLE = [0.30, 0.31, 0.30, 0.31, 0.30, 0.31, 0.30, 0.31, 0.30, 0.31]
VOLATILE = [0.30, 0.45, 0.25, 0.50, 0.20, 0.55, 0.30, 0.48, 0.22, 0.52]


def issuer_map_two() -> dict:
    return {
        "AAA001": {"issuer_id": "5380", "issuer_name": "第一金"},
        "AAA002": {"issuer_id": "5380", "issuer_name": "第一金"},
        "AAA003": {"issuer_id": "5380", "issuer_name": "第一金"},
        "AAA004": {"issuer_id": "5380", "issuer_name": "第一金"},
        "AAA005": {"issuer_id": "5380", "issuer_name": "第一金"},
        "BBB001": {"issuer_id": "9200", "issuer_name": "凱基"},
        "BBB002": {"issuer_id": "9200", "issuer_name": "凱基"},
        "BBB003": {"issuer_id": "9200", "issuer_name": "凱基"},
        "BBB004": {"issuer_id": "9200", "issuer_name": "凱基"},
        "BBB005": {"issuer_id": "9200", "issuer_name": "凱基"},
    }


def rank_two_issuers(a_series=STABLE, b_series=VOLATILE, drift=None, terms=None, ba=None):
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    wids_b = [f"BBB{i:03d}" for i in range(1, 6)]
    archives = make_archives(
        {**{w: a_series for w in wids_a}, **{w: b_series for w in wids_b}}, ba=ba
    )
    drift_map = drift if drift is not None else {
        **{w: {"label": "stable"} for w in wids_a},
        **{w: {"label": "declining"} for w in wids_b},
    }
    terms_by_wid = terms if terms is not None else make_terms(wids_a + wids_b)
    return wi.compute_issuer_rank(archives, drift_map, terms_by_wid, issuer_map_two())


# ---------------------------------------------------------------- 簡稱裁剪(SC-1)


def test_short_name_strips_company_suffix():
    assert wi._short_issuer_name("第一金證券股份有限公司") == "第一金"
    assert wi._short_issuer_name("凱基證券股份有限公司") == "凱基"


def test_short_name_strips_composite_suffix():
    assert wi._short_issuer_name("華南永昌綜合證券股份有限公司") == "華南永昌"


def test_short_name_keeps_already_short():
    assert wi._short_issuer_name("第一金") == "第一金"


def test_short_name_keeps_unrecognized():
    assert wi._short_issuer_name("怪名字商號") == "怪名字商號"


# ---------------------------------------------------------------- 對照 fetch + cache(SC-1)


async def test_issuer_map_merges_both_markets(monkeypatch):
    patch_fetch(monkeypatch)
    m = await wi.get_issuer_map()
    assert m["074888"] == {"issuer_id": "5380", "issuer_name": "第一金"}
    assert m["030012"] == {"issuer_id": "9200", "issuer_name": "凱基"}
    assert m["730208"] == {"issuer_id": "5380", "issuer_name": "第一金"}


async def test_issuer_map_tpex_short_name_wins(monkeypatch):
    """issuer_id 為 join key;TPEx 簡稱優先於 TWSE 裁剪結果(R7)。"""
    patch_fetch(monkeypatch)
    m = await wi.get_issuer_map()
    # 5380 兩市場都有:TWSE 全稱裁剪也是「第一金」,TPEx 簡稱直接用
    assert m["074888"]["issuer_name"] == "第一金"


async def test_issuer_map_writes_versioned_cache(monkeypatch):
    patch_fetch(monkeypatch)
    await wi.get_issuer_map()
    payload = read_json(chip_cache_dir() / wi.MAP_FILE)
    assert payload["_cache_version"] == wi._CACHE_VERSION
    assert payload["fetched_on"] == "2026-07-14"
    assert "074888" in payload["map"]


async def test_issuer_map_fresh_cache_skips_fetch(monkeypatch):
    patch_fetch(monkeypatch)
    await wi.get_issuer_map()

    async def boom():
        raise AssertionError("should not fetch when cache fresh")

    monkeypatch.setattr(wi, "_fetch_twse_rows", boom)
    monkeypatch.setattr(wi, "_map_mem", None)  # 清 mem 強迫走檔
    m = await wi.get_issuer_map()
    assert "074888" in m


async def test_issuer_map_stale_cache_refetches(monkeypatch):
    patch_fetch(monkeypatch)
    await wi.get_issuer_map()
    # 竄改 fetched_on 至 8 天前 → stale(TTL 7 天)
    p = chip_cache_dir() / wi.MAP_FILE
    payload = read_json(p)
    payload["fetched_on"] = "2026-07-06"
    from utils.cache import atomic_write_json

    atomic_write_json(p, payload)
    monkeypatch.setattr(wi, "_map_mem", None)
    called = {"n": 0}

    async def counting():
        called["n"] += 1
        return TWSE_ROWS

    monkeypatch.setattr(wi, "_fetch_twse_rows", counting)
    await wi.get_issuer_map()
    assert called["n"] == 1


async def test_issuer_map_one_source_failure_keeps_other(monkeypatch):
    """單源故障不炸另一源(壞 row skip 精神)。"""
    patch_fetch(monkeypatch, tpex=httpx.ConnectError("tpex down"))
    m = await wi.get_issuer_map()
    assert "074888" in m
    assert "730208" not in m


# ---------------------------------------------------------------- sync accessor(SC-4 熱路徑)


def test_cached_accessor_returns_empty_and_spawns_bg(monkeypatch):
    """mem/檔 miss → 回空 map + 背景 task,絕不同步 fetch(R1,P0)。"""
    patch_fetch(monkeypatch)

    async def run():
        got = wi.get_issuer_map_cached()
        assert got == {}
        assert wi._map_bg_task is not None
        await wi._map_bg_task
        return wi.get_issuer_map_cached()

    m = asyncio.run(run())
    assert "074888" in m


def test_cached_accessor_bg_failure_swallowed(monkeypatch):
    """背景 fetch 失敗只 log,不外洩(R1)。"""
    patch_fetch(monkeypatch, twse=httpx.ConnectError("boom"), tpex=httpx.ConnectError("boom"))

    async def run():
        assert wi.get_issuer_map_cached() == {}
        await wi._map_bg_task
        return wi.get_issuer_map_cached()

    assert asyncio.run(run()) == {}


# ---------------------------------------------------------------- compute_issuer_rank(SC-2)


def test_rank_stable_issuer_wins():
    """known-answer:一穩一波動 → 穩者 rank 1。"""
    out = rank_two_issuers()
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["5380"]["rank"] == 1
    assert by_id["9200"]["rank"] == 2
    assert by_id["5380"]["iv_std_median"] < by_id["9200"]["iv_std_median"]


def test_rank_payload_shape():
    out = rank_two_issuers()
    assert out["as_of_date"] == "2026-07-10"  # 最新 archive 日
    assert out["built_from_days"] == 10
    r = out["issuers"][0]
    for key in (
        "issuer_id", "issuer_name", "n_warrants", "n_scored",
        "iv_std_median", "spread_median", "declining_share",
        "composite", "rank", "tier",
    ):
        assert key in r


def test_rank_declining_share_counts_labels():
    out = rank_two_issuers()
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["5380"]["declining_share"] == 0.0
    assert by_id["9200"]["declining_share"] == 1.0


def test_rank_insufficient_excluded_from_declining_denominator():
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    drift = {
        **{w: {"label": "stable"} for w in wids_a},
        "BBB001": {"label": "declining"},
        "BBB002": {"label": "declining"},
        "BBB003": {"label": "insufficient"},
        "BBB004": {"label": "insufficient"},
        "BBB005": {"label": "stable"},
    }
    out = rank_two_issuers(drift=drift)
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    # 分母 = 3(兩個 insufficient 不入),分子 = 2
    assert by_id["9200"]["declining_share"] == pytest.approx(2 / 3)


def test_rank_excludes_near_expiry():
    """剩餘 ≤21 日曆日(基準 = 最新 archive 日 2026-07-10)不計分。"""
    terms = make_terms([f"AAA{i:03d}" for i in range(1, 6)], ltd="2026-12-30")
    terms.update(make_terms([f"BBB{i:03d}" for i in range(1, 6)], ltd="2026-07-25"))
    out = rank_two_issuers(terms=terms)
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["9200"]["n_scored"] == 0
    assert by_id["9200"]["iv_std_median"] is None
    assert by_id["9200"]["rank"] is None
    assert by_id["9200"]["tier"] is None


def test_rank_excludes_sparse_ivb():
    """兩週窗有效 ivb 點 <8 → 該權證不計分。"""
    sparse = [0.3, None, None, 0.31, None, None, 0.3, None, None, 0.31]
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    archives = make_archives({**{w: STABLE for w in wids_a}, "BBB001": sparse})
    imap = issuer_map_two()
    out = wi.compute_issuer_rank(
        archives,
        {**{w: {"label": "stable"} for w in wids_a}, "BBB001": {"label": "stable"}},
        make_terms(wids_a + ["BBB001"]),
        imap,
    )
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["9200"]["n_scored"] == 0


def test_rank_spread_day_guards():
    """b=0 / a<b / null 之日跳過;有效日不足 8 → 權證 spread 不入中位(R5)。"""
    ba = {f"AAA{i:03d}": (0.5, 0.52) for i in range(1, 6)}
    # BBB 全部 b=0 → spread 全滅但 ivb 正常 → spread_median None、iv 正常計
    ba.update({f"BBB{i:03d}": (0.0, 0.52) for i in range(1, 6)})
    out = rank_two_issuers(ba=ba)
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["5380"]["spread_median"] == pytest.approx((0.52 - 0.5) / 0.5)
    assert by_id["9200"]["spread_median"] is None


def test_rank_small_sample_no_tier():
    """n_scored <5 → composite 有值但 rank/tier=null;正規化集合排除之(R4/R2-2)。"""
    imap = issuer_map_two()
    imap["CCC001"] = {"issuer_id": "7777", "issuer_name": "小樣本"}
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    wids_b = [f"BBB{i:03d}" for i in range(1, 6)]
    archives = make_archives(
        {**{w: STABLE for w in wids_a}, **{w: VOLATILE for w in wids_b}, "CCC001": STABLE}
    )
    drift = {w: {"label": "stable"} for w in wids_a + wids_b + ["CCC001"]}
    out = wi.compute_issuer_rank(archives, drift, make_terms(wids_a + wids_b + ["CCC001"]), imap)
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["7777"]["n_scored"] == 1
    assert by_id["7777"]["composite"] is not None
    assert by_id["7777"]["rank"] is None
    assert by_id["7777"]["tier"] is None
    # 兩家合格者仍正常分 rank
    assert {by_id["5380"]["rank"], by_id["9200"]["rank"]} == {1, 2}


def test_rank_degenerate_minmax_no_nan():
    """全體同值指標 → 正規化 0,composite 不得為 NaN(R2-2)。"""
    out = rank_two_issuers(a_series=STABLE, b_series=STABLE, drift={
        **{f"AAA{i:03d}": {"label": "stable"} for i in range(1, 6)},
        **{f"BBB{i:03d}": {"label": "stable"} for i in range(1, 6)},
    })
    for r in out["issuers"]:
        assert r["composite"] == 0.0
        assert r["composite"] == r["composite"]  # not NaN


def test_rank_empty_archives():
    out = wi.compute_issuer_rank([], {}, {}, issuer_map_two())
    assert out["issuers"] == []
    assert out["as_of_date"] is None


def test_rank_unmapped_wid_null_safe():
    """archive 有、對照無的 wid 不炸、不入任何發行商(R7)。"""
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    archives = make_archives({**{w: STABLE for w in wids_a}, "ZZZ999": STABLE})
    out = wi.compute_issuer_rank(
        archives,
        {w: {"label": "stable"} for w in wids_a},
        make_terms(wids_a + ["ZZZ999"]),
        issuer_map_two(),
    )
    ids = {r["issuer_id"] for r in out["issuers"]}
    assert "ZZZ999" not in ids


def test_rank_tier_terciles():
    """6 家合格發行商 → 前/中/後段各 2。"""
    imap: dict[str, dict] = {}
    ivb_by_wid: dict[str, list] = {}
    drift: dict[str, dict] = {}
    # 讓六家 iv 波動遞增
    for i in range(6):
        iid = f"90{i:02d}"
        amp = 0.001 + i * 0.01
        series = [0.3 + (amp if j % 2 else 0.0) for j in range(10)]
        for k in range(5):
            wid = f"I{i}{k:02d}"
            imap[wid] = {"issuer_id": iid, "issuer_name": f"發行商{i}"}
            ivb_by_wid[wid] = series
            drift[wid] = {"label": "stable"}
    archives = make_archives(ivb_by_wid)
    out = wi.compute_issuer_rank(archives, drift, make_terms(list(ivb_by_wid)), imap)
    tiers = [r["tier"] for r in sorted(out["issuers"], key=lambda r: r["rank"])]
    assert tiers == ["front", "front", "mid", "mid", "back", "back"]


# ---------------------------------------------------------------- review 修正批(Phase 5)


def test_cached_accessor_serves_stale_while_revalidating(monkeypatch):
    """過期 map 檔 → 先端出舊對照 + 背景刷新,不得回空(stale-while-revalidate)。"""
    patch_fetch(monkeypatch)
    from utils.cache import atomic_write_json

    async def run():
        await wi.get_issuer_map()
        p = chip_cache_dir() / wi.MAP_FILE
        payload = read_json(p)
        payload["fetched_on"] = "2026-07-01"  # 13 天前 → stale
        atomic_write_json(p, payload)
        wi._map_mem = None
        got = wi.get_issuer_map_cached()
        assert got != {}  # 舊資料仍可用
        assert "074888" in got
        assert wi._map_bg_task is not None  # 背景刷新已排
        await wi._map_bg_task

    asyncio.run(run())


async def test_map_build_backoff_after_total_failure(monkeypatch):
    """兩源全失敗後 60s 內不重打上游(自傷式 rate-limit 防護)。"""
    calls = {"n": 0}

    async def failing():
        calls["n"] += 1
        raise httpx.ConnectError("down")

    monkeypatch.setattr(wi, "_fetch_twse_rows", failing)
    monkeypatch.setattr(wi, "_fetch_tpex_rows", failing)
    assert await wi.get_issuer_map() == {}
    n_after_first = calls["n"]
    assert await wi.get_issuer_map() == {}  # cooldown 內:不再 fetch
    assert calls["n"] == n_after_first


def test_tier_cached_writes_back_mem(monkeypatch):
    """disk 命中 → 回寫 _rank_mem,第二次呼叫零磁碟 IO(熱路徑防重複讀)。"""
    from utils.cache import atomic_write_json

    atomic_write_json(
        chip_cache_dir() / wi.RANK_FILE,
        {
            "_cache_version": wi._CACHE_VERSION,
            "as_of_date": "2026-07-10",
            "built_from_days": 10,
            "issuers": [{"issuer_id": "9800", "tier": "front"}],
        },
    )
    assert wi.get_issuer_tier_cached() == {"9800": "front"}
    assert wi._rank_mem is not None  # 回寫

    def boom(path):
        raise AssertionError("second call must not hit disk")

    monkeypatch.setattr(wi, "read_json", boom)
    assert wi.get_issuer_tier_cached() == {"9800": "front"}


def test_tier_cached_negative_marker(monkeypatch):
    """檔缺 → 首次記 negative marker,後續呼叫不重複掃磁碟。"""
    assert wi.get_issuer_tier_cached() == {}
    reads = {"n": 0}
    real = wi.read_json

    def counting(path):
        reads["n"] += 1
        return real(path)

    monkeypatch.setattr(wi, "read_json", counting)
    assert wi.get_issuer_tier_cached() == {}
    assert reads["n"] == 0


def test_rank_small_sample_composite_clamped():
    """小樣本者以合格集 bounds 正規化,越界 clamp [0,1] — composite 不得爆界。"""
    imap = issuer_map_two()
    imap["CCC001"] = {"issuer_id": "7777", "issuer_name": "極端值"}
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    wids_b = [f"BBB{i:03d}" for i in range(1, 6)]
    extreme = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9]  # std 遠超合格集 max
    archives = make_archives(
        {**{w: STABLE for w in wids_a}, **{w: VOLATILE for w in wids_b}, "CCC001": extreme}
    )
    drift = {w: {"label": "stable"} for w in wids_a + wids_b + ["CCC001"]}
    out = wi.compute_issuer_rank(archives, drift, make_terms(wids_a + wids_b + ["CCC001"]), imap)
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    c = by_id["7777"]["composite"]
    assert c is not None and 0.0 <= c <= 1.0


async def test_issuer_map_shortens_tpex_full_names(monkeypatch):
    """TPEx 發行人名稱不保證是簡稱(2026-07-14 real-env 實證:台新/群益全稱)—
    兩源一律過 _short_issuer_name(對已簡稱者冪等)。"""
    tpex_full = [
        {
            "Date": "1150106",
            "發行人代號": "9B00",
            "發行人名稱": "台新綜合證券股份有限公司",
            "權證代號": "730999",
            "名稱": "測試台新48購01",
            "標的代號": "5289",
            "標的名稱": "測試",
            "申請發行日期": "1140212",
        },
    ]
    patch_fetch(monkeypatch, tpex=tpex_full)
    m = await wi.get_issuer_map()
    assert m["730999"]["issuer_name"] == "台新"
