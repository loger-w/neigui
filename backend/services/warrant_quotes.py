"""權證盤中報價層 — TWSE MIS 批次五檔 + 即時計算欄位。

MIS 非官方端點(spec §2.4 實測):批次上限 ~140(S-6)→ 100 留 headroom;
收盤後回最後盤中快照,「盤後也能選」零分支。Provider 抽象 = _fetch_mis_raw
單點,換源不動計算層。design .claude/feat/warrant-selector/design.md v3 §1.3。
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl
import time
from collections import OrderedDict
from datetime import date as date_type
from typing import Any, Awaitable, Callable

import httpx

from services import clock, warrants
from services.warrant_pricing import RISK_FREE_RATE, bs_delta, bs_price, implied_vol
from utils.cache import read_json
from utils.concurrency import run_once

logger = logging.getLogger(__name__)

MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
MIS_BATCH_SIZE = 100  # S-6:140 OK / 145 炸,留 headroom
# perf/warrant-api-load S4:2330 級 16 批全序列盤中 1.4-1.8s 貼 2s 線;
# 有限並發 3 溫和試探(S-6 的 145 炸是單批 size 上限,非並發證據)—
# 真實環境若見 MIS 錯誤/封鎖徵兆,revert 本常數即回序列
MIS_MAX_CONCURRENCY = 3
QUOTES_COOLDOWN_SEC = 10.0  # S-6;前端 refetchInterval 15s > cooldown
QUOTES_COOLDOWN_MAX = 8  # cooldown dict 上限(R8)
MISPRICE_FAIR_BAND = 0.10  # 估價差 ±10% 內 = 合理 [auto-default: 實作期校準]
IV_PCTL_MIN_SAMPLES = 5  # 同組樣本 < 5 → null
IV_PCTL_MONEYNESS_BAND = 0.10
IV_PCTL_TENOR_RATIO = 2.0
_UA = "Mozilla/5.0 (neigui-backend)"

_client: httpx.AsyncClient | None = None
_inflight: dict[str, dict[str, Any]] = {}
# {stock_id: (monotonic_ts, payload)} — 最近使用在尾端,超額踢頭
_cooldown: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_monotonic = time.monotonic


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=30.0,
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


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup — 委派 utils.concurrency.run_once(refcount + shield)。"""
    return await run_once(_inflight, key, coro_fn)


# ---------------------------------------------------------------- MIS fetch / parse


def _fixtures_dir() -> str:
    raw = os.getenv("FAKE_FINMIND_FIXTURES_DIR", "").strip()
    if raw:
        return raw
    import pathlib

    return str(pathlib.Path(__file__).resolve().parents[1] / "tests_e2e" / "fixtures")


async def _fetch_mis_raw(ex_ch: str) -> list:
    """單一批次(provider 抽象單點;FAKE 讀 fixture 並依請求代號過濾)。"""
    if os.getenv("FAKE_FINMIND") == "1":
        import pathlib

        payload = read_json(pathlib.Path(_fixtures_dir()) / "warrants" / "mis_quotes.json")
        rows = payload.get("msgArray") if isinstance(payload, dict) else None
        if not rows:
            return []
        codes = {seg.split("_", 1)[1].removesuffix(".tw") for seg in ex_ch.split("|")}
        return [m for m in rows if m.get("c") in codes]
    resp = await _get_client().get(MIS_URL, params={"ex_ch": ex_ch, "json": "1", "delay": "0"})
    resp.raise_for_status()
    body = resp.json()
    return body.get("msgArray") or []


def _parse_price(v: Any) -> float | None:
    """MIS `-` 佔位 / 空字串 → None(warrants._parse_price 同構 local 複製
    — 不跨模組引私有,code-review CR-2;local-copy 慣例同 _run_once)。"""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s in ("---", "-"):
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _first_of(raw: Any) -> float | None:
    """五檔 `_` 分隔字串取第一檔;`-` 佔位、尾綴 `_` 容忍(spec §2.4 髒點)。"""
    if raw is None:
        return None
    parts = [p for p in str(raw).strip().split("_") if p]
    if not parts:
        return None
    return _parse_price(parts[0])


def _parse_mis_row(m: dict) -> dict | None:
    try:
        d = str(m.get("d") or "").strip()
        tlong_raw = str(m.get("tlong") or "").strip()
        ask_vol = _first_of(m.get("f"))
        bid_vol = _first_of(m.get("g"))
        return {
            "code": str(m["c"]).strip(),
            "z": _parse_price(m.get("z")),
            "bid": _first_of(m.get("b")),
            "ask": _first_of(m.get("a")),
            "bid_vol": int(bid_vol) if bid_vol is not None else None,
            "ask_vol": int(ask_vol) if ask_vol is not None else None,
            "quote_date": f"{d[:4]}-{d[4:6]}-{d[6:]}" if len(d) == 8 else None,
            "quote_time": str(m.get("t") or "")[:5] or None,
            "tlong": int(tlong_raw) if tlong_raw.isdigit() else None,
        }
    except (KeyError, ValueError, TypeError):
        logger.warning("skip bad MIS row: %r", m.get("c", m))
        return None


# ---------------------------------------------------------------- 計算


def _price_basis(q: dict | None) -> float | None:
    if q is None:
        return None
    if q["z"] is not None:
        return q["z"]
    # bid > ask 倒掛不算 mid(code-review CR-1,同 warrants._warrant_price_basis)
    if q["bid"] is not None and q["ask"] is not None and q["bid"] <= q["ask"]:
        return (q["bid"] + q["ask"]) / 2.0
    return None


def _compute_row(term: dict, q: dict | None, s_now: float | None, today: date_type) -> dict:
    ltd = date_type.fromisoformat(term["last_trading_date"])
    days_left = (ltd - today).days  # T 基準 = clock.today()(R5),非快照 as_of
    t_years = days_left / 365.0
    price = _price_basis(q)
    strike = term["strike"]
    ratio = term["exercise_ratio"]
    kind = term["kind"]

    moneyness: float | None = None
    if s_now is not None and strike:
        moneyness = (s_now - strike) / strike if kind == "call" else (strike - s_now) / strike

    iv = delta = leverage = spread_ratio = slr = None
    if (
        not term["is_reset"]
        and price is not None
        and s_now is not None
        and strike is not None
        and ratio is not None
        and ratio > 0
        and t_years > 0
    ):
        iv = implied_vol(price / ratio, s_now, strike, t_years, RISK_FREE_RATE, kind)
        if iv is not None:
            delta = bs_delta(s_now, strike, t_years, RISK_FREE_RATE, iv, kind)
            # 實質槓桿取 |delta|:put 的 delta 為負,取絕對值讓槓桿/差槓比
            # 對 call/put 同語意可排序(spec §4 公式的權證界慣例讀法)
            leverage = abs(delta) * s_now * ratio / price
    if q is not None and q["bid"] and q["ask"] and q["bid"] > 0:
        spread_ratio = (q["ask"] - q["bid"]) / q["bid"]
    if spread_ratio is not None and leverage is not None and leverage > 0:
        slr = spread_ratio / leverage

    theo = mispricing = label = None
    if (
        not term["is_reset"]
        and price is not None  # spec §4:P 皆無 → 計算欄全 null(理論價也不單獨給)
        and term["iv_prev"] is not None
        and s_now is not None
        and strike is not None
        and ratio is not None
        and t_years > 0
    ):
        theo = bs_price(s_now, strike, t_years, RISK_FREE_RATE, term["iv_prev"], kind) * ratio
        if price is not None and theo > 0:
            mispricing = (price - theo) / theo
            if mispricing > MISPRICE_FAIR_BAND:
                label = "expensive"
            elif mispricing < -MISPRICE_FAIR_BAND:
                label = "cheap"
            else:
                label = "fair"

    return {
        "price": price,
        "best_bid": q["bid"] if q else None,
        "best_ask": q["ask"] if q else None,
        "best_bid_vol": q["bid_vol"] if q else None,
        "best_ask_vol": q["ask_vol"] if q else None,
        "moneyness": moneyness,
        "days_left": days_left,
        "iv": iv,
        "delta": delta,
        "leverage": leverage,
        "spread_ratio": spread_ratio,
        "spread_lev_ratio": slr,
        "theo_price": theo,
        "mispricing_pct": mispricing,
        "mispricing_label": label,
        "iv_percentile": None,  # 群組計算後回填
        "quote_time": q["quote_time"] if q else None,
    }


def _fill_iv_percentiles(rows: dict[str, dict], terms_by_id: dict[str, dict]) -> None:
    """同標的 + 同 kind + moneyness band + 天期比群組的現價 IV 百分位。"""
    candidates = [
        (wid, r)
        for wid, r in rows.items()
        if r["iv"] is not None and r["moneyness"] is not None and r["days_left"] > 0
    ]
    for wid, r in candidates:
        kind = terms_by_id[wid]["kind"]
        group = [
            o["iv"]
            for oid, o in candidates
            if terms_by_id[oid]["kind"] == kind
            and abs(o["moneyness"] - r["moneyness"]) <= IV_PCTL_MONEYNESS_BAND
            and max(o["days_left"], r["days_left"]) / min(o["days_left"], r["days_left"])
            <= IV_PCTL_TENOR_RATIO
        ]
        if len(group) < IV_PCTL_MIN_SAMPLES:
            continue
        r["iv_percentile"] = 100.0 * sum(1 for g in group if g <= r["iv"]) / len(group)


# ---------------------------------------------------------------- 對外


def _mis_prefix(market: str) -> str:
    return "tse" if market == "twse" else "otc"


def _write_cooldown(stock_id: str, payload: dict) -> None:
    _cooldown[stock_id] = (_monotonic(), payload)
    _cooldown.move_to_end(stock_id)
    while len(_cooldown) > QUOTES_COOLDOWN_MAX:
        _cooldown.popitem(last=False)


async def _build_quotes(stock_id: str) -> dict:
    # refresh 語意只作用於 cooldown(get_quotes 層);快照 rebuild 不由 quotes
    # 觸發(R11:重操作只留 /api/warrants/{id}?refresh=true 入口)
    snap = await warrants.get_underlying_warrants(stock_id, refresh=False)
    terms = snap["warrants"]
    payload: dict[str, Any] = {
        "stock_id": stock_id,
        "underlying_price": None,
        "quote_date": None,
        "quote_time": None,
        "quotes": {},
    }
    if not terms:
        _write_cooldown(stock_id, payload)
        return payload

    # 標的 prefix = 其權證所在市場(S-6:市場乾淨分割)
    codes = [f"{_mis_prefix(terms[0]['market'])}_{stock_id}.tw"] + [
        f"{_mis_prefix(w['market'])}_{w['warrant_id']}.tw" for w in terms
    ]
    # S4:有限並發送批(≤ MIS_MAX_CONCURRENCY);結果進 dict 按 code 收斂,
    # 批次完成順序不影響 payload
    sem = asyncio.Semaphore(MIS_MAX_CONCURRENCY)

    async def _bounded_fetch(ex_ch: str) -> list:
        async with sem:
            return await _fetch_mis_raw(ex_ch)

    batches = await asyncio.gather(
        *(
            _bounded_fetch("|".join(codes[i : i + MIS_BATCH_SIZE]))
            for i in range(0, len(codes), MIS_BATCH_SIZE)
        )
    )
    raw_rows: list = [m for batch in batches for m in batch]
    quotes_by_code: dict[str, dict] = {}
    for m in raw_rows:
        q = _parse_mis_row(m)
        if q is not None:
            quotes_by_code[q["code"]] = q

    # S_now fallback 鏈(R6):標的 z → mid → 快照 underlying_eod_close → None
    uq = quotes_by_code.get(stock_id)
    s_now = _price_basis(uq)
    if s_now is None:
        s_now = terms[0]["underlying_eod_close"]

    today = clock.today()
    terms_by_id = {w["warrant_id"]: w for w in terms}
    rows: dict[str, dict] = {
        wid: _compute_row(w, quotes_by_code.get(wid), s_now, today)
        for wid, w in terms_by_id.items()
    }
    _fill_iv_percentiles(rows, terms_by_id)

    # 頂層時間戳 fallback(R2-4):標的 → 批次 max tlong → null
    ts_row = uq
    if ts_row is None or ts_row["tlong"] is None:
        with_tlong = [q for q in quotes_by_code.values() if q["tlong"] is not None]
        ts_row = max(with_tlong, key=lambda q: q["tlong"]) if with_tlong else None
    payload.update(
        {
            "underlying_price": s_now,
            "quote_date": ts_row["quote_date"] if ts_row else None,
            "quote_time": ts_row["quote_time"] if ts_row else None,
            "quotes": rows,
        }
    )
    _write_cooldown(stock_id, payload)
    return payload


async def get_quotes(stock_id: str, refresh: bool = False) -> dict:
    """盤中(或收盤後最後快照)quotes;cooldown 命中直接回(R8 定序)。"""
    entry = _cooldown.get(stock_id)
    if not refresh and entry is not None and _monotonic() - entry[0] < QUOTES_COOLDOWN_SEC:
        return entry[1]
    return await _run_once(f"quotes_{stock_id}", lambda: _build_quotes(stock_id))
