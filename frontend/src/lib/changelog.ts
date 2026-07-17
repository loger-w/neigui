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

export function totalUpdates(entries: readonly VersionEntry[]): number {
  return entries.reduce((sum, v) => sum + v.changes.length, 0);
}

// SemVer 三段式 X.Y.Z 字典序比較。回傳 a > b。供 changelog.test.ts 在
// 同日多 entry 的情況檢查版本降冪(date `>=` 不足以鎖 SemVer 順序)。
export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

// 最新版本排第一筆(陣列倒序),維護者寫入時手動維護;test 強制驗證 date 單調遞減。
// 版本字串遵循 SemVer 2.0.0 三段式 MAJOR.MINOR.PATCH;pre-1.0 階段 breaking change 也只 bump MINOR
// (per git-cliff zero-preservation 慣例,保留 leading 0 表 API 未穩定)。
export const CHANGELOG: VersionEntry[] = [
  {
    version: "0.34.2",
    date: "2026-07-17",
    changes: [
      {
        kind: "fix",
        scope: "global",
        text: "「重新整理」在資料載入中按下時偶爾沒有生效(拿到的仍是舊資料)— 現在會立即中止載入中的請求並重新抓取最新資料",
      },
    ],
  },
  {
    version: "0.34.1",
    date: "2026-07-17",
    changes: [
      {
        kind: "fix",
        scope: "global",
        text: "線上版切換個股或頁面時,尚未完成的舊資料請求現在會真正中止 — 不再在背景白耗資料額度,新目標的載入不再被拖慢",
      },
    ],
  },
  {
    version: "0.34.0",
    date: "2026-07-16",
    highlights: "個股頁更快更省:主力買賣超改為看多遠、載多遠",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "主力買賣超改為「看多遠、載多遠」:預設載入近半年,拖曳或縮小 K 線看更早的區間時才自動補載,補載中的區段會顯示讀取動畫指示",
      },
      {
        kind: "fix",
        scope: "equity",
        text: "剛開啟一檔個股後馬上切到別檔時更順 — 不再於背景預載完整一年半的主力資料拖慢後續載入",
      },
    ],
  },
  {
    version: "0.33.0",
    date: "2026-07-16",
    highlights: "權證展開列隱波圖全面重做:位階摘要、標的價對照、降波趨勢一眼看懂",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "權證展開列的隱波圖重新設計:上方隱波走勢疊上標的歷史波動率(HV20)與降波趨勢線,下方對照標的收盤走勢,看得出「標的漲但隱波被調降」",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "新增隱波位階摘要:最新買價隱波、自身 60 日位階、同標的其他權證位階、與標的波動率的差距,貴不貴一眼判斷",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "展開列圖表改為隨表格寬度自動放大,不再固定小尺寸",
      },
    ],
  },
  {
    version: "0.32.0",
    date: "2026-07-16",
    highlights: "權證挑選更好用:發行商篩選上線、表頭對齊修正、展開列精簡",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "權證篩選列新增「發行商」下拉,可只看特定發行商(凱基、元大等)的權證",
      },
      {
        kind: "fix",
        scope: "equity",
        text: "權證表的代號、名稱、類型欄表頭改為靠左,與欄位內容對齊一致",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "權證展開列聚焦 IV 走勢,移除單一權證的分點買賣超明細;分點動向請改看「權證分點」頁",
      },
    ],
  },
  {
    version: "0.31.2",
    date: "2026-07-16",
    highlights: "權證 IV 歷史資料更可靠:缺日與不完整的日子會自動補齊",
    changes: [
      {
        kind: "fix",
        scope: "equity",
        text: "權證 IV 歷史修正:上游查詢偶發回空造成的缺日或只剩一半的資料,現在會自動偵測並補齊,IV 走勢與漂移標記更可信",
      },
      {
        kind: "fix",
        scope: "equity",
        text: "伺服器啟動不再對休市日重複掃描,開機後權證資料更快就緒",
      },
    ],
  },
  {
    version: "0.31.1",
    date: "2026-07-15",
    highlights: "權證頁載入大幅加速:每日首次開啟不再久等",
    changes: [
      {
        kind: "fix",
        scope: "equity",
        text: "權證頁每日首次開啟大幅加速 — 資料改在背景預先準備,不再讓首位開啟的人久等",
      },
      {
        kind: "fix",
        scope: "equity",
        text: "權證即時報價載入更快,交易時段開啟也更順",
      },
    ],
  },
  {
    version: "0.31.0",
    date: "2026-07-15",
    highlights: "權證挑選介面大改:欄位自由排列、報價呈現更直覺、精簡低價值資訊",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "權證表新增「欄位」選單:可拖曳調整欄位順序、勾選顯示或隱藏,每個欄位附一句說明;設定會自動記住,重開頁面仍保留",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "委買/委賣改為價格為主、掛單量以小字列在第二行,不再與價格擠成一串",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "篩選列改版:新增「重製篩選」一鍵回到預設,數字條件附 −/+ 調整按鈕並依用途分組",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "介面精簡:移除發行商排行與發行商欄、市場欄、一鍵波段套用與分點買賣超欄(實用度偏低)",
      },
    ],
  },
  {
    version: "0.30.0",
    date: "2026-07-14",
    highlights: "發行商排行更公平:同類權證互比,不再被產品組合拉偏",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "發行商排行改為「同類互比」:每檔權證先與同價位區間、同到期區間的權證比較,再彙總成發行商排名 — 主打深價外或短天期產品的大型發行商不再因產品組合吃虧",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "排行表格改列各發行商在同類比較中的相對位置(數字越低越好),滑鼠懸停可見原始數值",
      },
    ],
  },
  {
    version: "0.29.0",
    date: "2026-07-14",
    highlights: "權證挑選升級:發行商排行、一鍵波段篩選、近到期與近售罄警示",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "權證頁新增「發行商排行」:比較各發行商的隱波穩定度、買賣價差與降波占比(收盤資料推算,展開即看)",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "權證列表每檔標注發行商與評級(前段/中段/後段)",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "新增「波段」一鍵篩選組合(附門檻來源標注),並可依價差比、差槓比、委賣價篩選",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "近到期(出場品質下降)與近售罄(委賣消失)的權證加上警示標記",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "權證列表可手動載入各檔的分點買賣超,和分點分頁共用同一份資料",
      },
    ],
  },
  {
    version: "0.28.0",
    date: "2026-07-14",
    highlights: "個股新增「權證分點」分頁,看哪些分點在買賣這檔股票的權證",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "個股新增「權證分點」分頁:彙整該股全部有成交權證的分點買賣金額,列出淨買超與淨賣超前 15 大分點,點分點可展開它進出的權證明細;附認購/認售成交概況與權證明細表,並標示資料日(分點資料為盤後隔日公布)",
      },
    ],
  },
  {
    version: "0.27.0",
    date: "2026-07-11",
    highlights: "權證分頁可看發行商引波調整軌跡",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "權證表格新增「IV趨勢」欄:標記買賣價反解引波長期遞減或遞增的權證,平穩者不標",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "權證列展開可看近 60 個交易日的買價與賣價引波走勢圖,缺報價日以斷線呈現",
      },
    ],
  },
  {
    version: "0.26.0",
    date: "2026-07-11",
    highlights: "券差頁可查看單一標的",
    changes: [
      {
        kind: "feature",
        scope: "global",
        text: "券差頁新增標的篩選:輸入代號或從當日名單挑選,只看該檔當日券差,可一鍵清除回全表",
      },
    ],
  },
  {
    version: "0.25.0",
    date: "2026-07-11",
    highlights: "個股頁新增「權證」分頁:盤中挑權證",
    changes: [
      {
        kind: "feature",
        scope: "equity",
        text: "個股頁新增「權證」分頁:列出該股全部上市上櫃權證,交易時段自動更新報價,收盤後顯示最後行情",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "權證表格提供估價參考:理論價與估價差(偏貴/合理/偏便宜)、同標的隱含波動率百分位",
      },
      {
        kind: "feature",
        scope: "equity",
        text: "權證可依認購認售、剩餘天數、價內外、估價差等條件篩選,預設以差槓比排序;點列可展開分點買賣超(前一交易日資料)",
      },
    ],
  },
  {
    version: "0.24.0",
    date: "2026-07-11",
    highlights: "新增「券差」頁:當沖券差借券費率每日總覽",
    changes: [
      {
        kind: "feature",
        scope: "global",
        text: "頂部新增「券差」分頁:列出當日上市與上櫃的當沖券差借券費率,依費率高低排序,高費率標色提示,並附本月發生次數",
      },
    ],
  },
  {
    version: "0.23.0",
    date: "2026-07-07",
    highlights: "選擇權頁全面改版:先給結論、再給證據",
    changes: [
      {
        kind: "feature",
        scope: "options",
        text: "新增今日結論列:一句話說明大盤位置(支撐與壓力之間偏哪側、Max Pain 距現價多遠)",
      },
      {
        kind: "feature",
        scope: "options",
        text: "新增區間地圖:每個履約價的未平倉分布一張圖看完,現價、支撐牆、壓力牆、Max Pain 全標在上面,可切換看成交量",
      },
      {
        kind: "feature",
        scope: "options",
        text: "新增籌碼溫度計:外資、前十大交易人、Put/Call 比、小台散戶多空比四格,每格附白話判讀",
      },
      {
        kind: "feature",
        scope: "options",
        text: "新增小台散戶多空比與外資台指期淨部位兩項指標",
      },
      {
        kind: "fix",
        scope: "options",
        text: "OI 牆改只從現價外側找:大漲大跌後不會再把已被穿過的價位標成支撐或壓力",
      },
      {
        kind: "fix",
        scope: "options",
        text: "動態牆改為顯示近 5 日增倉最多的履約價,更貼近「新資金在哪裡佈局」的意義",
      },
      {
        kind: "feature",
        scope: "options",
        text: "統計細節(命中率、歷史分位表、法人明細)收進「進階統計」,點開才顯示;各術語加上白話說明",
      },
    ],
  },
  {
    version: "0.22.1",
    date: "2026-07-07",
    changes: [
      { kind: "fix", scope: "global", text: "服務閒置後首次開啟的等待時間縮短" },
    ],
  },
  {
    version: "0.22.0",
    date: "2026-07-06",
    highlights: "專案更名 neigui",
    changes: [
      { kind: "feature", scope: "global", text: "介面頂部與瀏覽器分頁標題顯示新專案名稱 neigui" },
    ],
  },
  {
    version: "0.21.3",
    date: "2026-07-03",
    highlights: "大盤頁面連線穩定性修復",
    changes: [
      { kind: "fix", scope: "global", text: "大盤頁面在每日資料準備期間不再連線逾時失敗,改為先顯示即時行情、統計區塊載入完成後自動補上" },
      { kind: "fix", scope: "global", text: "多人同時開啟大盤頁時,其中一人離開不再造成其他人載入失敗" },
    ],
  },
  {
    version: "0.21.2",
    date: "2026-07-03",
    highlights: "手機看得到前 15 大買賣超,泡泡圖提示改橫排",
    changes: [
      { kind: "fix", scope: "equity", text: "手機上的籌碼總覽改為整頁捲動,前 15 大買賣超與交易量分點完整看得到" },
      { kind: "fix", scope: "equity", text: "泡泡圖的價位篩選提示改為橫排文字,不用歪頭就能讀" },
    ],
  },
  {
    version: "0.21.1",
    date: "2026-07-03",
    highlights: "泡泡圖加上價位篩選操作提示",
    changes: [
      { kind: "fix", scope: "equity", text: "泡泡圖左側價格軸加上提示文字,告知可以按住拖曳來篩選價位區間" },
      { kind: "fix", scope: "global", text: "版本說明全面改用一般用語,減少專業術語與英文" },
    ],
  },
  {
    version: "0.21.0",
    date: "2026-07-03",
    highlights: "支援手機與小螢幕瀏覽",
    changes: [
      { kind: "feature", scope: "global", text: "支援手機與平板瀏覽,版面自動調整為直向堆疊" },
      { kind: "feature", scope: "global", text: "大螢幕上文字自動放大,更易閱讀" },
      { kind: "feature", scope: "equity", text: "泡泡圖在手機上點選分點即可從底部開啟成交明細" },
    ],
  },
  {
    version: "0.20.2",
    date: "2026-07-03",
    highlights: "資料載入速度再提升",
    changes: [
      { kind: "fix", scope: "equity", text: "首次查看一檔股票時,主力買賣超與完整歷史資料的載入速度再大幅提升" },
    ],
  },
  {
    version: "0.20.1",
    date: "2026-07-03",
    highlights: "主力買賣超首次載入大幅加速",
    changes: [
      { kind: "fix", scope: "equity", text: "首次查看一檔股票時,主力買賣超先載入近期資料快速顯示,較舊區間於背景補齊,等待時間大幅縮短" },
      { kind: "fix", scope: "equity", text: "按重新整理時,主力買賣超保留原有畫面直接更新,不再被載入畫面蓋住" },
    ],
  },
  {
    version: "0.20.0",
    date: "2026-07-02",
    highlights: "籌碼分點與泡泡圖操作改良:全分點篩選、區間過濾、手動輸入、使用說明",
    changes: [
      { kind: "feature", scope: "equity", text: "分點篩選加開「篩選」彈出視窗,可看當日全部分點清單並勾選、搜尋、按淨買賣或名稱排序" },
      { kind: "feature", scope: "equity", text: "泡泡圖按住左側價格軸拖曳選價位區間後,只顯示區間內的成交泡泡" },
      { kind: "feature", scope: "equity", text: "泡泡圖新增「輸入區間」可手動輸入買賣價位下限與上限" },
      { kind: "feature", scope: "equity", text: "泡泡圖右上角新增「?」操作說明,首次使用者可看操作指引" },
      { kind: "feature", scope: "equity", text: "泡泡圖框選價位區間後點選分點,會顯示該分點今日所有價位的成交,原本的區間仍保留作為視覺參考" },
      { kind: "fix", scope: "equity", text: "籌碼買賣超上方的「已選分點」列固定高度,勾選分點後不再產生小幅位移" },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-07-02",
    highlights: "大盤掃描全面改版:市場廣度、族群參與度、資金流向",
    changes: [
      { kind: "feature", scope: "global", text: "大盤掃描新增市場廣度指標與訊號標記" },
      { kind: "feature", scope: "global", text: "大盤掃描新增族群參與度分布圖,可看各族群強弱" },
      { kind: "feature", scope: "global", text: "大盤掃描新增族群資金流向與量能對照表" },
      { kind: "feature", scope: "global", text: "大盤掃描標示已過濾 ETF / 權證 / 處置股" },
      { kind: "feature", scope: "global", text: "原有大盤畫面保留於「經典檢視」區塊" },
    ],
  },
  {
    version: "0.18.2",
    date: "2026-07-02",
    highlights: "大盤掃描大幅加速",
    changes: [
      { kind: "fix", scope: "global", text: "大盤掃描開啟大幅加速" },
      { kind: "fix", scope: "global", text: "大盤掃描重新整理大幅加速" },
      { kind: "fix", scope: "global", text: "大盤資料更新時其他頁面不再卡頓" },
    ],
  },
  {
    version: "0.18.1",
    date: "2026-06-29",
    highlights: "進股票 / 選擇權的載入更穩、重新整理大幅加速",
    changes: [
      { kind: "fix", scope: "equity", text: "進個股時 K 線與籌碼欄的出現順序不再隨機顛倒,K 線一律先出來" },
      { kind: "fix", scope: "equity", text: "個股籌碼欄重複開啟同股大幅加速" },
      { kind: "fix", scope: "options", text: "選擇權頁面重新整理 / 切換交易日大幅加速" },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-06-29",
    highlights: "新增「大盤」掃描頁面 — 一眼看整盤族群熱力圖 + 漲跌幅 / 大量單 / 量比三榜",
    changes: [
      { kind: "feature", scope: "global", text: "新增「大盤」掃描頁面:左側是按產業分類的熱力圖、右側是漲跌幅 / 大量單 / 量比前 30 名切換榜單" },
      { kind: "feature", scope: "global", text: "熱力圖或榜單點任一檔股票直接跳到該檔的個股籌碼分析頁" },
      { kind: "feature", scope: "global", text: "盤中自動每 2-3 秒抓最新整盤資料,收盤後自動暫停更新" },
    ],
  },
  {
    version: "0.17.1",
    date: "2026-06-29",
    highlights: "右側面板顯示外資 / 投信 / 自營商區間加總,K 線下方圖表更乾淨",
    changes: [
      { kind: "feature", scope: "equity", text: "右側面板新增「三大法人」加總列(外資 / 投信 / 自營商),依當前選擇的天數加總,單日也適用" },
      { kind: "fix", scope: "equity", text: "K 線下方的主力 / 外資 / 投信 / 自營商 / 融資融券走勢圖移除金色區間色帶,只保留 K 線本身的範圍標示,避免重複資訊" },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-06-29",
    highlights: "N 日加總範圍在 K 線上看得到,任意天數打字直接設",
    changes: [
      { kind: "feature", scope: "equity", text: "選 1 天以上加總時,K 線與底下各資料區會用淡金色帶標出涵蓋的交易日範圍" },
      { kind: "feature", scope: "equity", text: "頂部新增「過去 N 日」標籤,一眼知道現在看的是幾日加總" },
      { kind: "feature", scope: "equity", text: "天數選擇器右側可直接輸入任意 1-60 整數,Enter 或滑開即套用;預設按鈕仍保留" },
      { kind: "fix", scope: "equity", text: "右側面板左邊不再多畫彩色邊條(改在 K 線上呈現範圍,視覺更直觀)" },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-06-29",
    highlights: "日期切換更快,預設只看當日籌碼,要看區間自己挑",
    changes: [
      { kind: "feature", scope: "equity", text: "預設籌碼期間改為當日,要看更長期間可手動選 1 / 10 / 20 / 30 / 60 日" },
      { kind: "feature", scope: "equity", text: "日期欄左右新增前/後一交易日按鈕,自動跳過週末與非交易日,未來日卡在當日" },
      { kind: "feature", scope: "equity", text: "選到非交易日(週末等)時自動跳到最近的交易日,避免畫面空白" },
      { kind: "feature", scope: "equity", text: "看多日加總籌碼時右側面板左緣顯示彩色邊條,一眼分辨當日或區間加總" },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-06-29",
    highlights: "泡泡圖背景多了當日分時走勢線,看泡泡落點時對齊股價形狀",
    changes: [
      { kind: "feature", scope: "equity", text: "泡泡圖背景新增當日分時走勢線(灰色細線),與泡泡共用價格刻度,可一眼看出泡泡落在當日什麼價位區段" },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-06-29",
    highlights: "版本資訊面板上線,介面頂部視覺更整合",
    changes: [
      { kind: "feature", scope: "global", text: "新增版本資訊面板,點頂部右上的版本號即可瀏覽完整更新紀錄" },
      { kind: "feature", scope: "global", text: "版本紀錄依版本分組,標註亮點、新功能、修正與影響模組(個股 / 選擇權 / 全局)" },
      { kind: "feature", scope: "global", text: "版本號與模式切換整合在頂部同一列,排版更一致" },
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
    highlights: "台指期盤後價含夜盤更穩定,選擇權首次開啟大幅加速",
    changes: [
      { kind: "fix", scope: "options", text: "台指期盤後價包含夜盤段,60 秒自動更新更穩定" },
      { kind: "fix", scope: "options", text: "選擇權首次開啟大幅加速" },
      { kind: "fix", scope: "equity", text: "個股代號啟動初期查不到時自動補抓,不再需手動重整" },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-06-27",
    highlights: "K 線新增布林通道與滾輪 / 框選縮放,分頁切換更順",
    changes: [
      { kind: "feature", scope: "equity", text: "K 線新增布林通道(20 日)" },
      { kind: "feature", scope: "equity", text: "K 線支援滾輪縮放與框選區間放大" },
      { kind: "feature", scope: "global", text: "籌碼與選擇權頁切換更順,資料載入更快" },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-06-26",
    highlights: "TXO 籌碼分析接上真實資料:命中率與統計改用實際數據",
    changes: [
      { kind: "feature", scope: "options", text: "Max Pain / OI 牆 命中率改用真實歷史結算資料計算" },
      { kind: "feature", scope: "options", text: "新增結算價、台指期報酬與外資籌碼的統計,附歷史相關性" },
      { kind: "fix", scope: "options", text: "命中率改用結算前一交易日資料,避免結算當日未平倉收斂造成虛高" },
      { kind: "fix", scope: "options", text: "OI 牆欄位顯示修正,資料缺漏時改用最近可用日期不再空白" },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-06-26",
    highlights: "TXO 籌碼分析首版上線:Max Pain、OI 牆、PCR、三大法人四卡整合面板",
    changes: [
      { kind: "feature", scope: "options", text: "新增 Max Pain 卡:顯示最大痛點履約價與歷史命中率" },
      { kind: "feature", scope: "options", text: "新增 OI 牆卡:Call Wall / Put Wall 位階與歷史命中率" },
      { kind: "feature", scope: "options", text: "新增未平倉 PCR 卡,搭配滾動分位線判讀" },
      { kind: "feature", scope: "options", text: "新增三大法人多空淨倉卡,附與台指期報酬的歷史相關性" },
      { kind: "feature", scope: "options", text: "選擇權頁整合 TXO 籌碼四卡統一面板" },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-06-26",
    highlights: "個股券商面板新增 N 日加總視窗(預設檔位 + 滾輪自訂),首次開啟大幅加速",
    changes: [
      { kind: "feature", scope: "equity", text: "券商面板新增 N 日加總視窗:1 / 10 / 20 / 30 / 60 日預設檔位" },
      { kind: "feature", scope: "equity", text: "N 日範圍可用滾輪或鍵盤自訂任意天數" },
      { kind: "fix", scope: "equity", text: "N 日券商加總首次開啟大幅加速" },
      { kind: "fix", scope: "equity", text: "券商加總視窗修正盤中可能取到未來資料的問題" },
      { kind: "fix", scope: "equity", text: "切換 N 日檔位不再短暫閃出舊資料" },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-06-24",
    highlights: "履約價量能階梯標記 Call / Put Wall、選擇權支援週選、代號搜尋更即時",
    changes: [
      { kind: "feature", scope: "options", text: "履約價量能階梯高亮顯示 Call Wall / Put Wall(最大壓力 / 支撐 履約價)" },
      { kind: "feature", scope: "options", text: "合約選單新增週五到期 TXO 週選" },
      { kind: "feature", scope: "options", text: "合約選單依到期日時序排序,週月選交錯不亂跳" },
      { kind: "feature", scope: "equity", text: "代號搜尋改為本地即時篩選,輸入回饋更快" },
      { kind: "fix", scope: "equity", text: "代號搜尋避免舊查詢結果覆蓋最新輸入" },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-06-24",
    highlights: "選擇權頁重設計:履約價量能階梯 + 大戶淨未平倉 20 日趨勢 + 台指期錨點",
    changes: [
      { kind: "feature", scope: "options", text: "新增履約價量能階梯,完整呈現價內外履約價的未平倉量與成交量分布" },
      { kind: "feature", scope: "options", text: "新增大戶淨未平倉四卡,每卡附 20 日迷你走勢圖" },
      { kind: "feature", scope: "options", text: "選擇權頁顯示台指期現價與漲跌,方便對照目前價位落在哪個履約價附近" },
      { kind: "fix", scope: "options", text: "大戶未平倉資料改逐日抓取,迷你走勢圖呈現真實 20 日序列" },
      { kind: "fix", scope: "options", text: "迷你走勢圖在資料點不足或資料缺漏時顯示更穩健" },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-06-23",
    highlights: "選擇權模式首發:大戶未平倉趨勢與履約價量能雙面板",
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
    highlights: "券商面板拆出買均 / 賣均獨立欄位,泡泡圖成交列表支援價量排序",
    changes: [
      { kind: "feature", scope: "equity", text: "券商面板新增買均 / 賣均獨立欄位,順序統一為 買均 賣均 買張 賣張" },
      { kind: "feature", scope: "equity", text: "泡泡圖成交列表可依價格或數量排序" },
      { kind: "fix", scope: "equity", text: "K 線在資料源暫時故障時改用快取顯示,不再中斷" },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-06-23",
    highlights: "泡泡圖改版:顯示全部券商、大量資料捲動更順、券商搜尋優化",
    changes: [
      { kind: "feature", scope: "equity", text: "泡泡圖成交列表顯示每一筆券商,不再限縮前 200 筆" },
      { kind: "feature", scope: "equity", text: "成交列表大量資料捲動更流暢" },
      { kind: "feature", scope: "equity", text: "券商搜尋改版:保留軸線、隱藏未命中、凸顯所有命中" },
      { kind: "feature", scope: "global", text: "載入提示由純文字改為讀取動畫指示" },
      { kind: "fix", scope: "equity", text: "視窗收合時泡泡圖不再瞬間塌陷" },
      { kind: "fix", scope: "equity", text: "券商搜尋命中不再被前 N 筆截掉而漏顯" },
      { kind: "fix", scope: "equity", text: "主力券商歷史資料缺漏修復" },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-06-22",
    highlights: "個股籌碼面板強化:券商歷史走勢、K 線十字游標、券商搜尋優化、介面元件升級",
    changes: [
      { kind: "feature", scope: "equity", text: "券商分頁新增單一券商歷史買賣張數走勢" },
      { kind: "feature", scope: "equity", text: "K 線新增水平十字游標與右軸即時價格標示" },
      { kind: "feature", scope: "equity", text: "泡泡圖低成交量日仍顯示券商,選中標的以黃色高亮" },
      { kind: "feature", scope: "global", text: "新增專案風格的日期選擇器與勾選元件" },
      { kind: "feature", scope: "equity", text: "籌碼分析面板版面重排,標題與控制項整合至同一行" },
      { kind: "fix", scope: "equity", text: "K 線資訊與標籤,沒滑鼠停留時跟隨選中日期" },
      { kind: "fix", scope: "equity", text: "券商歷史資料更新延遲修正,單一券商歷史以名稱對齊" },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-06-14",
    highlights: "首版上線:個股籌碼總覽(K 線、三大法人、主力券商、泡泡圖)",
    changes: [
      { kind: "feature", scope: "global", text: "專案首版上線:個股籌碼分析工具" },
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
