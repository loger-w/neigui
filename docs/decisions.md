# 技術決策紀錄

> 來源:2026-06 deep-research(7 個 high-confidence findings,3-vote adversarial verification)的升級路線,原 CLAUDE.md §8。
> 採納項已全部落實(2026-07-06 核實),依「落實後可刪」規則自 CLAUDE.md 移除;不採納表保留於此,**未來有人提議下列做法時先讀不採納理由,別重開已結案的討論**。

## 已採納並落實 ✓(2026-07-06 核實)

| 項目 | 落實證據 |
|---|---|
| P0 TanStack Query 取代手寫 fetch hook | 15 個 hook 全面 `useQuery` 化,`seqRef` 已從 hooks 移除 |
| P1 拿掉 `forwardRef` | repo 內 0 處 |
| P1 `noUncheckedIndexedAccess` | `tsconfig.app.json` 已開 |
| P2 pyright(basic) | 已進 backend dev deps |

(P2 的全域 exception handler 與 eslint useEffect plugin 若未完成,屬持續改進項,不阻塞。)

## 刻意不採納(避免 over-engineering)

| 共識做法 | 不採納理由 |
|---------|----------|
| Frontend feature folder(`features/options/...`,bulletproof-react 風格) | 目前 ~40 個 TS 檔、少數 mode,by-type 結構還夠用。feature folder 是 100+ 檔回本,現在強推會變形式主義 |
| Zustand / Jotai / Redux Toolkit | 所有 state 都在 `App.tsx` 集中管,沒跨組件深度共享。server state 已進 TanStack Query,client state 更少,**完全不需要 store** |
| shadcn/ui CLI init | `components/ui/` 已自己刻齊 button/checkbox/input/skeleton/tabs/date-field,照 shadcn 寫法重整即可 |
| Backend feature-based 重構 | 官方 template + 現況都是 layered,共識本身分歧,不動 |
| RFC 7807 problem details | FastAPI 官方未實作,frontend 已依賴 `{"detail": {"error": "<code>"}}` 格式,改動成本 > 收益 |
| mypy strict | 共識不強;選 pyright 因比 mypy 快、預設 basic 即可,不上 strict |

## 其他已結案決策

- **1.0.0 升級標準**(2026-07-07 自 CLAUDE.md §7 移入):SemVer FAQ 建議「production use 或 stable consumed API」時升 1.0.0;本專案無外部 API consumer,留給 user 自行宣告「日常依賴」的時點,不設自動化判準。
