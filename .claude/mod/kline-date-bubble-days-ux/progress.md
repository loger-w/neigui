# progress ledger — plan: .claude/mod/kline-date-bubble-days-ux/change-spec.md

| 包 | 內容 | commits | review | 狀態 |
|---|---|---|---|---|
| A+C | ChipBubbleView 三鈕常駐 disabled(🔴)+ 連續天數標籤(🟢) | 60ad6bc..ccf0319(4) | 待包後 review(併波尾) | done — vitest 105 passed |
| B+D | ChipKlineChart 高度配平(🔴)+ DateAxisSvg(🟢) | 949268b..0cec5d0(4) | 待波尾 review | done — 99 passed |
| E | dayMarks:hook / App / daymarks svg / bubble svg / view(🟢) | f7c5dc5, a777f35 | 待波尾 review | done — 226 passed |
| e2e | E46 新增 / E38 E43 追加(main session,test-only) | | | 進行中;E43 載入期取樣抓到頂欄 refresh 鈕換行 42px → 包 F |
| F | App refresh spinner 插槽常駐 + 連續天數 nowrap(🔴,Phase 6 real-env finding) | 266fa39, 5d0422c | 併入自評 | done |
| e2e | E46 / E43 / E38(8bddf33)+ fix 波後調整 | 8bddf33 + 後續 | — | e2e 71 passed |
| review fix 波 | F1-F10(code-review-round-1.json) | 4cb1dd3(🔵), 06e79e3(🔴) | 自評 round-1 全處置 | done — vitest 1188 / build / e2e 綠 |

- self_review_head(自評收斂 HEAD):fb4cb854fa7dde7e1e9fe928cc33b59284ad8dac
