"""SC-7 / D6:/api/_meta/mode 是 Playwright globalSetup probe target(R2-P0-3 / F6)。

痛點(/goal):
- 沒此 endpoint → Playwright globalSetup 無法 verify backend 是 fake mode →
  reuseExistingServer 撞到 dev server 真 backend 整套 E2E 燒 quota
- shape drift(欄位改名、漏欄位)→ globalSetup 解 body 撞 KeyError 整 e2e
  suite 起不來
"""


async def test_meta_mode_returns_fake_true_with_fake_today(client):
    r = await client.get("/api/_meta/mode")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "fake": True,
        "fake_today": "2026-06-26",
        "fixtures_dir": "<default>",
    }, f"shape drift detected: {body}"
