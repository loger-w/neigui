"""權證 bid/ask IV 歷史 archive + drift summary(warrant-iv-drift design v4)。

三條供給線:
- daily:snapshot build 成功後背景 archive 當日 distilled IV(R2/R11/R21);
- backfill:lifespan 背景補 60 交易日(TWSE MI_INDEX 回溯 + TPEx 舊站 wn1430,
  標的價缺口走 FinMind range,R16/R19/R23);
- 讀取:drift summary lazy accessor(R1/R14)+ per-underlying 序列 LRU(R12)。

TWSE/TPEx 直抓不占 FinMind 配額;_run_once / _ssl_context / _parse_price 為
local 複製(跨模組共用私有函式禁止,twse-tpex-conventions)。
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl
import time
from datetime import date as date_type, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from services import clock
from services import warrants as warrants_mod
from services.finmind import get_finmind
from services.warrant_iv_drift import detect_drift, flatten_drift
from services.warrant_pricing import RISK_FREE_RATE, implied_vol
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
HISTORY_DIR = "warrant_iv_history"
DRIFT_FILE = "warrant_iv_drift_latest.json"
WINDOW_FILES = 60  # 讀取窗(與 design §1/§6 一致,R7)
PRUNE_KEEP = 90  # archive 保留上限(R7;來源可重抓,非唯一副本)
IV_YIELD_EVERY = 500  # IV 反解純 CPU 讓出 event loop(沿 warrants 慣例)
DRIFT_YIELD_EVERY = 200  # rebuild 逐權證 detect 讓出(R13)
_SERIES_LRU_CAP = 4
_NONTRADING_RETRY_SLEEP = 5.0  # R15:transient 空回與真非交易日不可區分,retry 一次
NONTRADING_FILE = "warrant_iv_nontrading.json"
_NONTRADING_TTL_DAYS = 7  # marker 重驗週期:雙空誤判(機率 p² 級)最遲 7 天自癒
_UA = "Mozilla/5.0 (neigui-backend)"
WN1430_URL = (
    "https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php"
)

_client: httpx.AsyncClient | None = None
_inflight: dict[str, dict[str, Any]] = {}
_drift_mem: dict | None = None  # {"_cache_version", "built_from", "drift"};空 dict 也是 built marker
_series_lru: dict[str, dict] = {}  # {underlying_id: {"latest","gen","dates","by_wid","approx_dates"}}
_rebuild_generation = 0  # R12:rebuild 完成 +1;組裝 insert 前比對
_post_build_task: asyncio.Task | None = None
_backfill_task: asyncio.Task | None = None
_rebuild_bg_task: asyncio.Task | None = None


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


def _parse_price(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s in ("---", "-"):
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup(subscriber refcount + shield)— warrants 同構 local 複製。"""
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


# ---------------------------------------------------------------- day files


def _history_dir() -> Path:
    return chip_cache_dir() / HISTORY_DIR


def _has_tpex(warrants: dict) -> bool:
    """TPEx 權證代號域 = 7xxxxx、TWSE 權證 0 開頭 → prefix 即市場判別。
    無 TPEx 的日檔 = se=EW 時代殘檔或 daily R3 窗口檔,是兩線自癒的觸發條件。"""
    return any(k.startswith("7") for k in warrants)


def _day_file(date_iso: str) -> Path:
    return _history_dir() / f"{date_iso}.json"


def _fake_days() -> dict[str, dict]:
    """FAKE 分支:單檔多日 fixture(distilled 層;偏離 upstream-shape 慣例的理由
    見 design §7 — backfill/archive 在 FAKE 無意義,wn1430 解析由 pytest 覆蓋)。"""
    payload = read_json(_fixtures_dir() / "warrants" / "iv_history.json")
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return {}
    return payload.get("days") or {}


def _list_day_dates(limit: int = WINDOW_FILES) -> list[str]:
    if os.getenv("FAKE_FINMIND") == "1":
        return sorted(_fake_days())[-limit:]
    d = _history_dir()
    if not d.exists():
        return []
    return sorted(p.stem for p in d.glob("*.json"))[-limit:]


async def _load_day_archives(dates: list[str] | None = None) -> list[tuple[str, dict]]:
    """[(date, payload)] 升冪;版本不符視同缺檔(R18)。IO 段逐檔 yield(R25)。"""
    if dates is None:
        dates = _list_day_dates()
    out: list[tuple[str, dict]] = []
    if os.getenv("FAKE_FINMIND") == "1":
        fake = _fake_days()
        return [(dt, fake[dt]) for dt in dates if dt in fake]
    for dt in dates:
        payload = read_json(_day_file(dt))
        if isinstance(payload, dict) and payload.get("_cache_version") == _CACHE_VERSION:
            out.append((dt, payload))
        await asyncio.sleep(0)
    return out


async def load_recent_archives(limit: int) -> list[tuple[str, dict]]:
    """公開 accessor:最近 limit 個日檔 [(date, payload)] 升冪(供跨模組重用;
    跨模組不吃私有函式 — twse-tpex-conventions)。"""
    return await _load_day_archives(_list_day_dates(limit))


def _prune_history() -> None:
    files = sorted(_history_dir().glob("*.json"))
    for p in files[:-PRUNE_KEEP]:
        p.unlink(missing_ok=True)


# ---------------------------------------------------------------- IV 反解


def _iv_pair(
    bid: float | None,
    ask: float | None,
    s: float | None,
    strike: float | None,
    ratio: float | None,
    kind: str,
    is_reset: bool,
    ltd_iso: str,
    date_iso: str,
) -> tuple[float | None, float | None]:
    """bid/ask 各反解一次;is_reset / 條款缺 → 雙 None;倒掛 pair 層級雙 None(R8)。"""
    if is_reset or s is None or s <= 0 or strike is None or ratio is None or ratio <= 0:
        return None, None
    if bid is not None and ask is not None and bid > ask:
        return None, None
    t_years = (date_type.fromisoformat(ltd_iso) - date_type.fromisoformat(date_iso)).days / 365.0
    ivb = (
        implied_vol(bid / ratio, s, strike, t_years, RISK_FREE_RATE, kind)  # type: ignore[arg-type]
        if bid is not None and bid > 0
        else None
    )
    iva = (
        implied_vol(ask / ratio, s, strike, t_years, RISK_FREE_RATE, kind)  # type: ignore[arg-type]
        if ask is not None and ask > 0
        else None
    )
    return ivb, iva


# ---------------------------------------------------------------- SC-1 daily archive


async def archive_from_snapshot(snap: dict) -> bool:
    """當日 distilled archive;TPEx 落後日不寫入(R3)。

    存在即 False(immutable)的唯一例外:檔無 TPEx 且本次 tpex_date == as_of
    → 只補 TPEx 列(TWSE 值保留不重算)。R3 窗口(TWSE 已發布、TPEx 未發布)
    寫出的 TWSE-only 檔由隔日 keeper 首 build 自癒(2026-07-17 /bug)。
    """
    as_of = snap.get("as_of_date")
    if not as_of:
        return False
    path = _day_file(as_of)
    tpex_current = snap.get("tpex_date") == as_of
    existing: dict | None = None
    if path.exists():
        payload = read_json(path)
        if (
            not isinstance(payload, dict)
            or payload.get("_cache_version") != _CACHE_VERSION
            or not tpex_current
            or _has_tpex(payload.get("warrants") or {})
        ):
            return False
        existing = payload
    warrants_out: dict[str, dict] = {}
    n = 0
    for rows in snap["by_underlying"].values():
        for w in rows:
            if w["market"] == "tpex" and not tpex_current:
                continue
            if existing is not None and w["market"] != "tpex":
                continue  # merge 模式:既有 TWSE 資料保留,只補 TPEx
            ivb, iva = _iv_pair(
                w["eod_bid"], w["eod_ask"], w["underlying_eod_close"],
                w["strike"], w["exercise_ratio"], w["kind"], w["is_reset"],
                w["last_trading_date"], as_of,
            )
            warrants_out[w["warrant_id"]] = {
                "b": w["eod_bid"], "a": w["eod_ask"], "c": w["eod_close"],
                "s": w["underlying_eod_close"], "ivb": ivb, "iva": iva,
            }
            n += 1
            if n % IV_YIELD_EVERY == 0:
                await asyncio.sleep(0)
    if existing is not None:
        if not warrants_out:
            return False  # snapshot 也無 TPEx 列 → 無事可補,不重寫不觸發 rebuild
        existing["warrants"].update(warrants_out)
        atomic_write_json(path, existing)
    else:
        atomic_write_json(
            path,
            {"_cache_version": _CACHE_VERSION, "date": as_of, "terms_approx": False,
             "warrants": warrants_out},
        )
    _prune_history()
    return True


def ensure_post_build_task(snap: dict) -> None:
    """= design 的 run_post_build spawn 入口(warrants._build_and_store 呼叫)。

    獨立背景 task:不掛回應路徑、不被 _run_once subscriber-cancel 連坐(R2);
    FAKE 不 spawn(R17);archive 已存在(False)不重跑 rebuild(R21)。
    """
    global _post_build_task
    if os.getenv("FAKE_FINMIND") == "1" or not snap.get("as_of_date"):
        return
    if _post_build_task is not None and not _post_build_task.done():
        return
    _post_build_task = asyncio.ensure_future(_run_post_build(snap))


async def _run_post_build(snap: dict) -> None:
    try:
        wrote = await archive_from_snapshot(snap)
        if wrote:
            await rebuild_drift_summary()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("warrant iv post-build task failed")


# ---------------------------------------------------------------- drift summary


async def rebuild_drift_summary() -> dict:
    """三觸發點(post-build / backfill 完成 / lazy)統一經同一 key 串行(R20)。"""
    return await _run_once("drift_rebuild", _rebuild_impl)


async def _rebuild_impl() -> dict:
    global _drift_mem, _rebuild_generation
    started = time.monotonic()
    loaded: list[tuple[str, dict]] = []
    for _attempt in range(2):  # R22:檔集合自檢,不一致再跑一輪(max 1 次)
        dates = _list_day_dates()
        loaded = await _load_day_archives(dates)
        if _list_day_dates() == dates:
            break
    wids: set[str] = set()
    for _, payload in loaded:
        wids.update(payload["warrants"].keys())
    drift: dict[str, dict] = {}
    n = 0
    for wid in wids:
        entries = [(p["warrants"].get(wid) or {}) for _, p in loaded]
        drift[wid] = flatten_drift(
            detect_drift([e.get("ivb") for e in entries], [e.get("iva") for e in entries])
        )
        n += 1
        if n % DRIFT_YIELD_EVERY == 0:
            await asyncio.sleep(0)
    payload_out = {
        "_cache_version": _CACHE_VERSION,
        "built_from": [d for d, _ in loaded],
        "drift": drift,
    }
    if os.getenv("FAKE_FINMIND") != "1":  # R17:FAKE 只寫 mem 不落檔
        atomic_write_json(chip_cache_dir() / DRIFT_FILE, payload_out)
    _drift_mem = payload_out
    _rebuild_generation += 1  # R12:先進 generation 再清 LRU
    _series_lru.clear()
    logger.info(
        "drift summary rebuilt: warrants=%d days=%d in %.1fs",
        len(drift), len(loaded), time.monotonic() - started,
    )
    return drift


async def get_drift_map() -> dict[str, dict]:
    """lazy accessor(R1/R14):mem → 檔 → FAKE 同步現算 / 真實回空 + 背景 rebuild。"""
    global _drift_mem, _rebuild_bg_task
    if _drift_mem is not None:
        return _drift_mem["drift"]
    if os.getenv("FAKE_FINMIND") == "1":
        return await rebuild_drift_summary()
    payload = read_json(chip_cache_dir() / DRIFT_FILE)
    if isinstance(payload, dict) and payload.get("_cache_version") == _CACHE_VERSION:
        _drift_mem = payload
        return payload["drift"]
    if not _list_day_dates():
        # 無 archive 環境:mem built marker,避免每 request 重掃目錄
        _drift_mem = {"_cache_version": _CACHE_VERSION, "built_from": [], "drift": {}}
        return {}
    if _rebuild_bg_task is None or _rebuild_bg_task.done():
        _rebuild_bg_task = asyncio.ensure_future(_rebuild_bg())
    return {}


async def _rebuild_bg() -> None:
    try:
        await rebuild_drift_summary()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("drift rebuild background task failed")


# ---------------------------------------------------------------- SC-5 序列組裝


async def _get_underlying_series(uid: str, wids: list[str], refresh: bool) -> dict:
    if refresh:
        _series_lru.pop(uid, None)
    latest = (_list_day_dates() or [None])[-1]
    entry = _series_lru.get(uid)
    if entry is not None and entry["latest"] == latest and entry["gen"] == _rebuild_generation:
        return entry

    async def build() -> dict:
        gen = _rebuild_generation
        loaded = await _load_day_archives()
        dates = [d for d, _ in loaded]
        by_wid: dict[str, list] = {}
        for wid in wids:
            entries = [(p["warrants"].get(wid) or {}) for _, p in loaded]
            by_wid[wid] = [(e.get("ivb"), e.get("iva")) for e in entries]
        # 標的收盤:每日取同標的任一權證的非 null s。wids 來自現行快照 —
        # 早期日檔若現行權證全未上市則留 None(known gap,change-spec R7)
        s_list: list[float | None] = [
            next(
                (s for wid in wids if (s := (p["warrants"].get(wid) or {}).get("s")) is not None),
                None,
            )
            for _, p in loaded
        ]
        built = {
            "latest": dates[-1] if dates else None,
            "gen": gen,
            "dates": dates,
            "by_wid": by_wid,
            "s_list": s_list,
            "approx_dates": [d for d, p in loaded if p.get("terms_approx")],
        }
        if gen == _rebuild_generation:  # R12:組裝期間 rebuild 完成 → 丟棄不入 cache
            _series_lru[uid] = built
            while len(_series_lru) > _SERIES_LRU_CAP:
                _series_lru.pop(next(iter(_series_lru)))
        return built

    return await _run_once(f"series:{uid}", build)


async def get_iv_history(warrant_id: str, refresh: bool = False) -> dict | None:
    """單權證 IV 時序 + drift;warrant 不在快照 → None(route 判 404)。"""
    snap = await warrants_mod.get_snapshot(False)
    uid = warrants_mod.find_warrant_underlying(snap, warrant_id)
    if uid is None:
        return None
    wids = [w["warrant_id"] for w in snap["by_underlying"].get(uid, [])]
    entry = await _get_underlying_series(uid, wids, refresh)
    pairs = entry["by_wid"].get(warrant_id) or [(None, None)] * len(entry["dates"])
    series = [
        {"date": d, "iv_bid": b, "iv_ask": a, "underlying_close": s}
        for d, (b, a), s in zip(entry["dates"], pairs, entry["s_list"])
    ]
    drift_map = await get_drift_map()
    drift = drift_map.get(warrant_id) or {
        "label": "insufficient", "slope_bid": None, "slope_ask": None, "n_valid": 0,
    }
    return {
        "warrant_id": warrant_id,
        "terms_approx_dates": entry["approx_dates"],
        "series": series,
        "drift": drift,
    }


# ---------------------------------------------------------------- TPEx wn1430(backfill)


def parse_wn1430(body: dict, date_iso: str) -> list[dict]:
    """舊站 php payload → [{warrant_id, close, bid, ask}];stat 小寫 "ok"、
    echo date 校驗、欄名 stripped 對照(2023「千股」變體同欄序)。"""
    if not isinstance(body, dict) or str(body.get("stat", "")).strip().lower() != "ok":
        return []
    if str(body.get("date", "")).strip() != date_iso.replace("-", ""):
        return []
    for tb in body.get("tables") or []:
        fields = [str(f).strip() for f in tb.get("fields") or []]
        # CR-A1:四欄名齊備才取表 — 缺任一欄的變體表 index 會 ValueError,
        # 非 httpx 例外穿透 backfill 逐日 catch 會炸整段(降級為該日無 TPEx 列)
        required = ("代號", "收盤", "最後買價", "最後賣價")
        if any(name not in fields for name in required):
            continue
        idx_id = fields.index("代號")
        idx_close = fields.index("收盤")
        idx_bid = fields.index("最後買價")
        idx_ask = fields.index("最後賣價")
        out: list[dict] = []
        for row in tb.get("data") or []:
            try:
                out.append(
                    {
                        "warrant_id": str(row[idx_id]).strip(),
                        "close": _parse_price(row[idx_close]),
                        "bid": _parse_price(row[idx_bid]),
                        "ask": _parse_price(row[idx_ask]),
                    }
                )
            except (IndexError, TypeError):
                logger.warning("skip bad wn1430 row: %r", row)
        return out
    return []


async def _fetch_wn1430_rows(date_iso: str) -> list[dict]:
    y, m, d = date_iso.split("-")
    # se=WW = 權證表;EW 是「上櫃股票+ETF(不含權證、牛熊證)」— 用 EW 時
    # TPEx 權證線靜默全滅(2026-07-17 /bug root cause)
    resp = await _get_client().get(
        WN1430_URL, params={"l": "zh-tw", "d": f"{int(y) - 1911}/{m}/{d}", "se": "WW"}
    )
    resp.raise_for_status()
    return parse_wn1430(resp.json(), date_iso)


async def _fetch_underlying_close_range(
    stock_ids: set[str], start: str, end: str
) -> dict[str, dict[str, float]]:
    """R16 缺口補抓:{stock_id: {date: close}};per-underlying range 一次。"""
    out: dict[str, dict[str, float]] = {}
    for sid in sorted(stock_ids):
        try:
            rows = await get_finmind().stock_price_range(sid, start, end)
        except httpx.HTTPError as exc:
            logger.warning("underlying close range fetch failed for %s: %s", sid, exc)
            continue
        for r in rows:
            d, c = r.get("date"), r.get("close")
            if d and isinstance(c, (int, float)):
                out.setdefault(sid, {})[d] = float(c)
    return out


# ---------------------------------------------------------------- SC-2 backfill


def _backfill_days() -> int:
    return int(os.getenv("WARRANT_IV_BACKFILL_DAYS", "60") or "60")


def _load_nontrading() -> dict[str, str]:
    """非交易日 marker {date_iso: checked_iso};版本不符視同缺檔(R18 同慣例)。"""
    payload = read_json(chip_cache_dir() / NONTRADING_FILE)
    if isinstance(payload, dict) and payload.get("_cache_version") == _CACHE_VERSION:
        return dict(payload.get("days") or {})
    return {}


def _save_nontrading(days: dict[str, str]) -> None:
    atomic_write_json(
        chip_cache_dir() / NONTRADING_FILE,
        {"_cache_version": _CACHE_VERSION, "days": days},
    )


def _nontrading_fresh(checked_iso: str, today: date_type) -> bool:
    try:
        checked = date_type.fromisoformat(checked_iso)
    except ValueError:
        return False  # 壞值 → 視同過期,走重驗路徑自癒
    # 下界 0:時鐘回撥留下未來 checked → 負 days 恆 < TTL 會永久 fresh,自癒失效
    return 0 <= (today - checked).days < _NONTRADING_TTL_DAYS


def ensure_backfill_task() -> None:
    """lifespan 入口;FAKE / env 0 → no-op。全窗零交易日不自動重試(Known Risk R-5)。"""
    global _backfill_task
    if os.getenv("FAKE_FINMIND") == "1":
        return
    if _backfill_days() <= 0:
        return
    if _backfill_task is not None and not _backfill_task.done():
        return
    _backfill_task = asyncio.ensure_future(_backfill_guarded())


async def _backfill_guarded() -> None:
    try:
        await _backfill()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("warrant iv backfill task failed")


async def _backfill() -> None:
    """自 today-1 往回補交易日檔(R23);不依賴 _load_snapshot 入口(R19)。"""
    days_target = _backfill_days()
    if days_target <= 0:
        return
    terms_by_id: dict[str, dict] = {}
    for raw in await warrants_mod.fetch_t187ap37():
        t = warrants_mod.normalize_twse_terms_row(raw)
        if t is not None:
            terms_by_id[t["warrant_id"]] = t
    issue_by_id: dict[str, dict] = {}
    for raw in await warrants_mod.fetch_tpex_issue():
        t = warrants_mod.normalize_tpex_issue_row(raw)
        if t is not None:
            issue_by_id[t["warrant_id"]] = t

    today = clock.today()
    max_scan = days_target * 2 + 11
    s_range: dict[str, dict[str, float]] | None = None
    nontrading = _load_nontrading()
    found = 0
    wrote_any = False
    for i in range(1, max_scan + 1):
        if found >= days_target:
            break
        d = today - timedelta(days=i)
        if d.weekday() >= 5:
            # perf/warrant-api-load S1:週末必休市(補班日不開市)— 不發請求;
            # 原本每個週末日 4 個 MI_INDEX + retry sleep,啟動即與冷 build 搶 TWSE
            continue
        date_iso = d.isoformat()
        if _day_file(date_iso).exists():
            payload = read_json(_day_file(date_iso))
            valid = isinstance(payload, dict) and payload.get("_cache_version") == _CACHE_VERSION
            if not valid or _has_tpex(payload.get("warrants") or {}):
                found += 1
                continue
            # 無 TPEx 殘檔(se=EW 時代 / daily R3 窗口)→ 視同缺檔全量重建自癒;
            # 版本不符檔維持舊行為(跳過),不在本 fix 擴 scope
        checked = nontrading.get(date_iso)
        if checked is not None and _nontrading_fresh(checked, today):
            continue  # marker TTL 內:已確認非交易日,不重掃(過期則重驗)
        try:
            call_rows = await warrants_mod.fetch_mi_index(date_iso, "0999")
            put_rows = await warrants_mod.fetch_mi_index(date_iso, "0999P")
            if not call_rows or not put_rows:
                # 交易日兩型別必都有行情:任一空 = transient「stat=OK 空表」嫌疑
                # (shape 與真非交易日不可區分)→ retry 一次(R15),只重抓空側
                # (重抓已成功側會丟棄首輪資料,retry 輪雙 transient 誤寫 marker)
                await asyncio.sleep(_NONTRADING_RETRY_SLEEP)
                if not call_rows:
                    call_rows = await warrants_mod.fetch_mi_index(date_iso, "0999")
                if not put_rows:
                    put_rows = await warrants_mod.fetch_mi_index(date_iso, "0999P")
            if not call_rows and not put_rows:
                # 雙空兩次 = 非交易日 → marker(TTL 過期重驗,誤判自癒)
                nontrading[date_iso] = today.isoformat()
                _save_nontrading(nontrading)
                logger.warning(
                    "warrant iv backfill: %s empty twice -> non-trading marker "
                    "(holiday or outage; recheck in %dd)", date_iso, _NONTRADING_TTL_DAYS,
                )
                continue
            if not call_rows or not put_rows:
                # 單邊空兩次 = transient partial:寫了就 immutable 殘檔永不自癒
                # (06-08 / 07-02 實錘)→ 不寫,留待下次啟動補
                logger.warning(
                    "warrant iv backfill: %s partial empty (call=%d put=%d), skip write",
                    date_iso, len(call_rows), len(put_rows),
                )
                continue

            s_map: dict[str, float] = {}
            twse_norm: list[dict] = []
            for row in call_rows + put_rows:
                m = warrants_mod.normalize_twse_market_row(row)
                if m is None:
                    continue
                twse_norm.append(m)
                if m["underlying_close"] is not None:
                    s_map[m["underlying_id"]] = m["underlying_close"]

            tpex_rows = [
                r for r in await _fetch_wn1430_rows(date_iso) if r["warrant_id"] in issue_by_id
            ]
            gap_ids = {
                uid
                for r in tpex_rows
                if (uid := issue_by_id[r["warrant_id"]].get("underlying_id")) is not None
                and uid not in s_map
            }
            if gap_ids and s_range is None:
                # R16:per-underlying 整段 range 一次;後續日新 gap id(罕見)不重抓
                start_iso = (today - timedelta(days=max_scan)).isoformat()
                s_range = await _fetch_underlying_close_range(gap_ids, start_iso, today.isoformat())

            warrants_out: dict[str, dict] = {}
            n = 0
            for m in twse_norm:
                terms = terms_by_id.get(m["warrant_id"])
                if terms is None:
                    continue
                ivb, iva = _iv_pair(
                    m["bid"], m["ask"], m["underlying_close"],
                    terms["strike"], terms["exercise_ratio"], terms["kind"],
                    terms["is_reset"], terms["last_trading_date"], date_iso,
                )
                warrants_out[m["warrant_id"]] = {
                    "b": m["bid"], "a": m["ask"], "c": m["close"],
                    "s": m["underlying_close"], "ivb": ivb, "iva": iva,
                }
                n += 1
                if n % IV_YIELD_EVERY == 0:
                    await asyncio.sleep(0)
            for r in tpex_rows:
                terms = issue_by_id[r["warrant_id"]]
                uid = terms.get("underlying_id")
                s = s_map.get(uid) if uid else None
                if s is None and uid and s_range is not None:
                    s = s_range.get(uid, {}).get(date_iso)
                ivb, iva = _iv_pair(
                    r["bid"], r["ask"], s,
                    terms["strike"], terms["exercise_ratio"], terms["kind"],
                    terms["is_reset"], terms["last_trading_date"], date_iso,
                )
                warrants_out[r["warrant_id"]] = {
                    "b": r["bid"], "a": r["ask"], "c": r["close"], "s": s,
                    "ivb": ivb, "iva": iva,
                }
                n += 1
                if n % IV_YIELD_EVERY == 0:
                    await asyncio.sleep(0)

            atomic_write_json(
                _day_file(date_iso),
                {"_cache_version": _CACHE_VERSION, "date": date_iso, "terms_approx": True,
                 "warrants": warrants_out},
            )
            if nontrading.pop(date_iso, None) is not None:
                _save_nontrading(nontrading)  # 過期重驗有料 = 先前誤判 → 自癒
            found += 1
            wrote_any = True
        except httpx.HTTPError as exc:
            # 單日壞不炸整段,warning 跳日續走(design §4)
            logger.warning("warrant iv backfill: %s failed: %s", date_iso, exc)
            continue
    if found == 0:
        logger.error("warrant iv backfill found no trading days")
    if wrote_any:
        await rebuild_drift_summary()


# ---------------------------------------------------------------- lifecycle


async def aclose() -> None:
    global _client
    for task in (_post_build_task, _backfill_task, _rebuild_bg_task):
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    try:
        if _client is not None:
            await _client.aclose()
    finally:
        _client = None
