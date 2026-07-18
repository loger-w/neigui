"""權證買賣超分點聚合 — 標的層級 flow(design .claude/feat/warrant-broker-flow/design.md v3)。

資料流:條款快照(權證→標的)→ TaiwanStockPrice date-only 全市場 dump 篩有量
→ 依成交金額 cap 200(spike L-2 校準)→ 可得性 probe → fan-out 分點報表
→ 三層聚合(summary / per-branch top15 / per-warrant)→ per (stock, date) cache。

候選日自適應(spike L-1):從 today 起往前試,報表未上料以 probe 一發偵測,
不依賴「當晚幾點上料」的未知時點。
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import date as date_type, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

import httpx
from fastapi import HTTPException

if TYPE_CHECKING:
    from services.finmind import FinMindClient

from services import clock, warrants
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 2  # 2:external_net 口徑(mod/warrant-flow-external-net)取代恆零 net_value
FLOW_CAP = 200  # spike L-2:cap 200 最壞覆蓋 95.69%(2330);文案由 payload analyzed 插值
FLOW_LOOKBACK_DAYS = 10  # R8:春節級連假也要能回退到最近交易日
_PRICE_DAY_KEEP_KEYS = ("stock_id", "Trading_money")
_DUMP_RETAIN_DAYS = 7
_RESULT_RETAIN_DAYS = 45  # 30 → 45:history 20 交易日 ≈ 28-30 曆日貼邊(design v3 §2.1)
_NONTRADING_RETAIN_DAYS = 14  # marker 誤標自癒窗(transient 空 dump;design review R12)
# 與 Phase 0 spike 腳本同一口徑(memory reference_finmind_warrant_dataset 代號區間);
# 含字尾字母的 6 碼牛熊/展延證天然命中,71 等非權證 prefix 排除(R10)
_WARRANT_PREFIXES = ("03", "04", "05", "06", "07", "08", "09", "72", "73", "74")

_inflight: dict[str, dict[str, Any]] = {}

# 發行商造市總公司(HO)seat 精確名 alias(2026-07-17 2330 top30 probe:27/27 單一
# 命中、HO 量占比中位 49.2%;prompts-backlog B2)。seat 精確名單匹配是唯一鑑別 —
# 分點 id 也是 4 碼(980C)且 HO id 含字母(9B00),長度/isdigit 都無鑑別力。
# brand 不在表 → external_net null(新發行商安全降級,change-spec R-1)。
# 2026-07-18 R-1 補驗:中國信託 6160 / 兆豐 7000 實測相符;元富見下行 merger 註記。
_ISSUER_ALIASES: dict[str, tuple[str, ...]] = {
    "元大": ("元大",),
    "凱基": ("凱基",),
    "統一": ("統一",),
    "富邦": ("富邦",),
    "群益": ("群益", "群益金鼎"),
    "台新": ("台新證券", "台新"),
    "永豐": ("永豐金", "永豐"),
    "國泰": ("國泰綜合", "國泰"),
    "國票": ("國票綜合", "國票"),
    "中信": ("中國信託", "中信"),
    # 元富證券 2026-04-06 併入台新證券(存續)— 元富 brand 權證 HO 實測 9B00「台新證券」
    # (2026-07-18 probe 4 檔 × 2 日 6/6);保留「元富」兼容合併前歷史日期報表
    "元富": ("台新", "元富"),
    "兆豐": ("兆豐",),
}
_BRAND_RE = re.compile(r"^[^0-9A-Z]+")


def _issuer_brand(name: str, underlying_name: str) -> str | None:
    """權證名抽發行商 brand:去 underlying_name 前綴(全稱不中則縮短到 2 字容錯,
    兼容「台積凱基61購01」式縮寫命名)→ 取首個 [0-9A-Z] 前的字元;brand 必須在
    alias 白名單內,否則 None(防錯配)。2330 全 1087 檔實測全數抽取成功。"""
    if not name or not underlying_name:
        return None
    for plen in range(len(underlying_name), 1, -1):
        if name.startswith(underlying_name[:plen]):
            m = _BRAND_RE.match(name[plen:])
            brand = m.group(0) if m else None
            return brand if brand in _ISSUER_ALIASES else None
    return None


def _ho_seat_names(brand: str) -> set[str]:
    """HO seat 可接受精確名集合(alias 與 alias+「證券」變体)。"""
    return {v for a in _ISSUER_ALIASES[brand] for v in (a, a + "證券")}


def get_finmind() -> "FinMindClient":
    """per-module wrap(finmind-conventions):test 可獨立 monkeypatch。"""
    from services.finmind import get_finmind as _real

    return _real()


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


# ---------------------------------------------------------------- dates / caches


def _candidate_dates(date_param: str | None) -> list[str]:
    """起點(date 參數或 today,自適應含 T+0)往前的非週末日,取 FLOW_LOOKBACK_DAYS 個。"""
    d = date_type.fromisoformat(date_param) if date_param else clock.today()
    dates: list[str] = []
    while len(dates) < FLOW_LOOKBACK_DAYS:
        if d.weekday() < 5:
            dates.append(d.isoformat())
        d -= timedelta(days=1)
    return dates


def _result_cache_path(stock_id: str, d: str) -> Path:
    return chip_cache_dir() / f"warrant_flow_{stock_id}_{d}.json"


def _dump_cache_path(d: str) -> Path:
    return chip_cache_dir() / f"flow_prices_{d}.json"


def _write_result_cache(stock_id: str, d: str, payload: dict) -> None:
    atomic_write_json(
        _result_cache_path(stock_id, d), {**payload, "_cache_version": _CACHE_VERSION}
    )


def _read_versioned(path: Path) -> dict | None:
    payload = read_json(path)
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return None
    return payload


def _cleanup_flow_caches(today: date_type) -> int:
    """刪過期 flow_prices_*(>7 天)/ warrant_flow_*(>30 天);單次 iterdir,
    失敗 skip(Windows 檔案佔用)— _cleanup_stale_window_files 慣例。"""
    dump_floor = (today - timedelta(days=_DUMP_RETAIN_DAYS)).isoformat()
    result_floor = (today - timedelta(days=_RESULT_RETAIN_DAYS)).isoformat()
    nontrading_floor = (today - timedelta(days=_NONTRADING_RETAIN_DAYS)).isoformat()
    removed = 0
    for p in chip_cache_dir().iterdir():
        if p.suffix != ".json":
            continue
        stem = p.stem
        stale = (
            (stem.startswith("flow_prices_") and stem.rsplit("_", 1)[-1] < dump_floor)
            or (stem.startswith("warrant_flow_") and stem.rsplit("_", 1)[-1] < result_floor)
            or (stem.startswith("flow_nontrading_") and stem.rsplit("_", 1)[-1] < nontrading_floor)
        )
        if not stale:
            continue
        try:
            p.unlink()
            removed += 1
        except OSError:
            continue
    return removed


# ---------------------------------------------------------------- fetch


def _fake_price_day(d: str) -> list[dict]:
    """FAKE 分支:fixtures/warrants/ 子目錄直讀(不進 MANIFEST _store,避免汙染
    market_breadth 的 FAKE per-day loop — design §2.3),以 D 過濾模擬 date-only 語意。"""
    payload = read_json(warrants._fixtures_dir() / "warrants" / "price_day.json")
    if isinstance(payload, dict):
        rows = payload.get("data") or []
    else:
        rows = payload or []
    return [r for r in rows if r.get("date") == d]


async def _fetch_price_day(d: str, refresh: bool) -> list[dict]:
    """TaiwanStockPrice date-only 全市場 dump,per-date cache + 跨 stock dedup。

    獨立 cache prefix(flow_prices_)— market_breadth 的 cleanup 會刪非當前
    window 的 breadth_prices_*,共用必互踩(design R5/R7)。
    """
    if os.getenv("FAKE_FINMIND") == "1":
        return _fake_price_day(d)
    if not refresh:
        cached = _read_versioned(_dump_cache_path(d))
        if cached is not None:
            return cached.get("rows", [])

    async def _do_fetch() -> list[dict]:
        rows = await get_finmind().stock_price_universe_day(d)
        trimmed = [{k: r[k] for k in _PRICE_DAY_KEEP_KEYS if k in r} for r in rows]
        # R15:D ≥ today−1 的空 dump 不落 cache(當日稍晚上料 + ingestion 跨午夜緩衝)
        recent_floor = (clock.today() - timedelta(days=1)).isoformat()
        if trimmed or d < recent_floor:
            atomic_write_json(
                _dump_cache_path(d), {"_cache_version": _CACHE_VERSION, "rows": trimmed}
            )
        return trimmed

    # R14:dedup key 帶 refresh 旗標(market_breadth F2 precedent),refresh 請求
    # 不得 join 到 cache-read 路徑的 in-flight task
    return await _run_once(f"flow_prices_{d}_r{int(refresh)}", _do_fetch)


async def _fetch_report(wid: str, d: str) -> list[dict]:
    """分點報表單檔;FinMind start_date open-ended 回多日 rows → 只留查詢日。"""
    raw = await get_finmind().fetch_warrant_trading_daily_report(wid, d)
    return [r for r in raw if r.get("date") == d]


# ---------------------------------------------------------------- aggregate


def _aggregate(
    reports: dict[str, list[dict]],
    winfo: dict[str, dict],
    money: dict[str, float],
    trade_value_by_kind: dict[str, float],
) -> dict:
    """三層聚合(spec §3;external_net 口徑 change-spec D1)。金額 = price × 股數,
    輸出四捨五入到分(2 位)。RE-1:跨全分點 net ≡ 0 → per-warrant「淨買賣超」
    無資訊量,改 external_net = −(發行商 HO seat net) = 外部人(散戶/主力/他券商)
    淨買賣;HO 無法對映(brand 抽取失敗/報表空/無 HO row)→ None,不冒充 0。"""
    branches: dict[str, dict] = {}
    # per-warrant HO seat 名集(None = brand 不可得 → external_net None)
    ho_names: dict[str, set[str] | None] = {}
    for wid in reports:
        w = winfo[wid]
        brand = _issuer_brand(str(w.get("name") or ""), str(w.get("underlying_name") or ""))
        ho_names[wid] = _ho_seat_names(brand) if brand else None
    ho_net: dict[str, float] = {}  # 只在見到 HO row 時建 key(缺 key = 無 HO → None)
    for wid, rows in reports.items():
        kind = winfo[wid]["kind"]
        name = winfo[wid]["name"]
        for r in rows:
            try:
                price = float(r["price"])
                buy = int(r["buy"])
                sell = int(r["sell"])
                tid = str(r["securities_trader_id"])
                tname = str(r["securities_trader"])
            except (KeyError, TypeError, ValueError):
                logger.warning("skip bad warrant flow row: %r", r)
                continue
            bv, sv = price * buy, price * sell
            names = ho_names[wid]
            if names is not None and len(tid) == 4 and tname in names:
                ho_net[wid] = ho_net.get(wid, 0.0) + (bv - sv)
            b = branches.setdefault(
                tid,
                {
                    "broker_id": tid,
                    "broker_name": tname,
                    "buy_value": 0.0,
                    "sell_value": 0.0,
                    "warrants": {},
                },
            )
            b["buy_value"] += bv
            b["sell_value"] += sv
            w = b["warrants"].setdefault(
                wid,
                {
                    "warrant_id": wid,
                    "name": name,
                    "kind": kind,
                    "buy_value": 0.0,
                    "sell_value": 0.0,
                },
            )
            w["buy_value"] += bv
            w["sell_value"] += sv

    # summary external_net:Σ 非 null 權證;該 kind 全 null → None(SC-B/SC-C)
    kind_sum: dict[str, list] = {"call": [0.0, False], "put": [0.0, False]}
    external: dict[str, float | None] = {}
    for wid in reports:
        ext = round(-ho_net[wid], 2) if wid in ho_net else None
        external[wid] = ext
        if ext is not None:
            acc = kind_sum[winfo[wid]["kind"]]
            acc[0] += ext
            acc[1] = True
    summary = {
        k: {
            "trade_value": round(trade_value_by_kind.get(k, 0.0), 2),
            "external_net": round(acc[0], 2) if acc[1] else None,
        }
        for k, acc in kind_sum.items()
    }

    finalized: list[dict] = []
    for b in branches.values():
        rows = []
        for w in b["warrants"].values():
            w["buy_value"] = round(w["buy_value"], 2)
            w["sell_value"] = round(w["sell_value"], 2)
            w["net_value"] = round(w["buy_value"] - w["sell_value"], 2)
            rows.append(w)
        rows.sort(key=lambda w: -abs(w["net_value"]))
        buy_v = round(b["buy_value"], 2)
        sell_v = round(b["sell_value"], 2)
        finalized.append(
            {
                "broker_id": b["broker_id"],
                "broker_name": b["broker_name"],
                "buy_value": buy_v,
                "sell_value": sell_v,
                "net_value": round(buy_v - sell_v, 2),
                "warrants": rows,
            }
        )
    top_buy = sorted((b for b in finalized if b["net_value"] > 0), key=lambda b: -b["net_value"])[
        :15
    ]
    top_sell = sorted((b for b in finalized if b["net_value"] < 0), key=lambda b: b["net_value"])[
        :15
    ]
    warrant_rows = [
        {
            "warrant_id": wid,
            "name": winfo[wid]["name"],
            "kind": winfo[wid]["kind"],
            "trading_money": money.get(wid, 0.0),
            "external_net": external[wid],
        }
        for wid in reports
    ]
    warrant_rows.sort(key=lambda w: -w["trading_money"])
    return {
        "summary": summary,
        "top_buy_branches": top_buy,
        "top_sell_branches": top_sell,
        "warrants": warrant_rows,
    }


def _empty_payload(reason: str, as_of: str | None, unmapped: int) -> dict:
    """空 payload 鍵恆齊全(design §2.2b);no_trading_day 由 get_flow 統一貼。"""
    return {
        "as_of_date": as_of,
        "truncated": False,
        "total_traded": 0,
        "analyzed": 0,
        "unmapped_count": unmapped,
        "empty_reason": reason,
        "summary": {
            "call": {"trade_value": 0.0, "external_net": None},
            "put": {"trade_value": 0.0, "external_net": None},
        },
        "top_buy_branches": [],
        "top_sell_branches": [],
        "warrants": [],
    }


# ---------------------------------------------------------------- orchestration


def _is_warrant_shaped(stock_id: str) -> bool:
    return len(stock_id) == 6 and stock_id[:2] in _WARRANT_PREFIXES


async def try_build_day(
    stock_id: str,
    d: str,
    snap: dict,
    winfo: dict[str, dict],
    mapped_all: set[str] | None,
    refresh: bool,
) -> tuple[str, dict | None, set[str] | None]:
    """單日建置(dump → traded 過濾 → probe → fan-out → aggregate → 落 cache)。

    自 get_flow 候選日迴圈抽出的共用點(warrant_flow_history 也用,公開命名)。
    status:``built``(payload 已落 cache,含 no_volume)/ ``no_dump``(dump 空 —
    假日或未上料)/ ``report_pending``(dump 有、probe 0 rows — 報表未上料)。
    mapped_all 由 caller 跨日重用(首個非空 dump 時自建並隨 tuple 回傳)。
    """
    dump = await _fetch_price_day(d, refresh)
    if not dump:
        return ("no_dump", None, mapped_all)
    if mapped_all is None:
        mapped_all = {w["warrant_id"] for rows in snap["by_underlying"].values() for w in rows}
    mapped = mapped_all  # narrowed 別名(pyright 迴圈 back-edge 不保 narrowing)
    traded: list[tuple[str, float]] = []
    unmapped = 0
    for r in dump:
        sid = str(r.get("stock_id", ""))
        m = r.get("Trading_money") or 0
        if m <= 0:
            continue
        if sid in winfo:
            traded.append((sid, float(m)))
        elif _is_warrant_shaped(sid) and sid not in mapped:
            unmapped += 1
    if unmapped:
        logger.info("warrant flow %s %s: %d traded warrants unmapped", stock_id, d, unmapped)
    if not traded:
        payload = _empty_payload("no_volume", d, unmapped)
        _write_result_cache(stock_id, d, payload)
        return ("built", payload, mapped_all)
    # summary trade_value:mapped 有量權證全集合(未 cap;SC-B —
    # 與 header「有量權證 N 檔」同口徑,external_net 才受 cap 限制)
    trade_value_by_kind: dict[str, float] = {"call": 0.0, "put": 0.0}
    for sid, m in traded:
        trade_value_by_kind[winfo[sid]["kind"]] += m
    traded.sort(key=lambda t: -t[1])
    total = len(traded)
    analyzed = traded[:FLOW_CAP]
    # 可得性 probe:top-1 一發,0 rows = 報表未上料 → 下一候選日
    top_wid = analyzed[0][0]
    probe_rows = await _fetch_report(top_wid, d)
    if not probe_rows:
        return ("report_pending", None, mapped_all)
    reports: dict[str, list[dict]] = {top_wid: probe_rows}
    rest = [wid for wid, _ in analyzed[1:]]
    try:
        async with asyncio.TaskGroup() as tg:
            tasks = {wid: tg.create_task(_fetch_report(wid, d)) for wid in rest}
    except* httpx.HTTPError as eg:
        # 整包放棄(不 cache 部分結果);TaskGroup 已取消 siblings
        raise eg.exceptions[0] from None
    for wid, task in tasks.items():
        reports[wid] = task.result()
    # 聚合是純 Python 迴圈(cap 200 × 熱門權證 ~290 rows ≈ 58k 列),
    # 丟 to_thread 讓 event loop 不被單 tick 佔滿(market-pipeline
    # hot-path 教訓;純函式無共享狀態,thread 安全)
    aggregated = await asyncio.to_thread(
        _aggregate, reports, winfo, dict(analyzed), trade_value_by_kind
    )
    payload = {
        "as_of_date": d,
        "truncated": total > FLOW_CAP,
        "total_traded": total,
        "analyzed": len(analyzed),
        "unmapped_count": unmapped,
        "empty_reason": None,
        **aggregated,
    }
    _write_result_cache(stock_id, d, payload)
    return ("built", payload, mapped_all)


async def get_flow(stock_id: str, date: str | None = None, refresh: bool = False) -> dict:
    """標的權證買賣超分點聚合(route 入口)。"""

    async def _impl() -> dict:
        try:
            snap = await warrants.get_snapshot()
        except (httpx.HTTPError, HTTPException) as exc:
            # R16:快照層錯誤(含其 404 no_data)一律 warrant_upstream —
            # no_data 碼專屬「候選日耗盡」單一語意
            logger.warning("warrant flow snapshot unavailable: %s", exc)
            raise HTTPException(status_code=502, detail={"error": "warrant_upstream"}) from exc
        wlist = snap.get("by_underlying", {}).get(stock_id, [])
        if not wlist:
            return _empty_payload("no_warrants", None, 0)

        winfo = {w["warrant_id"]: w for w in wlist}
        # 全市場 mapped set(~38k)延後到首個非空 dump 才建 — cache-hit 熱路徑
        # 不付 O(全快照) 掃描(code-review round 1 efficiency)
        mapped_all: set[str] | None = None

        for d in _candidate_dates(date):
            if not refresh:
                cached = _read_versioned(_result_cache_path(stock_id, d))
                if cached is not None:
                    cached.pop("_cache_version", None)
                    return cached
            status, payload, mapped_all = await try_build_day(
                stock_id, d, snap, winfo, mapped_all, refresh
            )
            if payload is None:  # no_dump / report_pending → 下一候選日
                continue
            # cleanup 僅在 full-build 路徑跑(no_volume return 不跑 — 抽出前行為照舊)
            if status == "built" and payload.get("empty_reason") is None:
                removed = _cleanup_flow_caches(clock.today())
                if removed:
                    logger.info("warrant flow cache cleanup removed %d files", removed)
            return payload
        raise HTTPException(status_code=404, detail={"error": "no_data"})

    result = await _run_once(f"flow_{stock_id}_{date or 'latest'}_{int(refresh)}", _impl)
    if date is not None and result.get("as_of_date") not in (None, date):
        # flag 不烙進 cache(同 cache entry 服務預設與顯式 date 查詢)— impl-R5
        result = {**result, "no_trading_day": True}
    return result
