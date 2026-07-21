"""FakeFinMindClient — 繼承 FinMindClient,_get override 讀 fixture by MANIFEST。

設計依據:.claude/feat/e2e-tests/design.md v6 §3 SC-2(R3-P0-PARSE / R4-P1)

R3-P0-PARSE 修正:不用 filename heuristic,讀 fixtures/MANIFEST.json explicit map
              → 零 parsing 歧義,零 silent MISS。
R4-P1 修正:MANIFEST 對映同 (dataset, data_id) 的多檔(env-gate 用 + _get 用)
       靠 skip_store flag 區隔,_get 時 collision raise 死。

Lookup 流程:
1. _get(url, params) → 取 (dataset, data_id)
   - dataset = params['dataset'] 或 url.rsplit('/', 1)[-1] (path-tail fallback,
     對應 taiwan_stock_trading_daily_report / ..._secid_agg / ..._tick_snapshot
     這類無 dataset query param 的 endpoint)
2. 查 _store[(dataset, data_id)] → preload window rows
3. 若 params 有 start/end/date,in-memory date filter rows by row['date']
   in {target dates}(對應 service 層 per-day fan-out 切片邏輯)。
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date as _date_t, timedelta as _td
from pathlib import Path

from services.finmind import FinMindClient

logger = logging.getLogger(__name__)

_FIXTURE_DIR = Path(
    os.getenv(
        "FAKE_FINMIND_FIXTURES_DIR",
        str(Path(__file__).resolve().parent.parent / "tests_e2e" / "fixtures"),
    )
)


class FakeFinMindClient(FinMindClient):
    def __init__(self) -> None:
        super().__init__()  # FinMindClient.__init__ detects FAKE_FINMIND=1 skip path
        manifest_path = _FIXTURE_DIR / "MANIFEST.json"
        if not manifest_path.exists():
            raise FileNotFoundError(
                f"fake-finmind MANIFEST missing: {manifest_path}。"
                "請建 MANIFEST.json 對映 filename → {dataset, data_id}。"
            )
        manifest: dict[str, dict] = json.loads(manifest_path.read_text(encoding="utf-8"))

        # By (dataset, data_id) → list[dict]
        self._store: dict[tuple[str, str], list[dict]] = {}
        for fname, key in manifest.items():
            p = _FIXTURE_DIR / fname
            if not p.exists():
                raise FileNotFoundError(f"MANIFEST 列了但 fixture 不存在:{p}")
            if key.get("skip_store"):
                # R4-P1:某些 fixture(TaiwanFuturesDaily_TX_calendar /
                # TaiwanStockInfo)由 env-gate fs read,不能進 _store 否則跟
                # 同 (dataset, data_id) 的單日 fixture 撞 key 互蓋
                continue
            raw = json.loads(p.read_text(encoding="utf-8"))
            rows: list[dict] = raw["data"] if isinstance(raw, dict) and "data" in raw else raw
            if not isinstance(rows, list):
                raise ValueError(
                    f"fixture {fname} payload not list-like: got {type(rows).__name__}"
                )
            store_key = (key["dataset"], key.get("data_id", ""))
            if store_key in self._store:
                raise ValueError(
                    f"MANIFEST 對 {store_key} 有 ≥ 2 條 fixture 對映 — 互蓋 risk"
                    " (R4-P1)。加 skip_store:true 或合併 fixture。"
                )
            self._store[store_key] = rows
        logger.info(
            "FakeFinMindClient preloaded %d entries to _store from MANIFEST",
            len(self._store),
        )

    async def close(self) -> None:
        return None

    async def _get(self, url: str, params: dict) -> list:
        # path-tail fallback for endpoints w/o dataset query param
        dataset = params.get("dataset") or url.rsplit("/", 1)[-1]
        data_id = params.get("data_id", "")
        start = params.get("start_date", "")
        end = params.get("end_date", "")
        single_date = params.get("date", "")

        rows = self._store.get((dataset, data_id))
        if rows is None and data_id:
            # 退一步試 universe fixture — 但必須複製上游查詢語意(真實 API 帶
            # data_id 只回該檔):universe rows 按 stock_id == data_id 過濾,
            # 否則單股查詢(如 2412 kline)會拿到整包全市場 rows(2026-07-20
            # populated market fixture 加入後此 fallback 首次真的會命中)
            universe_rows = self._store.get((dataset, ""))
            if universe_rows is not None:
                rows = [r for r in universe_rows if r.get("stock_id") == data_id]
        if rows is None:
            logger.info(
                "fake-finmind MISS dataset=%s data_id=%s start=%s end=%s",
                dataset,
                data_id,
                start,
                end,
            )
            return []

        # 複製上游 trader 過濾語意(feat/broker-daily-flows):真實 API 帶
        # securities_trader_id 只回該分點 rows — 分點反查(trader-only)與
        # SecIdAgg(data_id+trader)都吃這條;無此參數的呼叫不受影響。
        trader_id = params.get("securities_trader_id", "")
        if trader_id:
            rows = [r for r in rows if r.get("securities_trader_id") == trader_id]

        # In-memory date filter — 對應 service 層 per-day fan-out 切片(R2-P0-2)
        target_dates: set[str] = set()
        if start and end:
            d0, d1 = _date_t.fromisoformat(start), _date_t.fromisoformat(end)
            while d0 <= d1:
                target_dates.add(d0.isoformat())
                d0 += _td(days=1)
        elif single_date:
            target_dates.add(single_date)

        if not target_dates:
            return rows  # no date filter → return whole payload

        return [r for r in rows if r.get("date") in target_dates]
