"""probe_secid — 查 FinMind secid_agg 的發布時程(next-time 2026-08-18 條目)。

問題:`broker_history` 修復只補 `clock.today()`;若 secid_agg 的發布是「T+1 交易日」
而非「隔日早上」,週末 / 假日看盤時前一交易日的分點柱仍會缺。

用法(週六早上跑最有鑑別力;在 backend/ 下執行):
    python -m scripts.probe_secid                       # 2330 × 9800,近 7 個日曆日
    python -m scripts.probe_secid --symbol 2317 --trader 1440 --days 10

輸出每個日曆日 secid_agg 有無 rows;對照 TaiwanStockPrice 同區間的交易日,
缺的那天就是發布 lag。吃 2 個 FinMind request,不計入可觀配額。
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import timedelta

from dotenv import load_dotenv

from services import clock
from services.finmind import _FINMIND_BASE, FinMindClient

load_dotenv()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="2330")
    ap.add_argument("--trader", default="9800", help="securities_trader_id(分點代號)")
    ap.add_argument("--days", type=int, default=7, help="往回看的日曆日數")
    args = ap.parse_args()

    today = clock.today()
    start = today - timedelta(days=args.days)
    fm = FinMindClient()
    try:
        secid_rows, price_rows = await asyncio.gather(
            fm._safe_get_secid_agg(args.symbol, start.isoformat(), today.isoformat(), args.trader),
            fm._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockPrice",
                    "data_id": args.symbol,
                    "start_date": start.isoformat(),
                    "end_date": today.isoformat(),
                },
            ),
        )
    finally:
        await fm.close()

    secid_dates = {r["date"] for r in secid_rows}
    trading_dates = {r["date"] for r in price_rows}

    print(f"now(TPE)={clock.now().isoformat(timespec='minutes')}  "
          f"symbol={args.symbol} trader={args.trader}  window={start}..{today}")
    print(f"{'date':12s} {'weekday':9s} {'price':6s} {'secid':6s} note")
    for i in range(args.days + 1):
        d = start + timedelta(days=i)
        ds = d.isoformat()
        has_price = ds in trading_dates
        has_secid = ds in secid_dates
        if has_price and not has_secid:
            note = "<-- 交易日但 secid_agg 尚無(發布 lag)"
        elif has_secid and not has_price:
            note = "secid 有但 price 無(price 也還沒出?)"
        else:
            note = ""
        print(f"{ds:12s} {d.strftime('%a'):9s} {'Y' if has_price else '-':6s} "
              f"{'Y' if has_secid else '-':6s} {note}")

    latest_trading = max(trading_dates) if trading_dates else None
    latest_secid = max(secid_dates) if secid_dates else None
    print(f"\nlatest trading day (price) = {latest_trading}")
    print(f"latest secid_agg day        = {latest_secid}")
    if latest_trading and latest_secid and latest_secid < latest_trading:
        print("=> secid_agg 落後最後交易日:broker_history 應改補「最後 candle 日」而非只補 today")
    elif latest_trading and latest_secid == latest_trading:
        print("=> secid_agg 已涵蓋最後交易日:現行「補 today」在此時刻足夠")


if __name__ == "__main__":
    asyncio.run(main())
