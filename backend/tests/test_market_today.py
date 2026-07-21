"""mod/market-today-only — services/market_today.py 純函式 compute。

Spec: .claude/mod/market-today-only/change-spec.md §1(SC-1〜SC-3)/ §4 Backend B。

單位契約(R7):change_rate = 百分比數值;貢獻公式 chg_i = change_rate/100。

手算對照(index_strength 貢獻點數,見 test_compute_index_strength_hand_calc):
- TWSE:index close=20100, change_price=100 → prev_close=20000
  - 2330 mv=1000 chg=2.0%  → contrib = 20000*(1000*0.02)/1500 = 266.666...7
  - 2317 mv=500  chg=-1.0% → contrib = 20000*(500*-0.01)/1500 = -66.666...7
  - 3008 mv 缺(不入 eligible,只影響 median)
  - median(twse) = median([2.0, -1.0, -3.0]) = -1.0 → spread = 0.5 - (-1.0) = 1.5
- TPEX:index close=200, change_price=1 → prev_close=199
  - 6182 mv=200 chg=1.0%  → contrib = 199*(200*0.01)/500 = 0.796
  - 5876 mv=300 chg=-2.0% → contrib = 199*(300*-0.02)/500 = -2.388
  - median(tpex) = median([1.0, -2.0]) = -0.5 → spread = -0.3 - (-0.5) = 0.2
"""

from __future__ import annotations

import pytest

from services.market_today import (
    compute_breadth,
    compute_cap_tiers,
    compute_index_strength,
    compute_sector_members,
    compute_sector_rotation,
)

# ---------------------------------------------------------------------------
# compute_index_strength — SC-1
# ---------------------------------------------------------------------------

_INDEX_ROWS = {
    "001": {"close": 20100, "change_price": 100, "change_rate": 0.5},
    "101": {"close": 200, "change_price": 1, "change_rate": -0.3},
}
_UNIVERSE_ROWS = [
    {"stock_id": "2330", "change_rate": 2.0},
    {"stock_id": "2317", "change_rate": -1.0},
    {"stock_id": "3008", "change_rate": -3.0},  # mv 缺 — 只影響 median,不入 contrib
    {"stock_id": "6182", "change_rate": 1.0},
    {"stock_id": "5876", "change_rate": -2.0},
]
_MV_MAP = {"2330": 1000, "2317": 500, "6182": 200, "5876": 300}
_TYPE_MAP = {"2330": "twse", "2317": "twse", "3008": "twse", "6182": "tpex", "5876": "tpex"}
_NAME_MAP = {"2330": "台積電", "2317": "鴻海", "3008": "大立光", "6182": "元大期", "5876": "某櫃股"}


def test_compute_index_strength_hand_calc() -> None:
    out = compute_index_strength(_INDEX_ROWS, _UNIVERSE_ROWS, _MV_MAP, _TYPE_MAP, _NAME_MAP)

    assert out["twse"]["close"] == 20100
    assert out["twse"]["change_rate"] == 0.5
    assert out["twse"]["median_change_rate"] == -1.0
    assert out["twse"]["spread"] == pytest.approx(1.5)

    assert out["tpex"]["median_change_rate"] == -0.5
    assert out["tpex"]["spread"] == pytest.approx(0.2)

    twse_up = out["contrib"]["twse"]["up"]
    twse_down = out["contrib"]["twse"]["down"]
    assert [e["stock_id"] for e in twse_up] == ["2330"]
    assert twse_up[0]["contrib_points"] == pytest.approx(266.6666667, rel=1e-6)
    assert [e["stock_id"] for e in twse_down] == ["2317"]
    assert twse_down[0]["contrib_points"] == pytest.approx(-66.6666667, rel=1e-6)
    # 3008 mv 缺 — 不出現在任一側
    assert all(e["stock_id"] != "3008" for e in twse_up + twse_down)

    tpex_up = out["contrib"]["tpex"]["up"]
    tpex_down = out["contrib"]["tpex"]["down"]
    assert [e["stock_id"] for e in tpex_up] == ["6182"]
    assert tpex_up[0]["contrib_points"] == pytest.approx(0.796, rel=1e-6)
    assert [e["stock_id"] for e in tpex_down] == ["5876"]
    assert tpex_down[0]["contrib_points"] == pytest.approx(-2.388, rel=1e-6)

    # 台積電貢獻點數 = twse eligible 內 2330 的 contrib_points
    assert out["tsmc"]["change_rate"] == 2.0
    assert out["tsmc"]["contrib_points"] == pytest.approx(266.6666667, rel=1e-6)

    # MK-1(mod/batch-ui-update):扣除台積電 — 加權漲跌點數 change_price=100,
    # 扣 2330 貢獻 266.667 → ex 點數 = 100 − 266.667 = −166.667;
    # prev_close = 20000 → ex 漲跌率 = −166.667/20000×100 = −0.8333%
    assert out["ex_tsmc"]["change_points"] == pytest.approx(-166.6666667, rel=1e-6)
    assert out["ex_tsmc"]["change_rate"] == pytest.approx(-0.8333333, rel=1e-5)


def test_compute_index_strength_ex_tsmc_null_when_tsmc_missing() -> None:
    # MK-1 降級:2330 不在 eligible(mv 缺)→ ex_tsmc 兩欄 null
    mv_no_tsmc = {k: v for k, v in _MV_MAP.items() if k != "2330"}
    out = compute_index_strength(_INDEX_ROWS, _UNIVERSE_ROWS, mv_no_tsmc, _TYPE_MAP, _NAME_MAP)
    assert out["ex_tsmc"] == {"change_points": None, "change_rate": None}


def test_compute_index_strength_twse_index_row_missing_side_null() -> None:
    """R5/R12:001 缺席 → twse 整組 None(含 contrib.twse);tpex 照常;
    tsmc.contrib_points 隨 twse 側缺席一併 None(依附 twse eligible)。"""
    index_rows = {"101": _INDEX_ROWS["101"]}
    out = compute_index_strength(index_rows, _UNIVERSE_ROWS, _MV_MAP, _TYPE_MAP, _NAME_MAP)

    assert out["twse"] is None
    assert out["contrib"]["twse"] is None
    assert out["tpex"] is not None
    assert out["contrib"]["tpex"] is not None
    assert out["tsmc"]["change_rate"] == 2.0  # 個股 tick 資料本身還在,只是無貢獻可算
    assert out["tsmc"]["contrib_points"] is None


def test_compute_index_strength_tpex_index_row_missing_side_null() -> None:
    index_rows = {"001": _INDEX_ROWS["001"]}
    out = compute_index_strength(index_rows, _UNIVERSE_ROWS, _MV_MAP, _TYPE_MAP, _NAME_MAP)

    assert out["tpex"] is None
    assert out["contrib"]["tpex"] is None
    assert out["twse"] is not None
    assert out["contrib"]["twse"] is not None


def test_compute_index_strength_both_index_rows_missing() -> None:
    out = compute_index_strength({}, _UNIVERSE_ROWS, _MV_MAP, _TYPE_MAP, _NAME_MAP)
    assert out["twse"] is None
    assert out["tpex"] is None
    assert out["contrib"] == {"twse": None, "tpex": None}
    assert out["tsmc"] == {"change_rate": 2.0, "contrib_points": None}


def test_compute_index_strength_mv_map_empty_contrib_null() -> None:
    """SC-5(review P2#1):mv_map 整包缺席(mv 來源降級)→ contrib 兩側 null
    (前端「資料暫缺」),不是空 up/down 清單(那是「mv 有料但無 eligible」的
    合法空);index 側 close/median/spread 不受 mv 影響照常。"""
    out = compute_index_strength(_INDEX_ROWS, _UNIVERSE_ROWS, {}, _TYPE_MAP, _NAME_MAP)

    assert out["twse"]["close"] == 20100
    assert out["twse"]["median_change_rate"] == -1.0
    assert out["contrib"] == {"twse": None, "tpex": None}
    assert out["tsmc"] == {"change_rate": 2.0, "contrib_points": None}


def test_compute_index_strength_empty_universe() -> None:
    """空 universe:index 側 close/change_rate 仍在,median/spread 因無樣本 → None;
    contrib 兩側皆空 up/down;tsmc 全 None(2330 不在 universe)。"""
    out = compute_index_strength(_INDEX_ROWS, [], _MV_MAP, _TYPE_MAP, _NAME_MAP)

    assert out["twse"]["close"] == 20100
    assert out["twse"]["median_change_rate"] is None
    assert out["twse"]["spread"] is None
    assert out["contrib"]["twse"] == {"up": [], "down": []}
    assert out["tsmc"] == {"change_rate": None, "contrib_points": None}


def test_compute_index_strength_change_rate_null_excluded_from_median() -> None:
    """R8:change_rate null 的股不進 median 分母。"""
    rows = [
        {"stock_id": "2330", "change_rate": 2.0},
        {"stock_id": "2317", "change_rate": None},  # 剔除
        {"stock_id": "3008", "change_rate": -3.0},
    ]
    type_map = {"2330": "twse", "2317": "twse", "3008": "twse"}
    out = compute_index_strength(_INDEX_ROWS, rows, {}, type_map, {})
    # median([2.0, -3.0]) = -0.5(2317 null 已剔除,不是 median([2.0, None, -3.0]))
    assert out["twse"]["median_change_rate"] == -0.5


# ---------------------------------------------------------------------------
# compute_cap_tiers — SC-2
# ---------------------------------------------------------------------------


def test_compute_cap_tiers_three_buckets_hand_calc() -> None:
    """5 檔 mv desc 排,top50 邊界設 2 檔驗證分桶(用 monkeypatch 邊界不現實,
    改用小樣本驗證排序 + avg / up_ratio 計算邏輯,分桶邊界由另一測試覆蓋)。"""
    rows = [
        {"stock_id": "A", "change_rate": 2.0},
        {"stock_id": "B", "change_rate": -1.0},
        {"stock_id": "C", "change_rate": 0.0},  # 平盤,不計入 up_ratio 分子
        {"stock_id": "D", "change_rate": 3.0},
    ]
    mv_map = {"A": 100, "B": 400, "C": 300, "D": 200}
    out = compute_cap_tiers(rows, mv_map)

    assert out is not None
    assert len(out) == 1  # 4 檔全落 top50(< 50)
    tier = out[0]
    assert tier["tier"] == "top50"
    assert tier["members"] == 4
    # desc by mv: B(400,-1.0) D(200,3.0) C(300,0.0) A(100,2.0) — mv 排序不影響 avg/up_ratio(集合運算)
    assert tier["avg_change_rate"] == pytest.approx((2.0 - 1.0 + 0.0 + 3.0) / 4)
    assert tier["up_ratio"] == pytest.approx(2 / 4)  # A, D > 0；C 平盤不計


def test_compute_cap_tiers_boundary_50_150() -> None:
    """201 檔驗證 top50 / mid100(51-150)/ rest 邊界切位。"""
    rows = [{"stock_id": f"S{i}", "change_rate": 1.0} for i in range(201)]
    mv_map = {f"S{i}": 201 - i for i in range(201)}  # S0 mv 最大 … S200 mv 最小
    out = compute_cap_tiers(rows, mv_map)

    assert out is not None
    by_tier = {t["tier"]: t for t in out}
    assert by_tier["top50"]["members"] == 50
    assert by_tier["mid100"]["members"] == 100
    assert by_tier["rest"]["members"] == 51


def test_compute_cap_tiers_mv_missing_excluded() -> None:
    """R8:mv 缺的股剔除,不計入任何桶 / members。"""
    rows = [
        {"stock_id": "A", "change_rate": 1.0},
        {"stock_id": "B", "change_rate": -1.0},  # mv 缺
    ]
    mv_map = {"A": 100}
    out = compute_cap_tiers(rows, mv_map)
    assert out is not None
    assert len(out) == 1
    assert out[0]["members"] == 1


def test_compute_cap_tiers_change_rate_null_excluded() -> None:
    """R8:change_rate null 的股剔除。"""
    rows = [
        {"stock_id": "A", "change_rate": 1.0},
        {"stock_id": "B", "change_rate": None},
    ]
    mv_map = {"A": 100, "B": 200}
    out = compute_cap_tiers(rows, mv_map)
    assert out is not None
    assert out[0]["members"] == 1
    assert out[0]["avg_change_rate"] == 1.0


def test_compute_cap_tiers_empty_eligible_returns_none() -> None:
    """R8:空 universe / 全剔除 → None。"""
    assert compute_cap_tiers([], {}) is None
    rows = [{"stock_id": "A", "change_rate": None}]
    assert compute_cap_tiers(rows, {"A": 100}) is None


# ---------------------------------------------------------------------------
# compute_sector_rotation — SC-3
# ---------------------------------------------------------------------------


def test_compute_sector_rotation_none_when_chain_missing() -> None:
    assert compute_sector_rotation([{"stock_id": "2330", "change_rate": 1.0}], None) is None
    assert compute_sector_rotation([{"stock_id": "2330", "change_rate": 1.0}], {}) is None


def test_compute_sector_rotation_hand_calc_and_sort() -> None:
    chain = {
        "半導體業": {
            "IC設計": ["2454"],
            "晶圓代工": ["2330"],
        },
        "電子零組件業": {
            "被動元件": ["2412"],
        },
    }
    universe = [
        {"stock_id": "2454", "change_rate": 5.0, "total_volume": 100, "yesterday_volume": 50},
        {"stock_id": "2330", "change_rate": 1.0, "total_volume": 200, "yesterday_volume": 100},
        {"stock_id": "2412", "change_rate": -2.0, "total_volume": 30, "yesterday_volume": 60},
    ]
    out = compute_sector_rotation(universe, chain)
    assert out is not None
    industries = out["industries"]
    # avg desc: 半導體業 avg=(5+1)/2=3.0 > 電子零組件業 avg=-2.0
    assert [i["name"] for i in industries] == ["半導體業", "電子零組件業"]

    semi = industries[0]
    assert semi["members"] == 2
    assert semi["avg_change_rate"] == pytest.approx(3.0)
    # vol_ratio = (100+200)/(50+100) = 300/150 = 2.0
    assert semi["vol_ratio"] == pytest.approx(2.0)
    # subs desc by avg: IC設計(5.0) > 晶圓代工(1.0)
    assert [s["name"] for s in semi["subs"]] == ["IC設計", "晶圓代工"]

    electronic = industries[1]
    assert electronic["vol_ratio"] == pytest.approx(30 / 60)


def test_compute_sector_rotation_dedup_same_stock_multiple_subs_same_industry() -> None:
    """R8 邊界:一檔多桶 — 同產業內同 stock_id 出現在兩個 sub → industry 層去重一票。"""
    chain = {
        "半導體業": {
            "IC設計": ["2330"],
            "晶圓代工": ["2330"],  # 同股同產業另一 sub
        },
    }
    universe = [
        {"stock_id": "2330", "change_rate": 4.0, "total_volume": 100, "yesterday_volume": 50},
    ]
    out = compute_sector_rotation(universe, chain)
    assert out is not None
    semi = out["industries"][0]
    assert semi["members"] == 1  # 去重後只算一次,不是 2
    assert semi["avg_change_rate"] == pytest.approx(4.0)
    # sub 層各自獨立,兩個 sub 各自都有這檔(不去重)
    assert {s["name"] for s in semi["subs"]} == {"IC設計", "晶圓代工"}
    assert all(s["members"] == 1 for s in semi["subs"])


def test_compute_sector_rotation_change_rate_null_excluded() -> None:
    chain = {"半導體業": {"IC設計": ["2454", "2330"]}}
    universe = [
        {"stock_id": "2454", "change_rate": 5.0},
        {"stock_id": "2330", "change_rate": None},  # 剔除
    ]
    out = compute_sector_rotation(universe, chain)
    assert out is not None
    assert out["industries"][0]["members"] == 1
    assert out["industries"][0]["avg_change_rate"] == pytest.approx(5.0)


def test_compute_sector_rotation_vol_ratio_missing_field_excludes_from_both_sides() -> None:
    """R8:量比分子分母同步剔除 — 缺 yesterday_volume 的股不進 Σtotal_volume,
    避免不對稱剔除高估量比。"""
    chain = {"半導體業": {"IC設計": ["2454", "2330"]}}
    universe = [
        {"stock_id": "2454", "change_rate": 1.0, "total_volume": 1000, "yesterday_volume": 500},
        {"stock_id": "2330", "change_rate": 2.0, "total_volume": 9999},  # yesterday_volume 缺
    ]
    out = compute_sector_rotation(universe, chain)
    assert out is not None
    # 若未同步剔除,分子會誤含 2330 的 9999 → vol_ratio 被高估
    assert out["industries"][0]["vol_ratio"] == pytest.approx(1000 / 500)


def test_compute_sector_rotation_vol_ratio_denominator_zero_after_exclusion() -> None:
    """R8:剔除後分母 0 → vol_ratio None(不是 members 0 — avg 仍算)。"""
    chain = {"半導體業": {"IC設計": ["2454"]}}
    universe = [
        {"stock_id": "2454", "change_rate": 1.0},  # 兩個 volume 欄都缺
    ]
    out = compute_sector_rotation(universe, chain)
    assert out is not None
    assert out["industries"][0]["members"] == 1
    assert out["industries"][0]["vol_ratio"] is None


def test_compute_sector_rotation_zero_members_industry_skipped() -> None:
    """R8:成員 0 的產業(chain 內股票在 universe 全缺或 change_rate 全 null)略過。"""
    chain = {
        "半導體業": {"IC設計": ["2454"]},
        "冷門業": {"冷門子業": ["9999"]},  # 9999 不在 universe
    }
    universe = [{"stock_id": "2454", "change_rate": 1.0}]
    out = compute_sector_rotation(universe, chain)
    assert out is not None
    assert [i["name"] for i in out["industries"]] == ["半導體業"]


def test_compute_sector_rotation_empty_universe_returns_empty_industries() -> None:
    chain = {"半導體業": {"IC設計": ["2454"]}}
    out = compute_sector_rotation([], chain)
    assert out == {"industries": []}


# ---------------------------------------------------------------------------
# compute_sector_members — SC-3 drill-down
# ---------------------------------------------------------------------------


def test_compute_sector_members_unknown_industry_returns_none() -> None:
    chain = {"半導體業": {"IC設計": ["2454"]}}
    assert compute_sector_members([], chain, {}, "不存在的產業") is None


def test_compute_sector_members_unknown_sub_industry_returns_none() -> None:
    chain = {"半導體業": {"IC設計": ["2454"]}}
    universe = [{"stock_id": "2454", "change_rate": 1.0}]
    assert compute_sector_members(universe, chain, {}, "半導體業", "不存在子業") is None


def test_compute_sector_members_sub_industry_filters_and_sorts() -> None:
    chain = {"半導體業": {"IC設計": ["2454", "2330"], "晶圓代工": ["3008"]}}
    universe = [
        {"stock_id": "2454", "change_rate": -1.0, "total_volume": 100, "yesterday_volume": 50,
         "total_amount": 999},
        {"stock_id": "2330", "change_rate": 5.0, "total_volume": 0, "yesterday_volume": 100,
         "total_amount": 111},
    ]
    name_map = {"2454": "聯發科", "2330": "台積電"}
    out = compute_sector_members(universe, chain, name_map, "半導體業", "IC設計")
    assert out == {
        "industry": "半導體業",
        "sub_industry": "IC設計",
        "members": [
            {"stock_id": "2330", "name": "台積電", "change_rate": 5.0,
             "vol_ratio": pytest.approx(0.0), "total_amount": 111},
            {"stock_id": "2454", "name": "聯發科", "change_rate": -1.0,
             "vol_ratio": pytest.approx(2.0), "total_amount": 999},
        ],
    }


def test_compute_sector_members_no_sub_industry_unions_all_subs() -> None:
    chain = {"半導體業": {"IC設計": ["2454"], "晶圓代工": ["2330"]}}
    universe = [
        {"stock_id": "2454", "change_rate": 1.0},
        {"stock_id": "2330", "change_rate": 2.0},
    ]
    out = compute_sector_members(universe, chain, {}, "半導體業")
    assert out["sub_industry"] is None
    assert {m["stock_id"] for m in out["members"]} == {"2454", "2330"}


def test_compute_sector_members_null_change_rate_sorted_last() -> None:
    chain = {"半導體業": {"IC設計": ["A", "B", "C"]}}
    universe = [
        {"stock_id": "A", "change_rate": None},
        {"stock_id": "B", "change_rate": 3.0},
        {"stock_id": "C", "change_rate": -1.0},
    ]
    out = compute_sector_members(universe, chain, {}, "半導體業", "IC設計")
    assert [m["stock_id"] for m in out["members"]] == ["B", "C", "A"]


def test_compute_sector_members_vol_ratio_missing_or_zero_denominator_is_none() -> None:
    chain = {"半導體業": {"IC設計": ["A", "B"]}}
    universe = [
        {"stock_id": "A", "change_rate": 1.0, "total_volume": 100},  # yesterday_volume 缺
        {"stock_id": "B", "change_rate": 1.0, "total_volume": 100, "yesterday_volume": 0},
    ]
    out = compute_sector_members(universe, chain, {}, "半導體業", "IC設計")
    assert all(m["vol_ratio"] is None for m in out["members"])


# ---------------------------------------------------------------------------
# MK-5/7(mod/batch-ui-update)— compute_breadth:漲跌家數 + 全量 rows
# ---------------------------------------------------------------------------

_BREADTH_TYPE_MAP = {"1101": "twse", "1102": "twse", "1103": "twse", "6001": "tpex"}


def _brow(sid: str, close: float, change_price: float, chg: float, **over: object) -> dict:
    return {
        "stock_id": sid,
        "close": close,
        "change_price": change_price,
        "change_rate": chg,
        "total_volume": 3000,
        "yesterday_volume": 2000,
        "total_amount": 1_000_000,
        **over,
    }


def test_compute_breadth_buckets_exclusive_hand_calc() -> None:
    # 痛點:MK-5 — 漲停判定用 prev_close = close − change_price + tick 規則,
    # 桶互斥(漲停不重複計入上漲)。
    universe = [
        _brow("1101", 110.0, 10.0, 10.0),  # prev 100 → 漲停價 110.0 → limit_up
        _brow("1102", 105.0, 5.0, 5.0),    # 上漲(未達 110)
        _brow("1103", 90.0, -10.0, -10.0),  # prev 100 → 跌停價 90.0 → limit_down
        _brow("6001", 50.0, 0.0, 0.0),      # 平盤(tpex)
    ]
    out = compute_breadth(universe, _BREADTH_TYPE_MAP, {"1101": "台泥A"})
    assert out["twse"] == {"limit_up": 1, "up": 1, "flat": 0, "down": 0, "limit_down": 1}
    assert out["tpex"] == {"limit_up": 0, "up": 0, "flat": 1, "down": 0, "limit_down": 0}
    by_id = {r["stock_id"]: r for r in out["rows"]}
    assert by_id["1101"]["limit_up"] is True
    assert by_id["1101"]["name"] == "台泥A"
    assert by_id["1101"]["market"] == "twse"
    assert by_id["1102"]["limit_up"] is False
    assert by_id["1103"]["limit_down"] is True
    assert by_id["1102"]["volume_ratio"] == pytest.approx(1.5)


def test_compute_breadth_tick_rounding_boundary() -> None:
    # 痛點:R4 — 漲停價非整數倍時向內取 tick(prev 56.5 → raw 62.15 →
    # tick 0.1 → 漲停 62.1,change_rate 僅 9.91% 仍應判漲停);
    # 9.8% 近似法在此類 case 靠運氣,tick 規則是決定性的。
    universe = [
        _brow("1101", 62.1, 5.6, 9.91),  # prev = 62.1 − 5.6 = 56.5
        _brow("1102", 62.0, 5.5, 9.73),  # 同價位但未達 62.1 → 只是上漲
    ]
    tmap = {"1101": "twse", "1102": "twse"}
    out = compute_breadth(universe, tmap, {})
    assert out["twse"]["limit_up"] == 1
    assert out["twse"]["up"] == 1


def test_compute_breadth_null_change_rate_skipped_and_prev_missing_no_limit() -> None:
    universe = [
        {"stock_id": "1101", "close": 100.0, "change_price": 1.0, "change_rate": None},
        # prev 不可得(change_price 缺)
        {"stock_id": "1102", "close": 105.0, "change_price": None, "change_rate": 5.0,
         "total_volume": 3000, "yesterday_volume": 2000, "total_amount": 1_000_000},
    ]
    tmap = {"1101": "twse", "1102": "twse"}
    out = compute_breadth(universe, tmap, {})
    # 1101 change_rate null → 整檔跳過;1102 prev 缺 → 不判 limit,仍計上漲
    assert out["twse"] == {"limit_up": 0, "up": 1, "flat": 0, "down": 0, "limit_down": 0}
    assert len(out["rows"]) == 1
    assert out["rows"][0]["limit_up"] is False


def test_compute_breadth_unknown_market_excluded_and_empty_returns_none() -> None:
    universe = [_brow("9999", 100.0, 1.0, 1.0)]  # type_map 查無 → 排除
    assert compute_breadth(universe, {}, {}) is None
    assert compute_breadth([], _BREADTH_TYPE_MAP, {}) is None
