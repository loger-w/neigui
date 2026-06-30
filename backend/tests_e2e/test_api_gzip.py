"""SC-7 / D8:GZipMiddleware 觸發 contract(main.py:50 minimum_size=1000)。

痛點:Vercel deployment + frontend fetch 依賴 gzip 來壓縮 ~10MB chip history
payload。若 minimum_size 被改大(或 middleware 被移除),frontend cold load
從 6 秒變 30 秒,使用者抱怨「載入超慢」是 cache 失效後才發現。本 test 早抓。
"""


async def test_large_response_uses_gzip(client):
    """K 線 history > 1000 bytes 應觸發 gzip。"""
    r = await client.get(
        "/api/chip/2330/history",
        headers={"Accept-Encoding": "gzip"},
    )
    assert r.status_code == 200
    # httpx ASGITransport 會 auto-decode gzip,但 raw response headers
    # 應該有 content-encoding: gzip
    enc = r.headers.get("content-encoding", "")
    assert "gzip" in enc.lower(), (
        f"large response (>{1000} bytes) should be gzip-encoded, headers: {dict(r.headers)}"
    )


async def test_small_response_skips_gzip(client):
    """_meta/mode payload 只 ~80 bytes — 應該 BYPASS gzip(< minimum_size)。
    痛點:如果 minimum_size 被誤改成 0/1,小 payload 也 gzip,加 overhead
    無收益。本 test 鎖 minimum_size 邊界。"""
    r = await client.get(
        "/api/_meta/mode",
        headers={"Accept-Encoding": "gzip"},
    )
    enc = r.headers.get("content-encoding", "")
    assert "gzip" not in enc.lower(), (
        f"small response should NOT be gzipped, headers: {dict(r.headers)}"
    )
