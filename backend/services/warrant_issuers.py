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
import re
import ssl
import statistics
import time
from datetime import date as date_type
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from services import clock
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 2  # v2:payload 增 by_name lexicon(名稱解析 fallback)
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
# 名稱解析 fallback 的 in-name 變體:canonical 簡稱在權證名內常縮兩字
# (永豐金→永豐、群益金鼎→群益,由前二字裁切覆蓋);中國信託→中信是唯一
# 前二字救不了的顯式 alias(2026-07-14 real-env)
_NAME_ALIASES: dict[str, tuple[str, ...]] = {"中國信託": ("中信",)}

MAP_RETRY_COOLDOWN_SEC = 60.0  # 兩源全失敗後的重試 backoff(同 warrants R2-1)

_client: httpx.AsyncClient | None = None
_inflight: dict[str, dict[str, Any]] = {}
_map_mem: dict | None = None  # {"_cache_version", "fetched_on", "map"}(可為 stale)
_rank_mem: dict | None = None  # compute_issuer_rank 輸出 + "_cache_version"
_rank_disk_checked = False  # tier accessor negative marker(檔缺不重複掃磁碟)
_map_bg_task: asyncio.Task | None = None
_last_map_attempt: float | None = None  # 失敗 build 時間戳;成功清 None
_monotonic = time.monotonic  # 測試以 monkeypatch 換假鐘


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
    """兩市場合併:issuer_id 為 join key,名稱 TPEx 簡稱優先、否則 TWSE 裁剪(R7)。

    權證代號跨年回收(real-env 實證 36_L 1,967 個重複代號)→ 同 wid 取
    申請發行日期最新;並帶 underlying_id 供 merge/計分端做「舊代號殘留」
    比對防護(現行權證未入表時,舊列標的必不符 → 視同無對映)。
    """
    name_by_issuer: dict[str, str] = {}
    # 兩源一律過 _short_issuer_name(冪等):TPEx 名稱不保證是簡稱
    # (2026-07-14 real-env:台新/群益回全稱),TPEx 先寫維持簡稱優先語義
    for row in list(tpex_rows) + list(twse_rows):
        iid = str(_row_get(row, "發行人代號") or "").strip()
        name = str(_row_get(row, "發行人名稱") or "").strip()
        if iid and name:
            name_by_issuer.setdefault(iid, _short_issuer_name(name))

    best_date: dict[str, str] = {}
    out: dict[str, dict] = {}
    for row in list(tpex_rows) + list(twse_rows):
        wid = str(_row_get(row, "權證代號") or "").strip()
        iid = str(_row_get(row, "發行人代號") or "").strip()
        if not wid or not iid or iid not in name_by_issuer:
            continue
        applied = str(_row_get(row, "申請發行日期") or "").strip()  # 民國緊湊,同長可比序
        if wid in out and applied <= best_date.get(wid, ""):
            continue
        best_date[wid] = applied
        out[wid] = {
            "issuer_id": iid,
            "issuer_name": name_by_issuer[iid],
            "underlying_id": str(_row_get(row, "標的代號") or "").strip() or None,
        }
    # by_name lexicon:{canonical 簡稱: issuer_id},名稱解析 fallback 用
    # (36_L 是年度表,新申請權證未入表 → real-env 覆蓋率僅 ~23%,fallback 必要)
    return {"map": out, "by_name": {name_by_issuer[i]: i for i in name_by_issuer}}


def _as_tables(obj: dict) -> dict:
    """向後相容:純 wid map(測試/舊呼叫)→ 包成 tables shape。"""
    if "map" in obj and "by_name" in obj:
        return obj
    return {"map": obj, "by_name": {}}


def _resolve_by_name(by_name: dict[str, str], name: str) -> dict | None:
    """權證簡稱解析:{標的}{發行商}{年月碼}{購|售}{序號} — 以 lookahead 錨定
    「年月碼+購/售」防標的名含發行商字樣誤中(統一 1216 × 統一證券)。"""
    best: tuple[int, str, str] | None = None  # (變體長, canonical, iid)
    for canonical, iid in by_name.items():
        variants = {canonical, canonical[:2], *_NAME_ALIASES.get(canonical, ())}
        for v in variants:
            if len(v) < 2:
                continue
            if re.search(re.escape(v) + r"(?=[0-9A-Z]{2}[購售])", name) and (
                best is None or len(v) > best[0]
            ):
                best = (len(v), canonical, iid)
    if best is None:
        return None
    return {"issuer_id": best[2], "issuer_name": best[1]}


def resolve_issuer(
    tables: dict, wid: str, underlying_id: str | None, name: str | None = None
) -> dict | None:
    """三層解析:官方對映(標的相符)→ 名稱解析 fallback → None。

    舊代號殘留防護:map 標的與現行權證標的不符(代號跨年回收且現行未入表)
    → 不用官方對映,改走名稱解析。
    """
    t = _as_tables(tables)
    info = t["map"].get(wid)
    if info is not None:
        mapped_uid = info.get("underlying_id")
        if not (mapped_uid and underlying_id and mapped_uid != underlying_id):
            return info
    if not name:
        return None
    return _resolve_by_name(t["by_name"], name)


def _map_is_fresh(payload: Any) -> bool:
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return False
    try:
        fetched = date_type.fromisoformat(payload.get("fetched_on") or "")
    except ValueError:
        return False
    return (clock.today() - fetched).days < MAP_TTL_DAYS


async def _build_map() -> dict[str, dict]:
    """失敗才記 _last_map_attempt(cooldown 只擋「失敗後重試」;建置進行中的
    並發呼叫走 _run_once 合流,不得被 cooldown 誤擋 — real-env 503 實證)。"""
    global _last_map_attempt
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
    tables = _build_map_from_rows(twse_rows, tpex_rows)
    if not tables["map"]:
        _last_map_attempt = _monotonic()  # 失敗:60s cooldown 生效
        return {}
    _last_map_attempt = None  # 成功:解除 backoff
    payload = {
        "_cache_version": _CACHE_VERSION,
        "fetched_on": clock.today().isoformat(),
        **tables,
    }
    global _map_mem
    _map_mem = payload
    if os.getenv("FAKE_FINMIND") != "1":
        atomic_write_json(chip_cache_dir() / MAP_FILE, payload)
    return tables["map"]


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
        # build backoff:上次失敗 60s 內不重打上游;有過期舊 map 就先用
        if (
            _last_map_attempt is not None
            and _monotonic() - _last_map_attempt < MAP_RETRY_COOLDOWN_SEC
        ):
            if isinstance(payload, dict) and payload.get("_cache_version") == _CACHE_VERSION:
                return payload["map"]
            return {}
    return await _run_once("issuer_map", _build_map)


def _spawn_map_bg() -> None:
    """背景刷新(cooldown 閘門:失敗後 60s 內不重排,防輪詢放大成重試風暴)。"""
    global _map_bg_task
    if _last_map_attempt is not None and _monotonic() - _last_map_attempt < MAP_RETRY_COOLDOWN_SEC:
        return
    if _map_bg_task is None or _map_bg_task.done():
        _map_bg_task = asyncio.ensure_future(_map_bg())


def get_issuer_map_cached() -> dict[str, dict]:
    """sync accessor(SC-4 熱路徑):mem → 檔(stale 亦可用)→ 空 map + 背景 fetch。

    絕不同步 await 上游 — quotes 15s 輪詢鏈經 get_underlying_warrants 走到這裡。
    stale-while-revalidate:過期對照先端出(發行人對映幾乎不變),背景刷新。
    """
    global _map_mem
    if os.getenv("FAKE_FINMIND") == "1":
        if _map_mem is not None:
            return _map_mem["map"]
        tables = _build_map_from_rows(
            _read_fixture("t187ap36_L.json") or [], _read_fixture("mopsfin_t187ap36_O.json") or []
        )
        _map_mem = {
            "_cache_version": _CACHE_VERSION,
            "fetched_on": clock.today().isoformat(),
            **tables,
        }
        return tables["map"]
    if _map_mem is None:
        payload = read_json(chip_cache_dir() / MAP_FILE)
        if isinstance(payload, dict) and payload.get("_cache_version") == _CACHE_VERSION:
            _map_mem = payload  # 過期也先收 mem(下方判斷是否需背景刷新)
    if _map_mem is not None:
        if not _map_is_fresh(_map_mem):
            _spawn_map_bg()
        return _map_mem["map"]
    _spawn_map_bg()
    return {}


def get_issuer_lexicon_cached() -> dict[str, str]:
    """{canonical 簡稱: issuer_id} — 名稱解析 fallback 用;隨 _map_mem 生命週期,
    呼叫前先走 get_issuer_map_cached()(它負責載 mem),此處零 IO。"""
    if _map_mem is None:
        return {}
    return _map_mem.get("by_name") or {}


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
    # clamp:小樣本者用合格集 bounds 正規化可能越界,composite 鎖 [0,1]
    return min(1.0, max(0.0, (value - lo) / (hi - lo)))


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

    by_issuer: dict[str, dict] = {}
    attributed = 0
    for wid in seen_wids:
        term = terms_by_wid.get(wid)
        info = resolve_issuer(
            issuer_map, wid, (term or {}).get("underlying_id"), (term or {}).get("name")
        )
        if info is None:
            continue  # 無對映且名稱解析不中(或舊代號殘留標的不符)
        attributed += 1
        agg = by_issuer.setdefault(
            info["issuer_id"],
            {"issuer_name": info["issuer_name"], "wids": [], "scored": []},
        )
        agg["wids"].append(wid)

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

    if seen_wids:
        logger.info(
            "issuer rank: archive wid coverage %d/%d (%.1f%%)",
            attributed, len(seen_wids), 100.0 * attributed / len(seen_wids),
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
    磁碟只掃一次:命中回寫 _rank_mem、miss 記 negative marker —
    這條在 quotes 15s 輪詢熱路徑上,不得每 request 阻塞 IO(review 修正批)。
    """
    global _rank_mem, _rank_disk_checked
    payload = _rank_mem
    if payload is None and not _rank_disk_checked:
        _rank_disk_checked = True
        disk = read_json(chip_cache_dir() / RANK_FILE)
        if isinstance(disk, dict) and disk.get("_cache_version") == _CACHE_VERSION:
            _rank_mem = disk
            payload = disk
    if not isinstance(payload, dict):
        return {}
    return {
        r["issuer_id"]: r["tier"]
        for r in payload.get("issuers") or []
        if r.get("tier")
    }
