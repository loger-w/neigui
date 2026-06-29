export type ChangeKind = "feature" | "fix";
export type ChangeScope = "equity" | "options" | "global";

export interface ChangeItem {
  kind: ChangeKind;
  scope: ChangeScope;
  text: string;
}

export interface VersionEntry {
  version: string;
  date: string;
  highlights?: string;
  changes: ChangeItem[];
}

export function deriveCurrentVersion(entries: readonly VersionEntry[]): string {
  return entries[0]?.version ?? "0.0.0";
}

// 最新版本排第一筆(陣列倒序),維護者寫入時手動維護;test 強制驗證 date 單調遞減。
// 版本字串遵循 SemVer 2.0.0 三段式 MAJOR.MINOR.PATCH;pre-1.0 階段 breaking change 也只 bump MINOR
// (per git-cliff zero-preservation 慣例,保留 leading 0 表 API 未穩定)。
export const CHANGELOG: VersionEntry[] = [
  {
    version: "0.14.0",
    date: "2026-06-29",
    highlights: "版本資訊面板上線,top bar 視覺整合 dashboard 主風格",
    changes: [
      { kind: "feature", scope: "global", text: "新增版本資訊面板,點 top bar 的版本 badge 即可瀏覽完整更新紀錄" },
      { kind: "feature", scope: "global", text: "版本紀錄依版本分組,標註亮點、新功能、修正與影響模組(個股 / 選擇權 / 全局)" },
      { kind: "feature", scope: "global", text: "版本 badge 與模式切換整合到統一 top bar,排版更一致" },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-06-29",
    highlights: "代號搜尋鍵盤導航,主力副圖載入不再遮住主圖",
    changes: [
      { kind: "feature", scope: "equity", text: "代號搜尋下拉支援鍵盤導航(↑↓ / Enter / Esc)" },
      { kind: "fix", scope: "equity", text: "主力副圖載入時不再遮住主 K 線" },
      { kind: "fix", scope: "equity", text: "個股切換時主 K 線更快出現,主力資料分階段補上" },
    ],
  },
  {
    version: "0.12.0",
    date: "2026-06-28",
    highlights: "台指期盤後價含夜盤更穩定 + 選擇權冷啟動 27s → 4s",
    changes: [
      { kind: "fix", scope: "options", text: "台指期盤後價包含夜盤段,前端 60 秒輪詢更即時穩定" },
      { kind: "fix", scope: "options", text: "選擇權冷啟動大幅加速(27 秒縮短至 4 秒)" },
      { kind: "fix", scope: "equity", text: "個股代號啟動初期查不到時自動補抓,不再需手動重整" },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-06-27",
    highlights: "K 線 Bollinger Bands 與滾輪 / 框選縮放,分頁切換更順",
    changes: [
      { kind: "feature", scope: "equity", text: "K 線新增 Bollinger Bands(20 日 ±2σ)overlay" },
      { kind: "feature", scope: "equity", text: "K 線支援滾輪縮放與框選區間放大" },
      { kind: "feature", scope: "global", text: "籌碼與選擇權頁切換更順,資料載入更快" },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-06-26",
    highlights: "TXO 籌碼框架接上真實資料:命中率、統計與相關係數改用實況數據",
    changes: [
      { kind: "feature", scope: "options", text: "Max Pain / OI Walls 命中率改用真實歷史結算資料計算" },
      { kind: "feature", scope: "options", text: "新增結算價、台指期報酬與外資籌碼的統計與相關係數呈現" },
      { kind: "fix", scope: "options", text: "命中率改用結算前一交易日資料,避免結算當日 OI 收斂造成虛高" },
      { kind: "fix", scope: "options", text: "OI Walls 欄位顯示修正,資料缺漏時改用最近可用日期不再空白" },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-06-26",
    highlights: "TXO 籌碼框架 MVP1 上線:Max Pain、OI Walls、PCR、三大法人四卡整合面板",
    changes: [
      { kind: "feature", scope: "options", text: "新增 Max Pain 卡:顯示最大痛點 strike 與歷史命中率" },
      { kind: "feature", scope: "options", text: "新增 OI Walls 卡:Call / Put Wall 位階與歷史命中率" },
      { kind: "feature", scope: "options", text: "新增未平倉 PCR 卡,搭配滾動分位線判讀" },
      { kind: "feature", scope: "options", text: "新增三大法人多空淨倉卡,附與台指期報酬的歷史相關性" },
      { kind: "feature", scope: "options", text: "選擇權頁整合 TXO 籌碼四卡統一面板" },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-06-26",
    highlights: "個股券商面板新增 N 日加總視窗(預設檔位 + 滾輪自訂),冷啟動大幅加速",
    changes: [
      { kind: "feature", scope: "equity", text: "券商面板新增 N 日加總視窗:1/10/20/30/60 日預設檔位" },
      { kind: "feature", scope: "equity", text: "N 日範圍可用滾輪或鍵盤自訂任意天數" },
      { kind: "fix", scope: "equity", text: "N 日券商窗冷啟動大幅加速(約 24 秒縮至 0.6 秒)" },
      { kind: "fix", scope: "equity", text: "券商加總視窗修正盤中可能取到未來資料的偏誤" },
      { kind: "fix", scope: "equity", text: "切換 N 日檔位不再短暫閃出舊資料" },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-06-24",
    highlights: "Strike Ladder 標記 Call/Put Wall、選擇權支援週選、代號搜尋更即時",
    changes: [
      { kind: "feature", scope: "options", text: "Strike Ladder 高亮顯示 Call Wall / Put Wall(最大壓力 / 支撐 strike)" },
      { kind: "feature", scope: "options", text: "合約選單新增週五到期 TXO 週選" },
      { kind: "feature", scope: "options", text: "合約選單依到期日時序排序,週月選交錯不亂跳" },
      { kind: "feature", scope: "equity", text: "代號搜尋改為本地即時過濾,輸入回饋更快" },
      { kind: "fix", scope: "equity", text: "代號搜尋避免舊查詢結果覆蓋最新輸入" },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-06-24",
    highlights: "選擇權頁重設計:履約價量能階梯 + 大戶 NET 20 日趨勢 + 台指期錨點",
    changes: [
      { kind: "feature", scope: "options", text: "新增履約價量能階梯,完整呈現價內外履約價 OI 與量能分布" },
      { kind: "feature", scope: "options", text: "新增大戶 NET OI 四卡,每卡附 20 日 sparkline 趨勢" },
      { kind: "feature", scope: "options", text: "選擇權頁顯示台指期現價與漲跌,作為履約價對齊錨點" },
      { kind: "fix", scope: "options", text: "大戶 OI 改逐日抓取,sparkline 呈現真實 20 日序列" },
      { kind: "fix", scope: "options", text: "Sparkline 在資料點不足或資料缺漏時顯示更穩健" },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-06-23",
    highlights: "選擇權模式首發:大戶 OI 趨勢與履約價量能雙面板",
    changes: [
      { kind: "feature", scope: "global", text: "新增「選擇權」模式,頂部可一鍵切換個股 / 選擇權" },
      { kind: "feature", scope: "options", text: "選擇權新增三大法人未平倉淨額趨勢面板" },
      { kind: "feature", scope: "options", text: "選擇權新增履約價量能分布面板" },
      { kind: "feature", scope: "options", text: "選擇權合約選單支援多週多月,含日期與重新整理" },
      { kind: "feature", scope: "options", text: "非交易日自動顯示提示,避免誤判為空資料" },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-06-23",
    highlights: "券商面板拆出買均 / 賣均獨立欄位,泡泡圖 trade list 支援價量排序",
    changes: [
      { kind: "feature", scope: "equity", text: "券商面板新增買均 / 賣均獨立欄位,順序統一為 買均 賣均 買張 賣張" },
      { kind: "feature", scope: "equity", text: "泡泡圖 trade list 可依價格或數量排序" },
      { kind: "fix", scope: "equity", text: "K 線在資料源暫時故障時改用快取顯示,不再中斷" },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-06-23",
    highlights: "泡泡圖改版:顯示全部券商 + 虛擬化捲動 + 券商搜尋優化",
    changes: [
      { kind: "feature", scope: "equity", text: "泡泡圖 trade list 顯示每一筆券商,不再限縮 top 200" },
      { kind: "feature", scope: "equity", text: "trade list 虛擬化,大量券商列捲動流暢" },
      { kind: "feature", scope: "equity", text: "券商搜尋改版:保留軸線、隱藏未命中、凸顯所有命中" },
      { kind: "feature", scope: "global", text: "載入提示由純文字改為 spinner 與骨架動畫" },
      { kind: "fix", scope: "equity", text: "視窗收合時泡泡圖不再瞬間塌陷" },
      { kind: "fix", scope: "equity", text: "券商搜尋命中不再被 top-N 截掉而漏顯" },
      { kind: "fix", scope: "equity", text: "主力券商歷史資料缺漏修復" },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-06-22",
    highlights: "個股籌碼面板強化:券商歷史走勢、K 線 crosshair、bubble filter UX、UI 元件升級",
    changes: [
      { kind: "feature", scope: "equity", text: "券商分頁新增單一券商歷史買賣張數走勢" },
      { kind: "feature", scope: "equity", text: "K 線新增水平 price crosshair 與右軸即時價格標示" },
      { kind: "feature", scope: "equity", text: "泡泡圖低成交量日仍顯示券商,選中標的以黃色高亮" },
      { kind: "feature", scope: "global", text: "新增專案風格 DateField 日期選擇器與 Checkbox 元件" },
      { kind: "feature", scope: "equity", text: "籌碼分析面板版面重排,標題與控制項整合至同一行" },
      { kind: "fix", scope: "equity", text: "K 線 OHLCV 與標籤在無 hover 時遵循選中日期" },
      { kind: "fix", scope: "equity", text: "券商歷史資料更新延遲修正,單一券商歷史以名稱對齊" },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-06-14",
    highlights: "MVP 首版:個股籌碼總覽端到端(K 線、三大法人、主力券商、泡泡圖)",
    changes: [
      { kind: "feature", scope: "global", text: "專案首版上線:個股籌碼分析 dashboard" },
      { kind: "feature", scope: "equity", text: "新增個股 K 線圖,呈現日線歷史走勢" },
      { kind: "feature", scope: "equity", text: "新增三大法人買賣超柱狀圖" },
      { kind: "feature", scope: "equity", text: "新增主力券商分點進出明細" },
      { kind: "feature", scope: "equity", text: "新增籌碼泡泡圖,視覺化買賣超分布" },
      { kind: "feature", scope: "equity", text: "新增個股代碼與名稱搜尋" },
    ],
  },
];

export const CURRENT_VERSION: string = deriveCurrentVersion(CHANGELOG);

export const DATA_SOURCES = ["FinMind"] as const;
