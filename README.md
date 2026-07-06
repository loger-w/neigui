# neigui — 台股籌碼 / 選擇權分析 dashboard

以 FinMind / TAIFEX 公開資料為源的台股分析工具,solo 開發。三個分析模式:

- **個股籌碼(equity)**:三大法人買賣超、主力券商分點進出、K 線 + 布林通道、N 日券商視窗、當日走勢 overlay。
- **選擇權(options)**:TXO 大戶未平倉、Max Pain / OI Wall(Call/Put Wall)、PCR 分位、履約價量能階梯 — 內建 T-1 口徑防 look-ahead bias。
- **大盤監控(market)**:全市場 heatmap、產業資金流、騰落 / McClellan 市場寬度、量能排行。

## 技術架構

| 層 | 選型 |
|---|---|
| Backend | FastAPI(Python 3.12)、httpx async、filesystem JSON cache(atomic write + 版本失效)、token-bucket rate limiter、inflight dedup |
| Frontend | React 19 + Vite 6 + Tailwind 4 + Radix primitives、TanStack Query(AbortSignal 全鏈取消)、純函式 SVG renderer(無 chart library) |
| 資料源 | FinMind(主)+ TAIFEX OpenAPI(補);無 DB — state = client + JSON cache |
| 測試 | 480 backend pytest + 585 frontend vitest + 62 Playwright e2e(FAKE fixture 三層架構 + 後端時鐘凍結,CI 零外部依賴、deterministic) |

值得一看的工程細節:API 取消的五環傳導鏈(browser abort → vite proxy → uvicorn → task cancel → inflight dedup refcount)、1.5GB JSON cache 的 GIL stall 對策(chunked JSONL)、Max Pain 回測的 look-ahead bias 修正。各自的 spec 在 `docs/specs/`。

## AI 開發 Harness(本專案的另一半產出)

本專案全程(2026-06-22 起)以**自建的 AI 開發 harness** 交付 — 把 Claude Code 包裝成有工程紀律的生產系統:每個改動有可驗證的完成定義(SC gate + 結構化證據表)、流程有不可繞過的強制層(7 個 hook + git pre-push 防線,流程合規不依賴模型自律)、知識有分層儲存與 GC、流程本身有 issue tracker 並會自我改進(收件匣 + meta-review)。

- **架構總覽與 cheat sheet**:[`docs/harness/README.md`](docs/harness/README.md)
- **完整規格(含量化成果、war stories、誠實邊界)**:[`docs/harness/SPEC.md`](docs/harness/SPEC.md)
- **全部元件鏡像**(6 commands / 7 hooks + 36 tests / 流程 skills / 4 review agent 定義):[`docs/harness/`](docs/harness/)
- **9 個 feature 的全程留痕**(brainstorm → design review JSON → TDD tag → SC 證據):[`.claude/feat/`](.claude/feat/)

## 本機啟動

```bash
# backend(需 .env 提供 FINMIND_TOKEN)
cd backend && python -m uvicorn main:app --reload --port 8000

# frontend(:5173,/api 透過 vite proxy 轉 :8000)
cd frontend && npm install && npm run dev
```

驗證:`cd backend && python -m pytest -q`、`cd frontend && npm test && npm run build`、`cd e2e && npm test`。

## 版本

目前 `v0.22.0` — user-facing changelog 內建於 app(頂部列版本號點開),SemVer pre-1.0 慣例見 `CLAUDE.md` §7。
