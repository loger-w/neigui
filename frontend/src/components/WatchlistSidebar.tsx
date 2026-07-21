import { useEffect, useMemo, useState } from "react";
import {
  addStock,
  assignGroup,
  createGroup,
  deleteGroup,
  loadWatchlist,
  removeStock,
  saveWatchlist,
  type Watchlist,
  type WatchlistItem,
} from "../lib/watchlist";

interface Props {
  /** 當前個股("" = 未選)。加入鈕的來源。 */
  currentSymbol: string;
  currentSymbolName: string | null;
  /** 點清單項切換個股 — App 層 handlePick(重置 sibling state)。 */
  onPick: (symbol: string, name: string | null) => void;
  /** true = 手機摺疊區塊(header 下,預設收合);false = 桌面固定 sidebar
   *  (預設展開,可收合成窄軌)。 */
  mobile?: boolean;
}

/** WL-1 (mod/batch-ui-update): equity 自選清單。狀態自持(localStorage
 *  neigui.watchlist.v1),App 只接 onPick 切股。 */
export function WatchlistSidebar({
  currentSymbol,
  currentSymbolName,
  onPick,
  mobile,
}: Props) {
  const [watchlist, setWatchlist] = useState<Watchlist>(loadWatchlist);
  useEffect(() => {
    saveWatchlist(watchlist);
  }, [watchlist]);
  // 桌面預設展開、手機預設收合 — 同一個 open state,初值依 variant。
  const [open, setOpen] = useState<boolean>(!mobile);
  const [groupName, setGroupName] = useState("");

  const alreadyAdded = watchlist.items.some((i) => i.symbol === currentSymbol);
  const ungrouped = useMemo(
    () => watchlist.items.filter((i) => i.groupId === null),
    [watchlist],
  );

  const handleAddCurrent = () => {
    if (!currentSymbol) return;
    setWatchlist((w) => addStock(w, currentSymbol, currentSymbolName));
  };
  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    setWatchlist((w) => createGroup(w, groupName));
    setGroupName("");
  };

  const itemRow = (item: WatchlistItem) => (
    <div
      key={item.symbol}
      data-testid="watchlist-item"
      data-symbol={item.symbol}
      className={`flex items-center gap-1 px-2 py-1 pointer-coarse:py-2 border-b border-line/30 text-xs group/wlitem ${
        item.symbol === currentSymbol ? "bg-accent/[0.06]" : ""
      }`}
    >
      <button
        type="button"
        data-testid="watchlist-item-pick"
        onClick={() => onPick(item.symbol, item.name)}
        title={`切換到 ${item.symbol}${item.name ? ` ${item.name}` : ""}`}
        className="flex-1 min-w-0 flex items-baseline gap-1 text-left cursor-pointer hover:text-accent"
      >
        <span className="shrink-0 tabular-nums text-ink font-medium">
          {item.symbol}
        </span>
        {item.name && (
          <span className="truncate text-ink-muted">{item.name}</span>
        )}
      </button>
      <select
        aria-label={`設定 ${item.symbol} 分組`}
        value={item.groupId ?? ""}
        onChange={(e) =>
          setWatchlist((w) =>
            assignGroup(w, item.symbol, e.target.value === "" ? null : e.target.value),
          )
        }
        className="shrink-0 w-4 opacity-0 group-hover/wlitem:opacity-100 focus:opacity-100 bg-bg border border-line rounded text-2xs text-ink-dim cursor-pointer"
      >
        <option value="">未分組</option>
        {watchlist.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`自清單移除 ${item.symbol}`}
        onClick={() => setWatchlist((w) => removeStock(w, item.symbol))}
        className="shrink-0 text-ink-dim hover:text-bear cursor-pointer leading-none px-0.5 opacity-0 group-hover/wlitem:opacity-100 focus:opacity-100"
      >
        ×
      </button>
    </div>
  );

  const listBody = (
    <>
      <button
        type="button"
        data-testid="watchlist-add-current"
        onClick={handleAddCurrent}
        disabled={!currentSymbol || alreadyAdded}
        className="mx-2 my-1.5 shrink-0 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs border border-line text-ink-muted hover:text-accent hover:border-accent disabled:opacity-50 disabled:cursor-default cursor-pointer rounded"
      >
        {currentSymbol
          ? alreadyAdded
            ? `${currentSymbol} 已在清單`
            : `＋ 加入 ${currentSymbol}`
          : "＋ 加入(先選個股)"}
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-editorial">
        {watchlist.items.length === 0 && (
          <div className="px-2 py-3 text-xs text-ink-dim italic">
            尚無自選股票
          </div>
        )}
        {ungrouped.map(itemRow)}
        {watchlist.groups.map((g) => (
          <div key={g.id} data-testid="watchlist-group-section">
            <div
              data-testid="watchlist-group"
              className="flex items-center gap-1 px-2 pt-2 pb-1 text-2xs text-ink-dim uppercase tracking-wider"
            >
              <span className="flex-1 min-w-0 truncate text-[#f0b429]">
                {g.name}
              </span>
              <button
                type="button"
                aria-label={`刪除分組 ${g.name}`}
                title="刪除分組(股票退回未分組)"
                onClick={() => setWatchlist((w) => deleteGroup(w, g.id))}
                className="shrink-0 text-ink-dim hover:text-bear cursor-pointer leading-none"
              >
                ×
              </button>
            </div>
            {watchlist.items.filter((i) => i.groupId === g.id).map(itemRow)}
          </div>
        ))}
      </div>
      <form
        onSubmit={handleCreateGroup}
        className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-t border-line"
      >
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="新增分組"
          aria-label="新增分組名稱"
          data-testid="watchlist-group-input"
          className="flex-1 min-w-0 h-6 px-1.5 text-xs bg-bg border border-line rounded text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          data-testid="watchlist-create-group"
          disabled={groupName.trim() === ""}
          className="shrink-0 text-xs px-1.5 h-6 border border-line text-ink-dim hover:text-accent hover:border-accent disabled:opacity-50 disabled:cursor-default cursor-pointer rounded"
        >
          建立
        </button>
      </form>
    </>
  );

  if (mobile) {
    return (
      <div data-testid="watchlist-sidebar" className="border-b border-line">
        <button
          type="button"
          aria-label={open ? "收合自選清單" : "展開自選清單"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-2 pointer-coarse:min-h-11 text-sm text-ink-muted hover:text-ink cursor-pointer"
        >
          <span>自選清單</span>
          <span className="text-2xs text-ink-dim tabular-nums">
            {watchlist.items.length}
          </span>
          <span className="ml-auto text-ink-dim">{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div className="max-h-[45vh] flex flex-col border-t border-line/50">
            {listBody}
          </div>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <aside
        data-testid="watchlist-sidebar"
        className="shrink-0 w-8 border-r border-line flex flex-col items-center py-2 bg-bg-deep/20"
      >
        <button
          type="button"
          aria-label="展開自選清單"
          title="展開自選清單"
          onClick={() => setOpen(true)}
          className="text-ink-dim hover:text-accent cursor-pointer px-1 py-2"
        >
          »
        </button>
        <span
          className="mt-2 text-2xs text-ink-dim tracking-widest select-none"
          style={{ writingMode: "vertical-rl" }}
        >
          自選清單
        </span>
      </aside>
    );
  }

  return (
    <aside
      data-testid="watchlist-sidebar"
      className="shrink-0 w-[210px] border-r border-line flex flex-col bg-bg-deep/20 overflow-hidden"
    >
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-line">
        <span className="text-sm text-ink font-medium">自選清單</span>
        <span className="text-2xs text-ink-dim tabular-nums">
          {watchlist.items.length}
        </span>
        <button
          type="button"
          aria-label="收合自選清單"
          title="收合自選清單"
          onClick={() => setOpen(false)}
          className="ml-auto text-ink-dim hover:text-accent cursor-pointer px-1"
        >
          «
        </button>
      </div>
      {listBody}
    </aside>
  );
}
