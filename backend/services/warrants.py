"""權證 EOD 快照 service — TWSE MI_INDEX/t187ap37_L + TPEx OpenAPI 三端點。

資料源皆非 FinMind(不占配額);每日一次 lazy build,固定檔名快照 +
記憶體層 + build backoff(design .claude/feat/warrant-selector/design.md v3 §1.2)。
樣板 = services/daytrade_fee.py(TLS/_run_once/cache 兩道保護同構)。
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
from fastapi import HTTPException

from services import clock
from services.warrant_pricing import RISK_FREE_RATE, implied_vol
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
SNAPSHOT_FILE = "warrants_snapshot_latest.json"
SNAPSHOT_LOOKBACK_DAYS = 7
# S5 keeper tick:fresh 時 _load_snapshot 為純 mem 檢查,tick 成本 ~0;
# 跨午夜 stale 後最遲一個 tick 內背景重 build(每日首請求不付冷 build)
SNAPSHOT_FRESHNESS_INTERVAL_SEC = 300.0
BUILD_RETRY_COOLDOWN_SEC = 60.0  # R2-1:build 失敗/空回後的重試 backoff
IV_YIELD_EVERY = 500  # IV 反解純 CPU,每 N 檔讓出 event loop(R7)
_UA = "Mozilla/5.0 (neigui-backend)"
MI_INDEX_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
T187AP37_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap37_L"
TPEX_QUTS_URL = "https://www.tpex.org.tw/openapi/v1/tpex_warrant_daily_quts"
TPEX_CLOSE_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
TPEX_ISSUE_URL = "https://www.tpex.org.tw/openapi/v1/tpex_warrant_issue"

_client: httpx.AsyncClient | None = None
_inflight: dict[str, dict[str, Any]] = {}
_snapshot_mem: dict | None = None
_last_build_attempt: float | None = None
_prewarm_task: asyncio.Task | None = None
_monotonic = time.monotonic  # 測試以 monkeypatch 換假鐘


def _ssl_context() -> ssl.SSLContext:
    """TPEx 憑證缺 SKI,py3.13 VERIFY_X509_STRICT 拒驗 — 關 strict flag,
    憑證鏈 + hostname 驗證保留(twse-tpex-conventions,非 verify=False)。"""
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=60.0,
            headers={"User-Agent": _UA},
            verify=_ssl_context(),
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        finally:
            _client = None


# ---------------------------------------------------------------- normalize


def _roc_compact_to_iso(s: str) -> str:
    s = s.strip()
    return f"{int(s[:-4]) + 1911}-{s[-4:-2]}-{s[-2:]}"


def _ad_compact_to_iso(s: str) -> str:
    s = s.strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def _row_get(row: dict, key: str) -> Any:
    """stripped-key lookup:TPEx 官方欄名 leading space 有無不定(S-2)。"""
    for k, v in row.items():
        if k.strip() == key:
            return v
    return None


def _parse_price(v: Any) -> float | None:
    """TWSE 空字串 / TPEx `---` / MIS `-` / 空白欄 → None;千分位容忍。"""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s in ("---", "-"):
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _extract_mi_table(body: dict) -> list:
    """MI_INDEX tables[] 取 fields 數 == 20 那張(S-1:勿硬編 index;
    非交易日 stat OK 但全表空 → [])。"""
    if body.get("stat") != "OK":
        return []
    for tb in body.get("tables") or []:
        if len(tb.get("fields") or []) == 20:
            return tb.get("data") or []
    return []


def normalize_twse_market_row(row: list) -> dict | None:
    try:
        return {
            "warrant_id": str(row[1]).strip(),
            "name": str(row[2]).strip(),
            "close": _parse_price(row[9]),
            "bid": _parse_price(row[12]),
            "ask": _parse_price(row[14]),
            "underlying_id": str(row[17]).strip(),
            "underlying_name": str(row[18]).strip(),
            "underlying_close": _parse_price(row[19]),
        }
    except (IndexError, TypeError):
        logger.warning("skip bad twse warrant market row: %r", row)
        return None


def normalize_twse_terms_row(row: dict) -> dict | None:
    try:
        per_thousand = float(
            str(row["最新標的履約配發數量(每仟單位權證)"]).replace(",", "")
        )
        return {
            "warrant_id": str(row["權證代號"]).strip(),
            "kind": "call" if "購" in str(row["權證類型"]) else "put",
            "strike": float(str(row["最新履約價格(元)/履約指數"]).replace(",", "")),
            # S-2 鐵證:官方備註「調整後行使比例0.0070」對上欄值 7.00
            "exercise_ratio": per_thousand / 1000.0,
            "last_trading_date": _roc_compact_to_iso(row["最後交易日"]),
            "maturity_date": _roc_compact_to_iso(row["履約截止日"]),
            "is_reset": "重設型" in str(row["類別"]),
        }
    except (KeyError, ValueError, TypeError):
        logger.warning("skip bad t187ap37 row: %r", row.get("權證代號", row))
        return None


def normalize_tpex_quts_row(row: dict) -> dict | None:
    try:
        return {
            "warrant_id": str(row["Code"]).strip(),
            "name": str(row["Name"]).strip(),
            "date": _roc_compact_to_iso(row["Date"]),
            "close": _parse_price(row.get("Close")),
            "underlying_id": str(row["UnderlyingStockCode"]).strip(),
            "underlying_name": str(row["UnderlyingStock"]).strip(),
            "underlying_close": _parse_price(row.get("UnderlyingStockClosePrice")),
        }
    except (KeyError, ValueError, TypeError):
        logger.warning("skip bad tpex quts row: %r", row.get("Code", row))
        return None


def normalize_tpex_close_row(row: dict) -> dict | None:
    try:
        return {
            "stock_id": str(row["SecuritiesCompanyCode"]).strip(),
            "bid": _parse_price(row.get("LatestBidPrice")),
            # 官方欄名 typo 原樣對 key(twse-tpex-conventions)
            "ask": _parse_price(row.get("LatesAskPrice")),
        }
    except (KeyError, TypeError):
        logger.warning("skip bad tpex close row: %r", row)
        return None


def normalize_tpex_issue_row(row: dict) -> dict | None:
    try:
        ratio = _parse_price(_row_get(row, "Latest ExerciseRatio"))
        expiry = _ad_compact_to_iso(str(_row_get(row, "ExpiryDate")))  # 西元(與 Date 民國混用)
        return {
            "warrant_id": str(_row_get(row, "Code")).strip(),
            "kind": "call" if "購" in str(_row_get(row, "Type")) else "put",
            "strike": _parse_price(_row_get(row, "LatestExercisePrice")),
            "exercise_ratio": ratio,
            # 標的代號:warrant_iv_history backfill 補標的價缺口用(additive)
            "underlying_id": (str(_row_get(row, "UnderlyingStockCode") or "").strip() or None),
            # TPEx issue 無最後交易日欄 — 以 ExpiryDate 近似(差約 2 交易日)
            "last_trading_date": expiry,
            "maturity_date": expiry,
            "is_reset": str(_row_get(row, "Reset") or "").strip() == "Y",
        }
    except (ValueError, TypeError):
        logger.warning("skip bad tpex issue row: %r", row.get("Code", row))
        return None


# ---------------------------------------------------------------- fetch(FAKE 分支)


def _fixtures_dir() -> Path:
    raw = os.getenv("FAKE_FINMIND_FIXTURES_DIR", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[1] / "tests_e2e" / "fixtures"


def _read_fixture(name: str) -> Any:
    payload = read_json(_fixtures_dir() / "warrants" / name)
    return payload  # 檔缺 = None,caller 視同空(e2e-conventions)


async def fetch_mi_index(date_iso: str, type_code: str) -> list:
    """回 MI_INDEX 20 欄表的 raw rows;FAKE 模式無視 date(fixture 對齊 FAKE_TODAY)。

    公開:warrant_iv_history backfill 以歷史 date 回溯共用(帶 date 參數可回溯 ≥3 年)。
    """
    if os.getenv("FAKE_FINMIND") == "1":
        payload = _read_fixture(f"mi_index_{type_code}.json")
        return _extract_mi_table(payload) if isinstance(payload, dict) else []
    resp = await _get_client().get(
        MI_INDEX_URL,
        params={"date": date_iso.replace("-", ""), "type": type_code, "response": "json"},
    )
    resp.raise_for_status()
    return _extract_mi_table(resp.json())


async def fetch_t187ap37() -> list:
    if os.getenv("FAKE_FINMIND") == "1":
        return _read_fixture("t187ap37_L.json") or []
    resp = await _get_client().get(T187AP37_URL)
    resp.raise_for_status()
    return resp.json()


async def _fetch_tpex_quts() -> list:
    if os.getenv("FAKE_FINMIND") == "1":
        return _read_fixture("tpex_warrant_daily_quts.json") or []
    resp = await _get_client().get(TPEX_QUTS_URL)
    resp.raise_for_status()
    return resp.json()


async def _fetch_tpex_close() -> list:
    if os.getenv("FAKE_FINMIND") == "1":
        return _read_fixture("tpex_mainboard_close.json") or []
    resp = await _get_client().get(TPEX_CLOSE_URL)
    resp.raise_for_status()
    return resp.json()


async def fetch_tpex_issue() -> list:
    if os.getenv("FAKE_FINMIND") == "1":
        return _read_fixture("tpex_warrant_issue.json") or []
    resp = await _get_client().get(TPEX_ISSUE_URL)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------- build


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup(subscriber refcount + shield)— daytrade_fee 同構。"""
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


def _warrant_price_basis(close: float | None, bid: float | None, ask: float | None) -> float | None:
    """定價基準 P:有成交用收盤,零成交用 mid,皆無 → None(edge case 2)。

    bid > ask(倒掛,stale 快照可見)→ None:倒掛 mid 餵進 IV 反解會產出
    無旗標的錯誤 iv_prev(code-review CR-1)。
    """
    if close is not None:
        return close
    if bid is not None and ask is not None and bid <= ask:
        return (bid + ask) / 2.0
    return None


async def _build_snapshot() -> dict:
    today = clock.today()
    as_of: str | None = None
    call_rows: list = []
    put_rows: list = []
    for i in range(SNAPSHOT_LOOKBACK_DAYS):
        d = (today - timedelta(days=i)).isoformat()
        # perf/warrant-api-load S2:同日兩型並發(E1b 實測 TWSE 無礙);
        # 跨候選日回退仍序列,語意不變
        call_rows, put_rows = await asyncio.gather(
            fetch_mi_index(d, "0999"), fetch_mi_index(d, "0999P")
        )
        if call_rows or put_rows:
            as_of = d
            break
    if as_of is None:
        return {
            "_cache_version": _CACHE_VERSION,
            "as_of_date": None,
            "fetched_on": today.isoformat(),
            "tpex_date": None,
            "by_underlying": {},
        }

    # S2:四路條款/行情來源並發(TPEx OpenAPI 為靜態 dump,3 路溫和);
    # 任一 fetch 例外 → 整 build 例外,與原序列語意等價
    terms_raw, quts_raw, tclose_raw, issue_raw = await asyncio.gather(
        fetch_t187ap37(), _fetch_tpex_quts(), _fetch_tpex_close(), fetch_tpex_issue()
    )
    terms_by_id: dict[str, dict] = {}
    for raw in terms_raw:
        t = normalize_twse_terms_row(raw)
        if t is not None:
            terms_by_id[t["warrant_id"]] = t
    quts_rows = [q for r in quts_raw if (q := normalize_tpex_quts_row(r))]
    tclose_by_id: dict[str, dict] = {}
    for raw in tclose_raw:
        c = normalize_tpex_close_row(raw)
        if c is not None:
            tclose_by_id[c["stock_id"]] = c
    issue_by_id: dict[str, dict] = {}
    for raw in issue_raw:
        t = normalize_tpex_issue_row(raw)
        if t is not None:
            issue_by_id[t["warrant_id"]] = t
    tpex_date = max((q["date"] for q in quts_rows), default=None)

    started = time.monotonic()
    by_underlying: dict[str, list] = {}
    n_iv = 0

    async def add_warrant(
        market: str, mkt: dict, terms: dict, bid: float | None, ask: float | None,
    ) -> None:
        nonlocal n_iv
        # universe 防禦:已到期剔除(S-4;牛熊由 MI_INDEX 型別交集自然排除)
        if terms["last_trading_date"] < as_of:
            return
        w = {
            "warrant_id": mkt["warrant_id"],
            "name": mkt["name"],
            "kind": terms["kind"],
            "market": market,
            "underlying_id": mkt["underlying_id"],
            "underlying_name": mkt["underlying_name"],
            "strike": terms["strike"],
            "exercise_ratio": terms["exercise_ratio"],
            "last_trading_date": terms["last_trading_date"],
            "maturity_date": terms["maturity_date"],
            "is_reset": terms["is_reset"],
            "eod_close": mkt["close"],
            "eod_bid": bid,
            "eod_ask": ask,
            "underlying_eod_close": mkt["underlying_close"],
            "iv_prev": None,
        }
        p = _warrant_price_basis(mkt["close"], bid, ask)
        ratio = terms["exercise_ratio"]
        s = mkt["underlying_close"]
        if (
            not terms["is_reset"]
            and p is not None
            and s is not None
            and ratio is not None
            and ratio > 0
            and terms["strike"] is not None
        ):
            t_years = (
                date_type.fromisoformat(terms["last_trading_date"])
                - date_type.fromisoformat(as_of)
            ).days / 365.0
            w["iv_prev"] = implied_vol(
                p / ratio, s, terms["strike"], t_years, RISK_FREE_RATE, terms["kind"]
            )
        n_iv += 1
        if n_iv % IV_YIELD_EVERY == 0:
            await asyncio.sleep(0)  # R7:讓出 event loop
        by_underlying.setdefault(w["underlying_id"], []).append(w)

    for row in call_rows + put_rows:
        mkt = normalize_twse_market_row(row)
        if mkt is None:
            continue
        terms = terms_by_id.get(mkt["warrant_id"])
        if terms is None:
            logger.warning("twse warrant %s in market but not in terms; skip", mkt["warrant_id"])
            continue
        await add_warrant("twse", mkt, terms, mkt["bid"], mkt["ask"])

    for q in quts_rows:
        terms = issue_by_id.get(q["warrant_id"])
        if terms is None:
            logger.warning("tpex warrant %s in quts but not in issue; skip", q["warrant_id"])
            continue
        c = tclose_by_id.get(q["warrant_id"])
        await add_warrant(
            "tpex",
            {**q, "bid": c["bid"] if c else None, "ask": c["ask"] if c else None},
            terms,
            c["bid"] if c else None,
            c["ask"] if c else None,
        )

    logger.info(
        "warrants snapshot built: as_of=%s warrants=%d underlyings=%d in %.1fs",
        as_of, n_iv, len(by_underlying), time.monotonic() - started,
    )
    return {
        "_cache_version": _CACHE_VERSION,
        "as_of_date": as_of,
        "fetched_on": today.isoformat(),
        "tpex_date": tpex_date,
        "by_underlying": by_underlying,
    }


def _read_snapshot_file() -> dict | None:
    payload = read_json(chip_cache_dir() / SNAPSHOT_FILE)
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return None
    return payload


def _is_snapshot_fresh(snap: dict) -> bool:
    return snap.get("fetched_on") == clock.today().isoformat()


async def _build_and_store() -> dict:
    global _snapshot_mem, _last_build_attempt
    try:
        snap = await _build_snapshot()
        if not snap["by_underlying"]:
            # 兩道保護 (b):上游空不覆寫非空 cache(daytrade_fee 樣板)
            cached = _snapshot_mem or _read_snapshot_file()
            if cached is not None and cached.get("by_underlying"):
                return cached
            # 7 天回退全空(as_of None)且無 cache 才 404;as_of 有值但 universe
            # 空(全數被到期/條款過濾)是合法空快照,照常寫入
            if snap["as_of_date"] is None:
                raise HTTPException(status_code=404, detail={"error": "no_data"})
        atomic_write_json(chip_cache_dir() / SNAPSHOT_FILE, snap)
        _snapshot_mem = snap
        # 函式內 local import:warrant_iv_history 模組層 import 本模組(fetch 共用),
        # 反向只能延後綁定避免循環;spawn 的是獨立背景 task,不掛回應路徑(design R2)。
        from services import warrant_iv_history as ivh

        ivh.ensure_post_build_task(snap)
        return snap
    finally:
        _last_build_attempt = _monotonic()


async def _load_snapshot(refresh: bool) -> dict:
    global _snapshot_mem
    snap = _snapshot_mem
    if snap is None:
        snap = _read_snapshot_file()
        if snap is not None:
            _snapshot_mem = snap
    if not refresh and snap is not None and _is_snapshot_fresh(snap):
        return snap
    if (
        not refresh
        and _last_build_attempt is not None
        and _monotonic() - _last_build_attempt < BUILD_RETRY_COOLDOWN_SEC
    ):
        # R2-1 backoff:15s 輪詢在上游故障日不得放大成 rebuild 重試風暴
        if snap is not None:
            return snap
        raise HTTPException(status_code=404, detail={"error": "no_data"})
    return await _run_once("snapshot_build", _build_and_store)


async def get_snapshot(refresh: bool = False) -> dict:
    """公開快照入口(warrant_iv_history 的 iv-history 查 underlying 用)。"""
    return await _load_snapshot(refresh)


# ---------------------------------------------------------------- lifespan 預熱(S3)


def ensure_prewarm_task() -> None:
    """lifespan 入口:背景預熱當日快照,完成後才啟動 iv backfill(讓路)。

    perf/warrant-api-load S3:每日首請求原本付整段冷 build;預熱把它移到
    啟動背景,趕在預熱完成前的請求走 `_run_once` inflight join 只等殘餘時間。
    backfill 排在預熱之後 — E3 實證兩者並跑會互搶 TWSE(43.5s vs 4.6s)。
    FAKE 不預熱(fixture 快照 lazy 即時 build),但 backfill 入口照舊呼叫
    (其內部自帶 FAKE no-op)。
    """
    global _prewarm_task
    from services import warrant_iv_history as ivh  # local import,同 _build_and_store

    if os.getenv("FAKE_FINMIND") == "1":
        ivh.ensure_backfill_task()
        return
    if _prewarm_task is not None and not _prewarm_task.done():
        return
    _prewarm_task = asyncio.ensure_future(_prewarm_then_backfill())


async def _prewarm_then_backfill() -> None:
    from services import warrant_iv_history as ivh

    try:
        await _load_snapshot(refresh=False)
    except asyncio.CancelledError:
        raise
    except Exception:
        # 預熱失敗的處理 = 放棄預熱讓 lazy 路徑接手重 build(60s backoff 保護);
        # 啟動不得因上游故障阻塞。背景 task 邊界精度對齊 ivh._backfill_guarded
        logger.exception("warrant snapshot prewarm failed; lazy path will rebuild")
    ivh.ensure_backfill_task()
    # S5 freshness keeper:長駐跨午夜後快照 stale,由本 task 背景重 build;
    # 失敗的處理 = 下一 tick 重試(_load_snapshot 內 60s backoff 防風暴)
    while True:
        await asyncio.sleep(SNAPSHOT_FRESHNESS_INTERVAL_SEC)
        try:
            await _load_snapshot(refresh=False)
        except asyncio.CancelledError:
            raise
        except HTTPException:
            # 預期狀態(404 no_data:連續假日無資料 + 無 cache)— debug 級,
            # warning 會在假期每 tick 洗版
            logger.debug("warrant snapshot freshness tick: no data yet")
        except Exception:
            logger.exception("warrant snapshot freshness tick failed; retrying next tick")


async def shutdown_prewarm_task() -> None:
    """lifespan shutdown:--reload / SIGTERM 落在預熱窗口時收乾淨 pending task。"""
    global _prewarm_task
    task = _prewarm_task
    _prewarm_task = None
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def find_warrant_underlying(snap: dict, warrant_id: str) -> str | None:
    for uid, rows in snap["by_underlying"].items():
        for w in rows:
            if w["warrant_id"] == warrant_id:
                return uid
    return None


async def get_underlying_warrants(stock_id: str, refresh: bool = False) -> dict:
    """該標的全部權證(上市+上櫃 union;空 list = 無掛牌權證,SC-7)。

    每列讀取時 merge iv_drift label(shallow copy,不變異 _snapshot_mem 共享
    dict — design R10;merge 不烙進快照檔,backfill 完成即時生效)。
    """
    snap = await _load_snapshot(refresh)
    from services import warrant_iv_history as ivh  # local import,同 _build_and_store

    drift_map = await ivh.get_drift_map()
    return {
        "as_of_date": snap["as_of_date"],
        "warrants": [
            {
                **w,
                "iv_drift": (drift_map.get(w["warrant_id"]) or {}).get("label"),
            }
            for w in snap["by_underlying"].get(stock_id, [])
        ],
    }
