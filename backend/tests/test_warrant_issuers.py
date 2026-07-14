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


def make_archives(
    ivb_by_wid: dict[str, list],
    *,
    base_day: int = 1,
    ba: dict | None = None,
    s_map: dict | None = None,
):
    """依 wid→ivb 序列建 [(date, payload)];b/a 預設健康(0.5/0.52),s 預設 100。"""
    n_days = max(len(v) for v in ivb_by_wid.values())
    out = []
    for i in range(n_days):
        d = f"2026-07-{base_day + i:02d}"
        warrants = {}
        for wid, series in ivb_by_wid.items():
            if i < len(series):
                pair = (ba or {}).get(wid, (0.5, 0.52))
                s = (s_map or {}).get(wid, 100.0)
                warrants[wid] = {
                    "b": pair[0], "a": pair[1], "c": 0.51, "s": s,
                    "ivb": series[i], "iva": series[i],
                }
        out.append((d, {"_cache_version": 1, "date": d, "warrants": warrants}))
    return out


def make_terms(
    wids: list[str], ltd: str = "2026-12-30", strike: float = 90.0, kind: str = "call"
) -> dict:
    """v2 分層需要 strike/kind:預設 strike 90 × s 100 → m=+0.111(itm 帶)、
    ltd 2026-12-30 − as_of 2026-07-10 = 173 日(mid 帶)→ 全檔同層 itm|mid。"""
    return {w: {"last_trading_date": ltd, "strike": strike, "kind": kind} for w in wids}


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
    assert m["074888"] == {"issuer_id": "5380", "issuer_name": "第一金", "underlying_id": "1802"}
    assert m["030012"] == {"issuer_id": "9200", "issuer_name": "凱基", "underlying_id": "6781"}
    assert m["730208"] == {"issuer_id": "5380", "issuer_name": "第一金", "underlying_id": "5289"}


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
    """known-answer(SC-1b 同組合一家較差 → 排後):一穩一波動同層 → 穩者 rank 1。

    層 itm|mid 10 檔:穩 5 檔 iv_std tie(midrank 3 → pctl 0.25)、波動 5 檔
    tie(midrank 8 → 0.75);spread 全同 → 0.5;declining 0/5 vs 5/5 → 0.25/0.75。
    """
    out = rank_two_issuers()
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["5380"]["rank"] == 1
    assert by_id["9200"]["rank"] == 2
    assert by_id["5380"]["iv_std_median"] < by_id["9200"]["iv_std_median"]
    assert by_id["5380"]["iv_score"] == pytest.approx(0.25)
    assert by_id["9200"]["iv_score"] == pytest.approx(0.75)
    assert by_id["5380"]["spread_score"] == pytest.approx(0.5)
    assert by_id["5380"]["composite"] == pytest.approx((3 * 0.25 + 2 * 0.5 + 2 * 0.25) / 7)


def test_rank_payload_shape():
    out = rank_two_issuers()
    assert out["as_of_date"] == "2026-07-10"  # 最新 archive 日
    assert out["built_from_days"] == 10
    assert out["n_strata_total"] == 1  # 全檔同層 itm|mid
    r = out["issuers"][0]
    for key in (
        "issuer_id", "issuer_name", "n_warrants", "n_scored",
        "iv_std_median", "spread_median", "declining_share",
        "iv_score", "spread_score", "declining_score", "n_strata",
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
    # spread 路徑的 null 傳播與 declining 路徑對稱(Phase 5 review 補鎖)
    assert by_id["9200"]["spread_score"] is None
    assert by_id["9200"]["composite"] is None
    assert by_id["9200"]["rank"] is None


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


def test_rank_degenerate_all_equal_neutral():
    """全體同值指標 → 層內全 tie,pctl 一律 0.5 → composite=0.5(中性),
    不得為 NaN(v1 R2-2 的 min-max 退化分支由 midrank 天然取代)。"""
    out = rank_two_issuers(a_series=STABLE, b_series=STABLE, drift={
        **{f"AAA{i:03d}": {"label": "stable"} for i in range(1, 6)},
        **{f"BBB{i:03d}": {"label": "stable"} for i in range(1, 6)},
    })
    for r in out["issuers"]:
        assert r["composite"] == pytest.approx(0.5)
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


# ---------------------------------------------------------------- v2 分層(issuer-rank-strata SC-1)


def _mk_terms(spec: dict[str, tuple[float, str]], ltd: str = "2026-12-30") -> dict:
    """{wid: (strike, kind)} → terms dict(s=100 基準下自選 moneyness 帶)。"""
    return {
        w: {"last_trading_date": ltd, "strike": k[0], "kind": k[1]} for w, k in spec.items()
    }


def test_midrank_pctl_handles_ties():
    """(c) midrank 手算:[1,2,2,3,4] → [0.1, 0.4, 0.4, 0.7, 0.9]。"""
    assert wi._midrank_pctls([1.0, 2.0, 2.0, 3.0, 4.0]) == pytest.approx(
        [0.1, 0.4, 0.4, 0.7, 0.9]
    )


def test_rank_mix_invariance():
    """(a) 層內品質相同、組合結構不同(一家全 deep_otm、一家全 atm)→
    composite 相近,排名不因組合分高下 — v1 未分層偏差的直接反例。"""
    imap: dict[str, dict] = {}
    ivb_by_wid: dict[str, list] = {}
    drift: dict[str, dict] = {}
    terms_spec: dict[str, tuple[float, str]] = {}
    for i in range(1, 6):
        wd, wa = f"DEEP{i:02d}", f"ATMW{i:02d}"
        imap[wd] = {"issuer_id": "8001", "issuer_name": "深價外商"}
        imap[wa] = {"issuer_id": "8002", "issuer_name": "價平商"}
        # 深價外商 ivb 水位與振幅都大(raw std 大),價平商小 — v1 會分高下
        ivb_by_wid[wd] = [0.8 + (0.02 * i if j % 2 else 0.0) for j in range(10)]
        ivb_by_wid[wa] = [0.3 + (0.002 * i if j % 2 else 0.0) for j in range(10)]
        terms_spec[wd] = (130.0, "call")  # m=(100-130)/130=-0.231 → deep_otm
        terms_spec[wa] = (100.0, "call")  # m=0 → atm
        drift[wd] = {"label": "stable"}
        drift[wa] = {"label": "stable"}
    out = wi.compute_issuer_rank(
        make_archives(ivb_by_wid), drift, _mk_terms(terms_spec), imap
    )
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    # 各自層內 rank 1-5 → iv_score 皆 0.5;raw 中位數差 10 倍以上(v1 必分高下)
    assert by_id["8001"]["iv_std_median"] > by_id["8002"]["iv_std_median"] * 5
    assert abs(by_id["8001"]["composite"] - by_id["8002"]["composite"]) < 0.02
    assert out["n_strata_total"] == 2


def test_rank_small_stratum_not_scored():
    """(e) 層 <5 檔整層不計分:4 檔 itm + 5 檔 atm → n_scored=5、n_strata=1。"""
    wids_itm = [f"ITM{i:02d}" for i in range(1, 5)]  # 4 檔 → 層樣本不足
    wids_atm = [f"ATM{i:02d}" for i in range(1, 6)]  # 5 檔 → 有效層
    imap = {w: {"issuer_id": "8001", "issuer_name": "單一商"} for w in wids_itm + wids_atm}
    terms = {
        **_mk_terms({w: (90.0, "call") for w in wids_itm}),
        **_mk_terms({w: (100.0, "call") for w in wids_atm}),
    }
    ivb = {w: STABLE for w in wids_itm + wids_atm}
    drift = {w: {"label": "stable"} for w in wids_itm + wids_atm}
    out = wi.compute_issuer_rank(make_archives(ivb), drift, terms, imap)
    r = out["issuers"][0]
    assert r["n_warrants"] == 9
    assert r["n_scored"] == 5
    assert r["n_strata"] == 1
    assert out["n_strata_total"] == 1


def test_rank_unclassifiable_not_scored():
    """(f) 無 s / 無 strike / strike=0 → unclassifiable 不計分,不炸。"""
    wids_ok = [f"OKW{i:02d}" for i in range(1, 6)]
    bad = ["NOS001", "NOK001", "ZKS001"]
    imap = {w: {"issuer_id": "8001", "issuer_name": "單一商"} for w in wids_ok + bad}
    terms = _mk_terms({w: (100.0, "call") for w in wids_ok})
    terms["NOS001"] = {"last_trading_date": "2026-12-30", "strike": 100.0, "kind": "call"}
    terms["NOK001"] = {"last_trading_date": "2026-12-30"}  # 無 strike/kind
    terms["ZKS001"] = {"last_trading_date": "2026-12-30", "strike": 0.0, "kind": "call"}
    ivb = {w: STABLE for w in wids_ok + bad}
    out = wi.compute_issuer_rank(
        make_archives(ivb, s_map={"NOS001": None}),  # 全窗無 s
        {w: {"label": "stable"} for w in wids_ok + bad},
        terms,
        imap,
    )
    r = out["issuers"][0]
    assert r["n_warrants"] == 8
    assert r["n_scored"] == 5


def test_rank_declining_binary_midrank():
    """(d) binary declining 的 midrank:層內 3 穩 2 降 → 0.3 / 0.8。"""
    wids_a = [f"STB{i:02d}" for i in range(1, 4)]  # 3 檔 stable(甲商)
    wids_b = [f"DCL{i:02d}" for i in range(1, 3)]  # 2 檔 declining(乙商)
    imap = {
        **{w: {"issuer_id": "8001", "issuer_name": "甲"} for w in wids_a},
        **{w: {"issuer_id": "8002", "issuer_name": "乙"} for w in wids_b},
    }
    drift = {
        **{w: {"label": "stable"} for w in wids_a},
        **{w: {"label": "declining"} for w in wids_b},
    }
    terms = _mk_terms({w: (100.0, "call") for w in wids_a + wids_b})
    out = wi.compute_issuer_rank(
        make_archives({w: STABLE for w in wids_a + wids_b}), drift, terms, imap
    )
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["8001"]["declining_share"] == 0.0
    assert by_id["8002"]["declining_share"] == 1.0
    assert by_id["8001"]["declining_score"] == pytest.approx(0.3)
    assert by_id["8002"]["declining_score"] == pytest.approx(0.8)


def test_rank_composite_null_without_labeled():
    """(g) 旗下無 labeled 檔 → declining_score null → composite null(傳播)。"""
    wids = [f"INS{i:02d}" for i in range(1, 6)]
    imap = {w: {"issuer_id": "8001", "issuer_name": "無標商"} for w in wids}
    out = wi.compute_issuer_rank(
        make_archives({w: STABLE for w in wids}),
        {w: {"label": "insufficient"} for w in wids},
        _mk_terms({w: (100.0, "call") for w in wids}),
        imap,
    )
    r = out["issuers"][0]
    assert r["iv_score"] is not None
    assert r["declining_score"] is None
    assert r["composite"] is None
    assert r["rank"] is None


def test_rank_spread_subset_single_neutral():
    """(h) 層內僅 1 檔有有效 b/a → 該檔 spread pctl=0.5(中性),不偏袒。"""
    wids = [f"SPD{i:02d}" for i in range(1, 6)]
    imap = {w: {"issuer_id": "8001", "issuer_name": "單一商"} for w in wids}
    ba = {w: (0.0, 0.52) for w in wids[1:]}  # b=0 → spread 無效,只留第 1 檔
    out = wi.compute_issuer_rank(
        make_archives({w: STABLE for w in wids}, ba=ba),
        {w: {"label": "stable"} for w in wids},
        _mk_terms({w: (100.0, "call") for w in wids}),
        imap,
    )
    r = out["issuers"][0]
    assert r["spread_score"] == pytest.approx(0.5)


def test_rank_version_bumped():
    """RANK payload 版本 = 3(v2 分層;MAP 版本不動)。"""
    out = rank_two_issuers()
    assert wi._RANK_CACHE_VERSION == 3
    assert out["_cache_version"] == 3
    assert wi._CACHE_VERSION == 2  # map 不連坐


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
            "_cache_version": wi._RANK_CACHE_VERSION,
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
    """極端值權證只會拿層內最末 pctl(<1)— composite 天然落 [0,1] 不爆界。"""
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


# ---------------------------------------------------------------- 代號回收防護(Phase 7 real-env)


DUP_ROWS = [
    {
        "出表日期": "1150713",
        "發行人代號": "9800",
        "發行人名稱": "元大證券股份有限公司",
        "權證代號": "051372",
        "名稱": "威盛元大43購11",
        "標的代號": "2388",
        "標的名稱": "威盛",
        "申請發行日期": "1140108",
    },
    {
        "出表日期": "1150713",
        "發行人代號": "9500",
        "發行人名稱": "兆豐證券股份有限公司",
        "權證代號": "051372",
        "名稱": "台積電兆豐59購01",
        "標的代號": "2330",
        "標的名稱": "台積電",
        "申請發行日期": "1150301",
    },
]


async def test_issuer_map_recycled_code_picks_latest(monkeypatch):
    """權證代號跨年回收(real-env 實證 36_L 1,967 個重複代號)—
    同 wid 取申請發行日期最新的一列。"""
    patch_fetch(monkeypatch, twse=DUP_ROWS, tpex=[])
    m = await wi.get_issuer_map()
    assert m["051372"]["issuer_name"] == "兆豐"
    assert m["051372"]["underlying_id"] == "2330"


async def test_issuer_map_carries_underlying_for_guard(monkeypatch):
    patch_fetch(monkeypatch)
    m = await wi.get_issuer_map()
    assert m["030012"]["underlying_id"] == "6781"


def test_rank_skips_underlying_mismatch():
    """map 殘留舊代號(現行權證未入 36_L)→ 標的不符不得計入該發行商。"""
    imap = issuer_map_two()
    for v in imap.values():
        v["underlying_id"] = "2330"
    imap["AAA001"] = {"issuer_id": "5380", "issuer_name": "第一金", "underlying_id": "9999"}
    wids_a = [f"AAA{i:03d}" for i in range(1, 6)]
    archives = make_archives({w: STABLE for w in wids_a})
    terms = {
        w: {"last_trading_date": "2026-12-30", "underlying_id": "2330",
            "strike": 90.0, "kind": "call"}
        for w in wids_a
    }
    out = wi.compute_issuer_rank(
        archives, {w: {"label": "stable"} for w in wids_a}, terms, imap
    )
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["5380"]["n_warrants"] == 4  # AAA001 標的不符被擋


# ---------------------------------------------------------------- 名稱解析 fallback(Phase 7 real-env:36_L 年度表覆蓋率僅 ~23%)


NAME_TABLES = {
    "map": {},
    "by_name": {
        "凱基": "9200", "元大": "9800", "永豐金": "9600A", "統一": "9A00",
        "中國信託": "9C00", "群益金鼎": "9100", "第一金": "5380",
    },
}


def test_resolve_by_name_basic():
    info = wi.resolve_issuer(NAME_TABLES, "062728", "2330", "台積電凱基61購03")
    assert info == {"issuer_id": "9200", "issuer_name": "凱基"}


def test_resolve_by_name_two_char_variant():
    """簡稱在權證名內常縮兩字(永豐金→永豐、群益金鼎→群益、第一金→第一)。"""
    assert wi.resolve_issuer(NAME_TABLES, "x", "2330", "台積電永豐77購02")["issuer_id"] == "9600A"
    assert wi.resolve_issuer(NAME_TABLES, "x", "2330", "宜鼎群益58售01")["issuer_id"] == "9100"
    assert wi.resolve_issuer(NAME_TABLES, "x", "1802", "台玻第一49購01")["issuer_id"] == "5380"


def test_resolve_by_name_zhongxin_alias():
    """中國信託在權證名內是「中信」(前二字裁切救不了,唯一顯式 alias)。"""
    assert wi.resolve_issuer(NAME_TABLES, "x", "2330", "台積電中信61購01")["issuer_id"] == "9C00"


def test_resolve_by_name_underlying_shares_issuer_prefix():
    """標的名含發行商字樣(統一 1216 × 統一證券)→ 取「年月+購/售」前的那個。"""
    info = wi.resolve_issuer(NAME_TABLES, "x", "1216", "統一統一61購01")
    assert info["issuer_id"] == "9A00"


def test_resolve_by_name_no_match_null():
    assert wi.resolve_issuer(NAME_TABLES, "x", "2330", "台積電怪商61購01") is None


def test_resolve_map_wins_over_name():
    """36 表有對映且標的相符 → 官方對映優先於名稱解析。"""
    tables = {
        "map": {"062728": {"issuer_id": "9999", "issuer_name": "官方", "underlying_id": "2330"}},
        "by_name": NAME_TABLES["by_name"],
    }
    assert wi.resolve_issuer(tables, "062728", "2330", "台積電凱基61購03")["issuer_id"] == "9999"


def test_resolve_stale_map_falls_back_to_name():
    """舊代號殘留(標的不符)→ 改走名稱解析而非直接 null。"""
    tables = {
        "map": {"051372": {"issuer_id": "9800", "issuer_name": "元大", "underlying_id": "2388"}},
        "by_name": NAME_TABLES["by_name"],
    }
    info = wi.resolve_issuer(tables, "051372", "2330", "台積電兆豐59購01")
    assert info is None  # 兆豐不在 lexicon → null;lexicon 有就會命中
    tables["by_name"]["兆豐"] = "9500"
    assert wi.resolve_issuer(tables, "051372", "2330", "台積電兆豐59購01")["issuer_id"] == "9500"


def test_rank_uses_name_fallback_for_unmapped():
    """rank 與 merge 同一套三層解析:map 無對映、terms 有名稱 → 名稱解析計入。"""
    wids = [f"NNN{i:03d}" for i in range(1, 6)]
    archives = make_archives({w: STABLE for w in wids})
    terms = {
        w: {"last_trading_date": "2026-12-30", "underlying_id": "2330",
            "name": f"台積電凱基61購{i:02d}", "strike": 90.0, "kind": "call"}
        for i, w in enumerate(wids, 1)
    }
    tables = {"map": {}, "by_name": {"凱基": "9200"}}
    out = wi.compute_issuer_rank(archives, {w: {"label": "stable"} for w in wids}, terms, tables)
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["9200"]["n_scored"] == 5
    assert by_id["9200"]["issuer_name"] == "凱基"


async def test_get_issuer_rank_wires_lexicon(monkeypatch):
    """接線層:get_issuer_rank 必須把 by_name lexicon 傳進 compute(rank 與
    merge 同一套解析;漏接 = 排行樣本缺 36_L 覆蓋缺口那批)。"""
    from services import warrant_iv_history as ivh
    from services import warrants as ws

    patch_fetch(monkeypatch, twse=[], tpex=[
        {
            "Date": "1150106", "發行人代號": "9200", "發行人名稱": "凱基",
            "權證代號": "999999", "名稱": "無關", "標的代號": "1101",
            "申請發行日期": "1140212",
        },
    ])
    wids = [f"NNN{i:03d}" for i in range(1, 6)]

    async def fake_archives(limit):
        return make_archives({w: STABLE for w in wids})

    async def fake_drift():
        return {w: {"label": "stable"} for w in wids}

    async def fake_snapshot(refresh=False):
        return {
            "as_of_date": "2026-07-10",
            "by_underlying": {"2330": [
                {"warrant_id": w, "last_trading_date": "2026-12-30",
                 "underlying_id": "2330", "name": f"台積電凱基61購{i:02d}",
                 "strike": 90.0, "kind": "call"}
                for i, w in enumerate(wids, 1)
            ]},
        }

    monkeypatch.setattr(ivh, "load_recent_archives", fake_archives)
    monkeypatch.setattr(ivh, "get_drift_map", fake_drift)
    monkeypatch.setattr(ws, "get_snapshot", fake_snapshot)
    out = await wi.get_issuer_rank()
    assert out is not None
    by_id = {r["issuer_id"]: r for r in out["issuers"]}
    assert by_id["9200"]["n_scored"] == 5  # 全靠名稱解析(map 無這些 wid)


async def test_map_cooldown_disk_fallback_syncs_lexicon(monkeypatch):
    """cooldown 內走磁碟 fallback 也要回填 _map_mem — lexicon 不得與 map 脫鉤
    (增量 review CONFIRMED:脫鉤時 rank 期間名稱解析靜默失效)。"""
    patch_fetch(monkeypatch)
    await wi.get_issuer_map()
    p = chip_cache_dir() / wi.MAP_FILE
    payload = read_json(p)
    payload["fetched_on"] = "2026-07-01"  # 過期
    from utils.cache import atomic_write_json

    atomic_write_json(p, payload)
    monkeypatch.setattr(wi, "_map_mem", None)
    monkeypatch.setattr(wi, "_last_map_attempt", wi._monotonic())  # 模擬近期失敗
    m = await wi.get_issuer_map()
    assert "074888" in m  # 磁碟 stale fallback 生效
    lex = wi.get_issuer_lexicon_cached()
    assert lex != {}  # lexicon 同步(修前:_map_mem None → {})
    assert "凱基" in lex
