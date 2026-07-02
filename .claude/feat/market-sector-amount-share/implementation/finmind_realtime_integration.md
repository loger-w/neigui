# Implementation Spec — `backend/services/finmind_realtime.py`(P4 整合,add-only)

**Pre-reading**: `../design.md` v2 §4.4

**動作**:add-only。兩個插入點:
1. `_fetch_sector_volume_ratio` 函式之後(line ~421)加 `_fetch_sector_amount_share` helper
2. `_do_fetch_market_snapshot` 內 sector_volume_ratio try/except 之後(line ~607)加第三個
   try/except;return dict 的 `"sector_volume_ratio"` 之後加 `"sector_amount_share"` key

**不動**:既有 P1/P2/P3 payload key 順序、stale 計算式、既有兩個 P3 try/except。

## 1. Helper(對齊 `_fetch_sector_breadth` pattern)

```python
async def _fetch_sector_amount_share(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
) -> list[dict] | None:
    """market-monitor-v2 P4 (SC-6) — delegate to sector_aggregation.compute_sector_amount_share.

    Empty universe → None (silent skip)。F6 sequel:exceptions propagate to
    caller's try/except httpx.HTTPError only(aggregation empty prices → [] 不 raise)。
    """
    if not universe:
        return None
    from services import sector_aggregation as sa

    return await sa.compute_sector_amount_share(end_date, universe, sector_map, refresh=refresh)
```

## 2. `_do_fetch_market_snapshot` 追加段

```python
    # market-monitor-v2 P4 (SC-6) — sector_amount_share (F6 sequel: fail 不動 stale;
    # independent try/except from P3 twins; 共用 cache_key → serial near-zero cost)
    try:
        sector_amount_share = await _fetch_sector_amount_share(
            clock.today(), allowed, primary_sector, refresh=refresh
        )
    except httpx.HTTPError as exc:
        logger.warning("market snapshot: sector_amount_share compute failed: %s", exc)
        sector_amount_share = None
```

return dict(末尾兩行變三行):

```python
        "sector_breadth": sector_breadth,
        "sector_volume_ratio": sector_volume_ratio,
        # market-monitor-v2 P4 (SC-6) — sector amount share (None if compute failed)
        "sector_amount_share": sector_amount_share,
    }
```

## 3. Failure tests(Phase 3 red,`backend/tests/test_finmind_realtime.py` 檔尾追加)

樣板:該檔既有 P3 T-INT 區塊(`unittest.mock.patch` + `AsyncMock` — 該檔既有慣例,
不改用 monkeypatch)。**(IG1)每個測試掛 `@pytest.mark.usefixtures("bypass_finmind_rate_limiter")`**
(同區塊既有四測試固定樣板)。**(IG2)區塊 header 註解註明 design 出處
(`.claude/feat/market-sector-amount-share/design.md v2 §4.4`),docstring 編號帶 P4 前綴
(`P4 T-INT-1: ...`)避免與既有 P3 T-INT-1/2/3/4 docstring 撞名**。共用 fake payload 常數:

```python
_FAKE_SECTOR_AMOUNT_PAYLOAD = [
    {"sector": "半導體業", "today_share": 0.412, "share_delta_20ma": 0.034},
    {"sector": "其他電子業", "today_share": 0.126, "share_delta_20ma": None},
]
```

- **T-INT-1** `test_snapshot_payload_adds_sector_amount_share`:
  patch 全 5 個 fetch(universe / sector_map / mv / watch_list / breadth)+
  `_fetch_sector_breadth` / `_fetch_sector_volume_ratio` / `_fetch_sector_amount_share` 全 stub →
  assert `result["sector_amount_share"] == _FAKE_SECTOR_AMOUNT_PAYLOAD` +
  P1(`universe_size`/`excluded_count`)/ P2(`breadth`)/ P3(兩欄)intact + `stale is False`
- **T-INT-2** `test_snapshot_sector_amount_share_fail_does_not_flip_stale`:
  `_fetch_sector_amount_share` → `AsyncMock(side_effect=httpx.HTTPError("boom"))`,
  P3 兩 stub 正常 → assert `sector_amount_share is None` + `sector_breadth` /
  `sector_volume_ratio` intact(獨立 try/except)+ `stale is False`(F6 sequel)
- **T-INT-3** `test_snapshot_empty_universe_sector_amount_share_none`:
  fake_universe = `[]`(allowed 收斂為空),**不 patch** `_fetch_sector_amount_share`
  (讓 helper 的 `if not universe: return None` gate 真實觸發)→
  assert `result["sector_amount_share"] is None`

### 3.1 Phase 4 review 追加(code-review-round-1)

- **T-INT-1 擴充**(TS-5):補 key-order assertions —
  `keys = list(result.keys()); assert keys[-1] == "sector_amount_share";
  assert keys[keys.index("sector_volume_ratio") + 1] == "sector_amount_share"`
- **P4 T-INT-4** `test_snapshot_sector_amount_share_value_error_propagates`(TS-4):
  `_fetch_sector_amount_share` side_effect=ValueError → `pytest.raises(ValueError)`
  around fetch_market_snapshot — 鎖 except 寬度(只 httpx 降級,其他 fail-loud)
- **P4 T-INT-5** `test_snapshot_amount_share_delegate_args`(TS-2):
  helper **不 patch**,spy `services.sector_aggregation.compute_sector_amount_share`
  (AsyncMock return sentinel),`fetch_market_snapshot(refresh=True)` →
  assert awaited once with (clock.today(), {"2330"}, {"2330": "半導體業"}) + refresh=True;
  payload 欄位 == sentinel

## 4. SC 對應

| SC | tests |
|---|---|
| SC-6 | T-INT-1 / T-INT-2 / T-INT-3 |

## 5. Known Risks

- 無新增(stale 契約 / payload 順序均不動;風險同 design §9)
