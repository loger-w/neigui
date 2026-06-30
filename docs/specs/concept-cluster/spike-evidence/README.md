# Concept Cluster — Spike Evidence

本 dir 收 spec V0.0 → V0.2 演化的所有實驗檔案。下個 session 動工前讀 spec.md / plan.md;若要重新驗證 V0.2 量化結論,看本 dir。

## 檔案索引

### 兩個 single-industry spike(V0 / V0.1 sample)
- `concept-cluster-spike-pcb.md` — PCB 22 檔(+ user 補 8046 / 1303),異質分層 case;結論驅動 V0 → V0.1
- `concept-cluster-spike-mlcc.md` — MLCC 26 檔,同質叢 case;結論驅動 V0.1 自適應 threshold + source quality
- `pcb_cluster_spike.py` / `mlcc_cluster_spike.py` — 可重 reproduce 上面 .md 結論的 throw-away script
- `pcb_cluster_result.json` / `mlcc_cluster_result.json` — script 輸出(corr matrix + cluster 結果)

### 6-industry FinMind IndustryChain probe(V0.2 sample)
- `probe_industry_chain.py` — 對 50+ 已知股票 probe FinMind `TaiwanStockIndustryChain` 的 (industry, sub_industry) tag;**重大發現** sub_industry 細分(電容/電感/電阻 / IC 載板/CCL/玻纖) → spec §5.2 改寫
- `industry_probe_v2.py` — 跑 6 產業(PCB / Passive / Semiconductor / Optical_Comm / EV / AI)的 250-day daily-return corr matrix + per-industry sub_industry group
- `industry_probe_v2.json` — 上面 script 輸出(852KB)— **V0.2 spec §0.6 對照表的 source of truth**
- `industry_analysis_workflow.js` — Workflow tool script,跑 6 analyze + 1 synthesize + 3 adversarial verify 三 phase;V0.2 的 critic missed edge case(KY / ETF / 集團股 / 傳產 scope)源於此

### 不在 dir 內的(可重 fetch)
- `industry_chain_full.json`(scratchpad,748 KB,FinMind dataset cache,sponsor token 重 fetch 即可)

## 重 reproduce 方式

```bash
cd backend
export FINMIND_TOKEN=...  # 從 backend/.env

# PCB / MLCC spike
PYTHONIOENCODING=utf-8 python ../docs/specs/concept-cluster/spike-evidence/pcb_cluster_spike.py
PYTHONIOENCODING=utf-8 python ../docs/specs/concept-cluster/spike-evidence/mlcc_cluster_spike.py

# 6-industry probe(會佔 5-10 分鐘 + ~1MB FinMind quota)
PYTHONIOENCODING=utf-8 python ../docs/specs/concept-cluster/spike-evidence/industry_probe_v2.py
```

## V0.2 核心數字(快查)

| 產業 | N | union corr | structure | source |
|------|---|----------|----------|--------|
| PCB | 89 | 0.315 | heterogeneous_tiered | industry_probe_v2.json |
| Passive | 53 | 0.339 | heterogeneous_tiered | 同上 |
| Semiconductor | 89 | 0.271 | heterogeneous_tiered | 同上 |
| Optical_Comm | 49 | 0.240 | heterogeneous_tiered | 同上 |
| EV | 74 | 0.333 | heterogeneous_tiered | 同上 |
| AI | 58 | 0.205 | **fragmented_basket** | 同上 |

3 critic verdict: 2 accept_with_caveats / 1 major_rework_needed,主要警告 **scope 偏電子鏈,傳產(航運/金融/食品/水泥/觀光)未驗 → P9 必跑**。
