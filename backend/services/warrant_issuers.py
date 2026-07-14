"""權證發行商對照 + 信任排行 — TWSE t187ap36_L / TPEx mopsfin_t187ap36_O。

對照層:兩市場發行人對照表(零配額)→ {wid: {issuer_id, issuer_name}},7 天級 cache。
排行層:iv_history 最近兩週 archive → per-issuer 三指標(兩週 bid-IV std 中位數 /
價差比中位數 / declining 占比),對齊 TWSE 評等 30/20/20 相對權重(歸一 3/7·2/7·2/7;
官方「週轉率 30%」係成交活躍度非造市品質,捨棄;「買一金額 20%」archive 無掛單金額,
以 declining_share 替代)。收盤報價 proxy,非官方盤中口徑(change-spec SC-2)。

熱路徑鐵則(change-spec R1):get_underlying_warrants 的 merge 只走 sync cached
accessor(mem/檔 → 空 map + 背景 fetch),絕不同步 await 上游。
樣板 = services/warrants.py(TLS/_run_once/FAKE/cache 同構)。
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl
import statistics
from datetime import date as date_type
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from services import clock
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
MAP_FILE = "warrant_issuer_map_latest.json"
RANK_FILE = "warrant_issuer_rank_latest.json"
MAP_TTL_DAYS = 7  # 權證每週掛牌,月級太久(change-spec R7)
TWO_WEEK_FILES = 10  # 官方「兩週」proxy:最近 10 個交易日檔
MIN_IVB_POINTS = 8  # 兩週窗有效 ivb 點門檻(容忍 2 洞)
MIN_SPREAD_DAYS = 8  # spread 有效日門檻(沿同一容忍度,R5)
MIN_SAMPLE_FOR_TIER = 5  # n_scored 低於此 → rank/tier=null(R4)
CLIFF_CALENDAR_DAYS = 21  # ≈ 法規 15 交易日(無交易日曆基建,日曆日 proxy)
W_IV, W_SPREAD, W_DECLINING = 3 / 7, 2 / 7, 2 / 7  # 歸一權重(R3-2)
_UA = "Mozilla/5.0 (neigui-backend)"
T187AP36_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap36_L"
MOPSFIN_36O_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap36_O"
# 全稱裁剪字尾(長在前,依序試):裁不動保留原字串,不硬編猜測表
_NAME_SUFFIXES = ("綜合證券股份有限公司", "證券股份有限公司", "股份有限公司")

_client: httpx.AsyncClient | None = None
_inflight: dict[str, dict[str, Any]] = {}
_map_mem: dict | None = None  # {"_cache_version", "fetched_on", "map"}
_rank_mem: dict | None = None  # compute_issuer_rank 輸出 + "_cache_version"
_map_bg_task: asyncio.Task | None = None


# ---------------------------------------------------------------- local 複製 helpers


def _ssl_context() -> ssl.SSLContext:
    """TPEx 憑證缺 SKI,關 VERIFY_X509_STRICT(非 verify=False;twse-tpex-conventions)。"""
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=60.0, headers={"User-Agent": _UA}, verify=_ssl_context()
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        finally:
            _client = None


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup(subscriber refcount + shield)— warrants.py 同構。"""
    entry = _inflight.get(key)
    if entry is None:
        entry = {"task": asyncio.ensure_future(coro_fn()), "refs": 0}
        _inflight[key] = entry
    entry["refs"] += 1
    try:
        return await asyncio.shield(entry["task"])
    finally:
        entry["refs"] -= 1
        if entry["refs"] == 0:
            if not entry["task"].done():
                entry["task"].cancel()
            _inflight.pop(key, None)


def _fixtures_dir() -> Path:
    raw = os.getenv("FAKE_FINMIND_FIXTURES_DIR", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[1] / "tests_e2e" / "fixtures"


def _read_fixture(name: str) -> Any:
    return read_json(_fixtures_dir() / "warrants" / name)  # 檔缺 = None,視同空表


def _row_get(row: dict, key: str) -> Any:
    """stripped-key lookup(TPEx 欄名 leading space 有無不定)。"""
    for k, v in row.items():
        if k.strip() == key:
            return v
    return None


# ---------------------------------------------------------------- 對照層(SC-1)


def _short_issuer_name(name: str) -> str:
    s = name.strip()
    for suffix in _NAME_SUFFIXES:
        if s.endswith(suffix) and len(s) > len(suffix):
            return s[: -len(suffix)]
    return s


async def _fetch_twse_rows() -> list:
    if os.getenv("FAKE_FINMIND") == "1":
        return _read_fixture("t187ap36_L.json") or []
    resp = await _get_client().get(T187AP36_URL)
    resp.raise_for_status()
    return resp.json()


async def _fetch_tpex_rows() -> list:
    if os.getenv("FAKE_FINMIND") == "1":
        return _read_fixture("mopsfin_t187ap36_O.json") or []
    resp = await _get_client().get(MOPSFIN_36O_URL)
    resp.raise_for_status()
    return resp.json()


def _build_map_from_rows(twse_rows: list, tpex_rows: list) -> dict[str, dict]:
    """兩市場合併:issuer_id 為 join key,名稱 TPEx 簡稱優先、否則 TWSE 裁剪(R7)。"""
    name_by_issuer: dict[str, str] = {}
    for row in tpex_rows:  # TPEx 先寫(簡稱)
        iid = str(_row_get(row, "發行人代號") or "").strip()
        name = str(_row_get(row, "發行人名稱") or "").strip()
        if iid and name:
            name_by_issuer.setdefault(iid, name)
    for row in twse_rows:
        iid = str(_row_get(row, "發行人代號") or "").strip()
        name = str(_row_get(row, "發行人名稱") or "").strip()
        if iid and name:
            name_by_issuer.setdefault(iid, _short_issuer_name(name))

    out: dict[str, dict] = {}
    for row in list(tpex_rows) + list(twse_rows):
        wid = str(_row_get(row, "權證代號") or "").strip()
        iid = str(_row_get(row, "發行人代號") or "").strip()
        if not wid or not iid or iid not in name_by_issuer:
            continue
        out[wid] = {"issuer_id": iid, "issuer_name": name_by_issuer[iid]}
    return out


def _map_is_fresh(payload: Any) -> bool:
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return False
    try:
        fetched = date_type.fromisoformat(payload.get("fetched_on") or "")
    except ValueError:
        return False
    return (clock.today() - fetched).days < MAP_TTL_DAYS


async def _build_map() -> dict[str, dict]:
    twse_rows: list = []
    tpex_rows: list = []
    try:
        twse_rows = await _fetch_twse_rows()
    except (httpx.HTTPError, ValueError):  # 單源故障不炸另一源(SC-1)
        logger.exception("issuer map: TWSE t187ap36_L fetch failed")
    try:
        tpex_rows = await _fetch_tpex_rows()
    except (httpx.HTTPError, ValueError):
        logger.exception("issuer map: TPEx mopsfin_t187ap36_O fetch failed")
    built = _build_map_from_rows(twse_rows, tpex_rows)
    if not built:
        return {}
    payload = {
        "_cache_version": _CACHE_VERSION,
        "fetched_on": clock.today().isoformat(),
        "map": built,
    }
    global _map_mem
    _map_mem = payload
    if os.getenv("FAKE_FINMIND") != "1":
        atomic_write_json(chip_cache_dir() / MAP_FILE, payload)
    return built


async def get_issuer_map(refresh: bool = False) -> dict[str, dict]:
    """完整 accessor(rank build / 測試用;熱路徑走 get_issuer_map_cached)。"""
    global _map_mem
    if not refresh:
        if _map_mem is not None and _map_is_fresh(_map_mem):
            return _map_mem["map"]
        payload = read_json(chip_cache_dir() / MAP_FILE)
        if _map_is_fresh(payload):
            _map_mem = payload
            return payload["map"]
    return await _run_once("issuer_map", _build_map)


def get_issuer_map_cached() -> dict[str, dict]:
    """sync accessor(SC-4 熱路徑):mem → 檔 → 空 map + 背景 fetch。

    絕不同步 await 上游 — quotes 15s 輪詢鏈經 get_underlying_warrants 走到這裡。
    """
    global _map_mem, _map_bg_task
    if _map_mem is not None and _map_is_fresh(_map_mem):
        return _map_mem["map"]
    if os.getenv("FAKE_FINMIND") == "1":
        built = _build_map_from_rows(
            _read_fixture("t187ap36_L.json") or [], _read_fixture("mopsfin_t187ap36_O.json") or []
        )
        _map_mem = {
            "_cache_version": _CACHE_VERSION,
            "fetched_on": clock.today().isoformat(),
            "map": built,
        }
        return built
    payload = read_json(chip_cache_dir() / MAP_FILE)
    if _map_is_fresh(payload):
        _map_mem = payload
        return payload["map"]
    if _map_bg_task is None or _map_bg_task.done():
        _map_bg_task = asyncio.ensure_future(_map_bg())
    return {}


async def _map_bg() -> None:
    try:
        await _run_once("issuer_map", _build_map)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("issuer map background fetch failed")


# ---------------------------------------------------------------- 排行層(SC-2)


def _warrant_metrics(
    wid: str, window: list[tuple[str, dict]]
) -> tuple[float | None, float | None]:
    """單一權證:(兩週 ivb std, spread 日值中位數)。點數不足回 None。"""
    ivbs: list[float] = []
    spreads: list[float] = []
    for _, payload in window:
        entry = payload["warrants"].get(wid)
        if not entry:
            continue
        ivb = entry.get("ivb")
        if isinstance(ivb, (int, float)):
            ivbs.append(float(ivb))
        b, a = entry.get("b"), entry.get("a")
        # R5:b/a 缺、b≤0、倒掛之日跳過
        if isinstance(b, (int, float)) and isinstance(a, (int, float)) and b > 0 and a >= b:
            spreads.append((a - b) / b)
    iv_std = statistics.stdev(ivbs) if len(ivbs) >= MIN_IVB_POINTS else None
    spread = statistics.median(spreads) if len(spreads) >= MIN_SPREAD_DAYS else None
    return iv_std, spread


def _normalize(value: float, lo: float, hi: float) -> float:
    if hi == lo:  # R2-2:退化 → 0,不產 NaN
        return 0.0
    return (value - lo) / (hi - lo)


def compute_issuer_rank(
    archives: list[tuple[str, dict]],
    drift_map: dict[str, dict],
    terms_by_wid: dict[str, dict],
    issuer_map: dict[str, dict],
) -> dict:
    """純函式零 IO。輸出 {"as_of_date", "built_from_days", "issuers": [...]}。"""
    window = archives[-TWO_WEEK_FILES:]
    as_of = window[-1][0] if window else None
    as_of_date = date_type.fromisoformat(as_of) if as_of else None

    seen_wids: set[str] = set()
    for _, payload in window:
        seen_wids.update(payload["warrants"].keys())

    mapped = [w for w in seen_wids if w in issuer_map]
    if seen_wids:
        logger.info(
            "issuer rank: archive wid coverage %d/%d (%.1f%%)",
            len(mapped), len(seen_wids), 100.0 * len(mapped) / len(seen_wids),
        )

    by_issuer: dict[str, dict] = {}
    for wid in mapped:
        info = issuer_map[wid]
        agg = by_issuer.setdefault(
            info["issuer_id"],
            {"issuer_name": info["issuer_name"], "wids": [], "scored": []},
        )
        agg["wids"].append(wid)

        term = terms_by_wid.get(wid)
        if as_of_date is not None and term and term.get("last_trading_date"):
            try:
                ltd = date_type.fromisoformat(term["last_trading_date"])
            except ValueError:
                ltd = None
            if ltd is not None and (ltd - as_of_date).days <= CLIFF_CALENDAR_DAYS:
                continue  # 近到期不計分(合法只買報價區,change-spec SC-2)

        iv_std, spread = _warrant_metrics(wid, window)
        if iv_std is None:
            continue  # 兩週窗有效點不足 → 不計分
        agg["scored"].append(
            {"wid": wid, "iv_std": iv_std, "spread": spread,
             "label": (drift_map.get(wid) or {}).get("label")}
        )

    issuers: list[dict] = []
    for iid, agg in by_issuer.items():
        scored = agg["scored"]
        n_scored = len(scored)
        iv_std_median = spread_median = declining_share = None
        if n_scored:
            iv_std_median = statistics.median(s["iv_std"] for s in scored)
            spreads = [s["spread"] for s in scored if s["spread"] is not None]
            spread_median = statistics.median(spreads) if spreads else None
            labeled = [s for s in scored if s["label"] and s["label"] != "insufficient"]
            if labeled:
                declining_share = sum(
                    1 for s in labeled if s["label"] == "declining"
                ) / len(labeled)
        issuers.append(
            {
                "issuer_id": iid,
                "issuer_name": agg["issuer_name"],
                "n_warrants": len(agg["wids"]),
                "n_scored": n_scored,
                "iv_std_median": iv_std_median,
                "spread_median": spread_median,
                "declining_share": declining_share,
                "composite": None,
                "rank": None,
                "tier": None,
            }
        )

    def _complete(r: dict) -> bool:
        return (
            r["iv_std_median"] is not None
            and r["spread_median"] is not None
            and r["declining_share"] is not None
        )

    eligible = [r for r in issuers if r["n_scored"] >= MIN_SAMPLE_FOR_TIER and _complete(r)]
    if eligible:
        bounds = {
            key: (min(r[key] for r in eligible), max(r[key] for r in eligible))
            for key in ("iv_std_median", "spread_median", "declining_share")
        }
        for r in issuers:  # n_scored<5 者照公式算 composite,但不入 rank/tier(R4)
            if not _complete(r):
                continue
            r["composite"] = (
                W_IV * _normalize(r["iv_std_median"], *bounds["iv_std_median"])
                + W_SPREAD * _normalize(r["spread_median"], *bounds["spread_median"])
                + W_DECLINING * _normalize(r["declining_share"], *bounds["declining_share"])
            )
        ranked = sorted(eligible, key=lambda r: (r["composite"], r["issuer_id"]))
        n = len(ranked)
        cut1, cut2 = -(-n // 3), -(-2 * n // 3)  # ceil 三分位
        for i, r in enumerate(ranked):
            r["rank"] = i + 1
            r["tier"] = "front" if i < cut1 else ("mid" if i < cut2 else "back")

    issuers.sort(key=lambda r: (r["rank"] is None, r["rank"] or 0, r["issuer_id"]))
    return {
        "_cache_version": _CACHE_VERSION,
        "as_of_date": as_of,
        "built_from_days": len(window),
        "issuers": issuers,
    }


async def get_issuer_rank(refresh: bool = False) -> dict | None:
    """lazy 入口:None = not ready(route → 503 issuer_rank_not_ready)。"""
    global _rank_mem
    from services import warrant_iv_history as ivh  # 防循環(同 warrants R10 模式)
    from services import warrants

    archives = await ivh.load_recent_archives(TWO_WEEK_FILES)
    if not archives:
        return None
    latest = archives[-1][0]
    if not refresh and _rank_mem is not None and _rank_mem.get("as_of_date") == latest:
        return _rank_mem
    if not refresh and os.getenv("FAKE_FINMIND") != "1":
        payload = read_json(chip_cache_dir() / RANK_FILE)
        if (
            isinstance(payload, dict)
            and payload.get("_cache_version") == _CACHE_VERSION
            and payload.get("as_of_date") == latest
        ):
            _rank_mem = payload
            return payload

    async def _build() -> dict | None:
        try:
            snap = await warrants.get_snapshot(refresh=False)
        except httpx.HTTPError:
            logger.warning("issuer rank: snapshot unavailable")
            return None
        terms_by_wid = {
            w["warrant_id"]: w
            for rows in (snap.get("by_underlying") or {}).values()
            for w in rows
        }
        drift = await ivh.get_drift_map()
        imap = await get_issuer_map()
        result = compute_issuer_rank(archives, drift, terms_by_wid, imap)
        if not any(r["n_scored"] for r in result["issuers"]):
            return None  # 全市場 n_scored=0 → not ready(R4)
        global _rank_mem
        _rank_mem = result
        if os.getenv("FAKE_FINMIND") != "1":
            atomic_write_json(chip_cache_dir() / RANK_FILE, result)
        return result

    return await _run_once(f"issuer_rank_{latest}_r{int(refresh)}", _build)


def get_issuer_tier_cached() -> dict[str, str]:
    """sync accessor(selector 列 merge 用):{issuer_id: tier};rank 未 build → {}。

    不 spawn 背景 build(rank 計算重,由面板 endpoint 需求驅動)。
    """
    payload = _rank_mem
    if payload is None:
        disk = read_json(chip_cache_dir() / RANK_FILE)
        if isinstance(disk, dict) and disk.get("_cache_version") == _CACHE_VERSION:
            payload = disk
    if not isinstance(payload, dict):
        return {}
    return {
        r["issuer_id"]: r["tier"]
        for r in payload.get("issuers") or []
        if r.get("tier")
    }
