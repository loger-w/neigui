# /feat Phase 4:test-gap finding 的修復操作

**條件式** —— 收到 test-gap 類 finding 時才需要讀本檔。

## Lock test(鎖「已正確行為」)

test-gap finding 要補的測試鎖的是**已經正確的行為**,天生無紅可先行。改走 **mutation
抽驗**:

1. 手動改壞實作(用 Edit 工具)
2. 確認 lock test **紅**
3. 還原(用 Edit 工具成對操作)
4. 確認 **綠**

commit 用 `[lock]` tag,body 註 `mutation-verified`。

> `[lock]` 的 `mutation-verified` 是**機械驗證項**(`check_feat_tags.py` 掃 body),
> 規則搬進本 ref 不等於 gate 消失。

## 禁止用 git 還原

**改壞 / 還原一律用 Edit 工具成對操作,禁止 `git checkout` / `git restore`** —— 那會連同
掃掉同檔尚未 commit 的 review fix。
