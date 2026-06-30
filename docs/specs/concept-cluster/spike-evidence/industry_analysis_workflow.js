export const meta = {
  name: 'industry-chain-analysis',
  description: 'Analyze 6-industry FinMind IndustryChain probe → spec V0.2 design recommendation',
  phases: [
    { title: 'Analyze', detail: '6 industries in parallel: business-driven (sub_industry) vs data-driven (corr) cluster overlap' },
    { title: 'Synthesize', detail: 'Merge 6 analyses → spec V0.2 design recommendation' },
    { title: 'Verify', detail: '3 adversarial critiques of synthesis' },
  ],
}

const PROBE_JSON = 'C:/Users/USER/AppData/Local/Temp/claude/C--side-project-trash-cmoney/11c99f66-762c-4eaf-bcf8-955486348d78/scratchpad/industry_probe_v2.json'
const SCRATCHPAD = 'C:/Users/USER/AppData/Local/Temp/claude/C--side-project-trash-cmoney/11c99f66-762c-4eaf-bcf8-955486348d78/scratchpad'

const INDUSTRIES = [
  { key: 'PCB', cn: '印刷電路板' },
  { key: 'Passive', cn: '被動元件' },
  { key: 'Semiconductor', cn: '半導體' },
  { key: 'Optical_Comm', cn: '通信網路-光通訊' },
  { key: 'EV', cn: '電動車輛' },
  { key: 'AI', cn: '人工智慧' },
]

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['industry', 'valid_universe', 'sub_industry_quality', 'cluster_structure', 'mismatch_cases', 'recommendation'],
  properties: {
    industry: { type: 'string' },
    valid_universe: { type: 'integer' },
    sub_industry_quality: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sub_name', 'member_count', 'inner_avg_corr', 'verdict'],
        properties: {
          sub_name: { type: 'string' },
          member_count: { type: 'integer' },
          inner_avg_corr: { type: 'number' },
          verdict: { type: 'string', enum: ['tight', 'moderate', 'loose', 'too_small'] },
        },
      },
    },
    cluster_structure: {
      type: 'object',
      required: ['union_inner_corr', 'structure_type', 'strong_pairs_above_065'],
      properties: {
        union_inner_corr: { type: 'number' },
        structure_type: { type: 'string', enum: ['heterogeneous_tiered', 'homogeneous_cluster', 'transitional'] },
        strong_pairs_above_065: { type: 'integer' },
      },
    },
    mismatch_cases: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        required: ['stock_id', 'stock_name', 'finmind_sub', 'actual_high_corr_with', 'note'],
        properties: {
          stock_id: { type: 'string' },
          stock_name: { type: 'string' },
          finmind_sub: { type: 'string' },
          actual_high_corr_with: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    recommendation: {
      type: 'object',
      required: ['use_finmind_as_l1b', 'finmind_subdivides_enough', 'need_external_supplement', 'verdict_text'],
      properties: {
        use_finmind_as_l1b: { type: 'boolean' },
        finmind_subdivides_enough: { type: 'boolean' },
        need_external_supplement: { type: 'boolean' },
        verdict_text: { type: 'string' },
      },
    },
  },
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  required: ['headline_findings', 'industry_comparison_md', 'spec_v02_changes_md', 'when_finmind_enough', 'when_need_supplement', 'open_questions'],
  properties: {
    headline_findings: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    industry_comparison_md: { type: 'string', description: '6 industries 對照 markdown table' },
    spec_v02_changes_md: { type: 'string', description: '具體要改 spec.md / plan.md 哪幾段 + 新內容' },
    when_finmind_enough: { type: 'string' },
    when_need_supplement: { type: 'string' },
    open_questions: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['critique_summary', 'biggest_overgeneralization', 'missed_edge_case', 'verdict'],
  properties: {
    critique_summary: { type: 'string' },
    biggest_overgeneralization: { type: 'string' },
    missed_edge_case: { type: 'string' },
    verdict: { type: 'string', enum: ['accept_as_is', 'accept_with_caveats', 'major_rework_needed'] },
  },
}

// ----- PHASE 1: Analyze (6 in parallel) -----
phase('Analyze')
const analyses = await parallel(
  INDUSTRIES.map(ind => () =>
    agent(
      `你是 trash-cmoney 概念股 cluster spec 設計顧問。任務:用 FinMind TaiwanStockIndustryChain probe 結果分析「${ind.cn} (${ind.key})」這個產業,評估「業務分群 (sub_industry)」對「資料分群 (correlation)」的契合度。

## 資料

probe JSON 在: ${PROBE_JSON}
要讀的子節點: industries.${ind.key}

shape:
- valid_universe_size: int(有效股票數)
- trading_days: int
- stocks: { stock_id: { name, sub_industries: [list of sub_industry tags] } }
- sub_groups: { sub_industry_name: [stock_id list] }  (依 FinMind 分群,可能多 tag overlap)
- correlation_matrix: { stock_id: { other_stock_id: corr_value } }

## 取資料(Bash 一次,不要重 Read 整個 JSON):

\`\`\`bash
PYTHONIOENCODING=utf-8 python -c "
import json
d = json.load(open(r'${PROBE_JSON}', encoding='utf-8'))['industries']['${ind.key}']
print(json.dumps(d, ensure_ascii=False, indent=2)[:60000])
" > ${SCRATCHPAD}/_${ind.key}_slice.json
\`\`\`

然後讀 slice 檔。如果 60000 chars 不夠,你可以分批 query 用 jq 或更精準 python script 拿 sub-tree。

## 分析任務

1. **sub_industry_quality**:對每個 sub_group(member >= 2 才算),算 inner avg corr(該 group 內 N*(N-1)/2 個 pair 的 corr 平均)。判定:
   - tight: inner_avg >= 0.6
   - moderate: 0.45-0.6
   - loose: 0.3-0.45
   - too_small: < 2 members

2. **cluster_structure**:
   - union_inner_corr: 全 valid_universe 所有 pair 平均 corr
   - structure_type: 用 spec V0.1 §5.10 邏輯判定 heterogeneous_tiered / homogeneous_cluster / transitional
   - strong_pairs_above_065: 全 corr matrix 中 corr > 0.65 的 pair 數

3. **mismatch_cases**(最多 10 條):找「股票 X 被 FinMind tag 為 sub_A,但它跟其他 sub 的股票 corr 更高」的 case。例:某檔在 sub_A,但 top-3 corr partner 都在 sub_B。對應的 note 寫一句「為什麼可能 mismatch」(集團股業務跨類 / FinMind tag 過細 / etc.)。

4. **recommendation**:
   - use_finmind_as_l1b: 整體判斷 FinMind sub_industry 是否可作 L1b 主來源
   - finmind_subdivides_enough: 細分粒度是否夠(例 PCB「硬板、軟板、IC載板製造」全擠一個 sub 算不夠)
   - need_external_supplement: 是否需要外部來源補(MoneyDJ / Goodinfo / domain knowledge)
   - verdict_text: 2-3 句總結

## 約束

- 只用 probe JSON 內資料,不要自己連 FinMind
- 不要 Read 整個 PROBE_JSON(太大,用 Bash slice)
- 結論基於量化,不要 hand-wave
- mismatch_cases 要列具體股號,不要泛泛而論
- verdict 要誠實,FinMind 不夠細就講不夠細`,
      { schema: ANALYSIS_SCHEMA, label: `analyze:${ind.key}`, phase: 'Analyze' }
    )
  )
)

const validAnalyses = analyses.filter(Boolean)
log(`Analyses done: ${validAnalyses.length}/6 industries`)

// ----- PHASE 2: Synthesize -----
phase('Synthesize')
const synthesis = await agent(
  `你是 trash-cmoney concept-cluster spec V0.2 設計者。彙整以下 6 個產業的分析,產出 spec V0.2 修訂建議。

## 6 industries 分析結果(JSON)

${JSON.stringify(validAnalyses, null, 2)}

## Spec V0.1 現況(要修訂的目標)

- L1b 目前設計用 industry_category(32 大類)
- 已 sync MLCC 加自適應 corr threshold / source quality score / L1c 二次篩選 / cluster 結構類型 4 個 layer
- 完整 spec 在 C:/side-project/trash-cmoney/docs/specs/concept-cluster/spec.md

## 任務

1. **headline_findings**:6 條最重要發現(每條 1 句)
2. **industry_comparison_md**:6 產業對照 markdown table(欄位:產業 / 有效 universe / union inner corr / structure type / sub_industry 細分夠不夠 / 需不需要外部補 / 一句 verdict)
3. **spec_v02_changes_md**:具體要改 spec.md / plan.md 哪幾段(指明 §N 或 P N)+ 新內容
4. **when_finmind_enough**:什麼情況下 FinMind sub_industry 已夠當 L1b
5. **when_need_supplement**:什麼情況下要外部補
6. **open_questions**:還沒答的問題(<=5 條)

## 約束

- 引用具體股號 + 數字 example
- spec_v02_changes 要 actionable(改哪段、改成什麼)
- 不要為了「換 dataset」而 hard-cut industry_category,要評估 backward-compat
- 誠實標 caveat`,
  { schema: SYNTHESIS_SCHEMA, label: 'synthesize', phase: 'Synthesize' }
)

// ----- PHASE 3: Verify (3 adversarial) -----
phase('Verify')
const critiques = await parallel(
  ['skeptic_a', 'skeptic_b', 'skeptic_c'].map((sk, i) => () =>
    agent(
      `你是 spec V0.2 的 adversarial 評審 (skeptic ${sk})。批判性審查以下 V0.2 建議,**預設懷疑**。找出至少 1 個具體弱點。

## V0.2 建議

${JSON.stringify(synthesis, null, 2)}

## 6 industries 原始分析

${JSON.stringify(validAnalyses.map(a => ({industry: a.industry, recommendation: a.recommendation, mismatch_count: a.mismatch_cases?.length})), null, 2)}

## 批判角度(挑 1-2 個聚焦)

- **過度一般化**:6 個 sample 推到全部產業是否合理?有沒有 cherry-pick?
- **錯失 edge case**:KY 股 / ETF / 被併購股 / 跨產業集團股 / 新興產業沒對映 的處理?
- **執行性**:spec_v02_changes 是否真能落地?是否撞既有 cache pattern / API contract?
- **反身性盲點**:整套設計預設「business-driven > data-driven」是否本身有 bias?

## Output

- critique_summary: 1-2 句總批
- biggest_overgeneralization: 具體寫哪個 claim 是 over-reach
- missed_edge_case: 具體 edge case
- verdict: accept_as_is / accept_with_caveats / major_rework_needed`,
      { schema: CRITIQUE_SCHEMA, label: sk, phase: 'Verify' }
    )
  )
)

const validCritiques = critiques.filter(Boolean)

// ----- Final output -----
return {
  analyses: validAnalyses,
  synthesis,
  critiques: validCritiques,
  meta: {
    industries_analyzed: validAnalyses.length,
    critiques_received: validCritiques.length,
  },
}
