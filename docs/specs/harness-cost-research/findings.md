# Harness build loop 成本效率 — 結論與建議

- 依據:45 個有效實驗、11 條假說(逐條記錄於 `hypotheses.md`,含 2 條被推翻)
- Coordinator:`claude-opus-5`
- 一句話:**這個 harness 的成本熱點不在 command 檔,而在(1) prompt cache 是否命中、(2) CLAUDE.md、(3) turn 數。前一輪改版動的是第四順位以後的東西。**

---

## 槓桿排名(對一次 opus session)

| # | 槓桿 | 實測效應 | 現況 | 動它的成本 |
|---|---|---|---|---|
| 1 | **prompt cache 命中** | 同 token 數下成本差 **9.5×**($0.2075 → $0.0218)| 每改一次 harness 檔,下一個 session 全額 write | 零(只需改作業節奏)|
| 2 | **CLAUDE.md** | **−8,826 tok / session(−20.4%)**,且每 turn 重付 | 專案 10,288 chars + user 2,710 chars | 中(要判哪些是真的每 session 必讀)|
| 3 | **turn 數** | 每多一個 turn,**整個 context 再付一次**(實測多一個 turn = +51,826 tok)| 未管理 | 中 |
| 4 | plugin 停用 | −2,768 tok(−6.4%)| superpowers 13 支 + chrome-devtools | 高(harness 依賴其中 4 支)|
| 5 | 多檔合併 | 每檔約 **142 prompt tok + 3× output tok** | Phase 0 讀 3 支 ref、Phase 3 讀 2 支 | 低 |
| 6 | command 檔瘦身 | 六檔合計 −4,846 tok,但**單次只載入一支**(/feat −4,228)| 已完成 | 已付 |

---

## 五條可執行建議

### R1. 把 harness 改動集中在一個時間窗,不要邊做邊改(最高 CP 值)

cache 是**逐位元組的 prefix 比對**;改任何一個進 prompt 的檔,下一個 session 就從 read(0.1×)掉回 write(1.25×)。實測那是 **9.5 倍**的單次成本差。

- 改 harness 時集中改完再開新 session,不要一天散改五次
- 這條**不需要動任何檔案**,純作業節奏,效益卻高於本輪所有結構改動的總和

### R2. 下一輪把 scope 對準 CLAUDE.md,不是 command 檔

`harness-context-slimdown` 的 §10 明文把常駐層劃在 scope 外,而實測顯示常駐層佔 prompt 的 **19%**,command 檔只佔 4.5%(/feat 被叫用時)。方向搞反了。

具體:專案 CLAUDE.md 10,288 chars ≈ 5,758 token。它每個 turn 都在 context 裡。一個 10 turn 的 /feat,光它就是 57,580 token 的重複支出。

判準建議:**只有「每個 session、每個流程都會用到」的內容才留在 CLAUDE.md**;只有動到某塊 code 才需要的,已經有 §8 的主題 skill 機制可以承接。

### R3. SC 指標改成「峰值 × turn 數」,不是總 bytes

現行 SC-2 量「所有 phase 載入量總和」,那個數字沒有對應到任何真實付款事件。真正付錢的模型是:

```
單次 session 成本 ≈ (常駐層 + 已讀入的檔) × turn 數 × (cache 命中 ? 0.1 : 1.25)
```

所以該量的是**每個 phase 的峰值駐留量**,再乘上該 phase 的典型 turn 數。資料源已存在(`load-manifest.json` 的 `phase` 欄),`refs_for_phase()` 也已經在用它。

### R4. 同一個 phase 要讀的多支 ref,合併成一支

實測拆檔的固定成本:**+142 prompt token / 檔**,以及 **output token ×3**(模型會逐檔敘述「Now reading X…」)。

現行 `/feat` 有兩處可直接省:

| Phase | 現況 | 建議 |
|---|---|---|
| Phase 0 | 讀 `sp-overrides` + `scope-tiers` + `feat-phase0-2` 三支 | 合併成一支 `feat-phase0.md` |
| Phase 2 | 讀 `feat-phase0-2` + `review-protocol` 兩支 | 維持(review-protocol 跨 phase 共用,合併會反效果)|

Phase 0 合併約省 284 prompt token + 兩次敘述。金額不大,但**零風險零取捨**。

### R5. 接受「refs 分層對單輪成本是負的」,並把它的價值講清楚

H5 用真實 token 獨立複現了 SC-2 的結論:走到 Phase 3,改版後比改版前貴 **25.4%**。

這不代表改版錯了,而是**它的收益不在總成本**:
- Phase 3 峰值 −11.7%、Phase 8 峰值 −37.1%(見 `sc-verification.md`)
- 「Phase 4 時不必扛著 Phase 8.5 的規則」是注意力效益,不是省錢效益

**但它應該被誠實標成注意力優化,不是成本優化。** 目前 SPEC.md 把它寫在「context 瘦身」標題下,那個命名會誤導下一個人。

---

## 兩條方法論教訓(比數字更耐用)

### 反常是訊號,不是噪音 —— 兩次都靠它救回來

1. **「基準比處置貴」** → E16-E30 全批因權限 artifact 作廢。讀 1 行檔(80,658)比讀 11KB 檔(80,601)貴,物理上不可能。如果只看「數字有出來就收下」,會發表一批完全反了的結論。
2. **「每 token 成本差 2.5 倍」** → 追出 H9,也就是整份研究最大的發現。原本只是想解釋成本欄的雜訊。

### 陽性對照決定了結論能不能用

SC-8 第一輪四個條件全部「skill 仍在清單裡」,看起來就是結論了。但那分不開「機制對 plugin skill 無效」與「headless 模式整個忽略 skillOverrides」。補一個已知會生效的對照(專案 skill),才把後者排除掉。

同樣的邏輯在 H2 救了第二次:如果沒做劑量反應,「關 8 支省 76 token」會被當成線性效應外推,得出「多關幾支就能省上千 token」的錯誤方向。

---

## 未解 / 下一輪

- **`skillOverrides` 移除的到底是什麼**:對專案 skill 有效(模型看不到了)但只省 ~10 token/支,而 plugin 停用省 ~51 token/支。兩者移除的內容不同,但本輪只能黑箱觀察,分不出來。
- **turn 數的真實分布**:H10 證明了 turn 是成本乘數,但沒有量各流程的實際 turn 數分布。需要在真實 /feat /mod run 上取樣。
- **cache TTL 對長流程的影響**:預設 5 分鐘。一個跨 phase 有長間隔(等 user 確認、跑測試)的流程可能反覆掉出 cache。1 小時 TTL 的 write 是 2×,要算損益平衡點。
