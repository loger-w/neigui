"""SC-7 / D7:鎖 {"detail": {"error": "<code>"}} shape 跨 endpoint。

痛點:frontend/src/lib/api.ts 的 __apiGet 依賴此 shape,直接讀 body.detail.error
做錯誤訊息。任何 endpoint 回不一樣 shape(e.g. {"detail": "raw string"}
FastAPI default for HTTPException(detail=str))→ 前端錯誤訊息變 [object Object]
或 undefined。本 test 跨 endpoint 抽樣鎖 shape。
"""


async def test_400_error_shape_chip_broker_history(client):
    r = await client.get("/api/chip/2330/broker_history")
    assert r.status_code == 400
    body = r.json()
    assert "detail" in body, body
    assert isinstance(body["detail"], dict), f"detail must be dict, got {type(body['detail'])}"
    assert "error" in body["detail"]
    assert isinstance(body["detail"]["error"], str)


async def test_400_error_shape_options_max_pain(client):
    r = await client.get("/api/options/max_pain")
    assert r.status_code == 400
    body = r.json()
    assert isinstance(body["detail"], dict)
    assert body["detail"]["error"] == "contract_required"


async def test_500_error_shape_global_handler():
    """痛點:任何未 catch 的 Exception 走 generic_error_handler 也要保持
    shape — 不能 leak stack trace 或 FastAPI default 500 page。

    模擬法:用內部 testclient,呼一個會 internally raise unhandled exception
    的 endpoint。如果現在沒這種 endpoint,本 test 作為 fixture 文件化 —
    將來新加 raise 路徑時提醒對齊 shape。本 test 暫 skip 但保留 lesson。
    """
    import pytest

    pytest.skip("placeholder: 等真有非預期 endpoint 例外時再實作")
