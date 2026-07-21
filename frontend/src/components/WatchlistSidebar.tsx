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

/** SC-1a:桌面 sidebar 寬度(可拖曳調整),localStorage 持久化。 */
export const WATCHLIST_WIDTH_KEY = "neigui.watchlist.width";
const WIDTH_MIN = 180;
const WIDTH_MAX = 320;
const WIDTH_DEFAULT = 210;

function readStoredWidth(): number {
  const raw = localStorage.getItem(WATCHLIST_WIDTH_KEY);
  if (raw === null) return WIDTH_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < WIDTH_MIN || n > WIDTH_MAX) return WIDTH_DEFAULT;
  return Math.round(n);
}

/** WL-1 (mod/batch-ui-update): equity 自選清單。狀態自持(localStorage
 *  neigui.watchlist.v1),App 只接 onPick 切股。
 *  SC-1(mod/batch-ui-polish):分組建立/刪除集中「管理分組」面板;歸組改
 *  每項可見選單鈕;標頭不顯數量;桌面可拖曳調寬。 */
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
  const [manageOpen, setManageOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  // 歸組選單:同時最多一個開啟(key = symbol)。
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(readStoredWidth);
  useEffect(() => {
    localStorage.setItem(WATCHLIST_WIDTH_KEY, String(width));
  }, [width]);

  const alreadyAdded = watchlist.items.some((i) => i.symbol === currentSymbol);
  const ungrouped = useMemo(
    () => watchlist.items.filter((i) => i.groupId === null),
    [watchlist],
  );

  const handleAddCurrent = (groupId: string | null) => {
    if (!currentSymbol) return;
    setWatchlist((w) => addStock(w, currentSymbol, currentSymbolName, groupId));
  };
  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    setWatchlist((w) => createGroup(w, groupName));
    setGroupName("");
  };
  const handleAssign = (symbol: string, groupId: string | null) => {
    setWatchlist((w) => assignGroup(w, symbol, groupId));
    setMenuFor(null);
  };

  // SC-1a:拖曳調寬(樣板 = App.tsx chip panel resize)。sidebar 左錨定,
  // 往右拖 = 加寬。
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(
        WIDTH_MIN,
        Math.min(WIDTH_MAX, startW + (ev.clientX - startX)),
      );
      setWidth(Math.round(next));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 16 : -16;
      setWidth((w) => Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, w + delta)));
    }
  };

  const itemRow = (item: WatchlistItem) => (
    <div
      key={item.symbol}
      data-testid="watchlist-item"
      data-symbol={item.symbol}
      className={`relative flex items-center gap-1 px-2 py-1 pointer-coarse:py-2 border-b border-line/30 text-xs group/wlitem ${
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
      {/* SC-1d:可見的歸組選單鈕(取代 hover 才浮現的 w-4 select) */}
      <button
        type="button"
        aria-label={`設定 ${item.symbol} 分組`}
        aria-expanded={menuFor === item.symbol}
        title="設定分組"
        onClick={() => setMenuFor((cur) => (cur === item.symbol ? null : item.symbol))}
        className={`shrink-0 p-0.5 cursor-pointer ${
          menuFor === item.symbol
            ? "text-accent"
            : "text-ink-dim/60 hover:text-accent"
        }`}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3">
          <path
            d="M1.5 4.5a1 1 0 0 1 1-1h3l1.5 1.8h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1z"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label={`自清單移除 ${item.symbol}`}
        onClick={() => setWatchlist((w) => removeStock(w, item.symbol))}
        className="shrink-0 text-ink-dim hover:text-bear cursor-pointer leading-none px-0.5 opacity-0 group-hover/wlitem:opacity-100 focus:opacity-100"
      >
        ×
      </button>
      {menuFor === item.symbol && (
        <>
          {/* 透明 backdrop:點外側關閉 */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setMenuFor(null)}
          />
          <div
            data-testid="watchlist-assign-menu"
            role="menu"
            className="absolute right-1 top-full z-50 min-w-28 py-0.5 bg-bg-deep border border-line-strong rounded shadow-lg"
          >
            {[{ id: null as string | null, name: "未分組" }, ...watchlist.groups].map(
              (g) => {
                const active = item.groupId === g.id;
                return (
                  <button
                    key={g.id ?? "__none"}
                    type="button"
                    role="menuitem"
                    onClick={() => handleAssign(item.symbol, g.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs cursor-pointer hover:bg-line-strong/20 ${
                      active ? "text-[#f0b429]" : "text-ink-muted"
                    }`}
                  >
                    <span className="w-3 shrink-0">{active ? "✓" : ""}</span>
                    <span className="truncate">{g.name}</span>
                  </button>
                );
              },
            )}
          </div>
        </>
      )}
    </div>
  );

  // SC-1b:群組快選 — 有分組時「加入」鈕旁多一顆選單鈕,直接加入指定分組。
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const canAdd = !!currentSymbol && !alreadyAdded;

  const listBody = (
    <>
      <div className="relative mx-2 my-1.5 shrink-0 flex items-stretch">
        <button
          type="button"
          data-testid="watchlist-add-current"
          onClick={() => handleAddCurrent(null)}
          disabled={!canAdd}
          className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs border border-line text-ink-muted hover:text-accent hover:border-accent disabled:opacity-50 disabled:cursor-default cursor-pointer ${
            watchlist.groups.length > 0 ? "rounded-l border-r-0" : "rounded"
          }`}
        >
          {currentSymbol
            ? alreadyAdded
              ? `${currentSymbol} 已在清單`
              : `＋ 加入 ${currentSymbol}`
            : "＋ 加入(先選個股)"}
        </button>
        {watchlist.groups.length > 0 && (
          <button
            type="button"
            data-testid="watchlist-add-to-group"
            aria-label="加入到分組"
            aria-expanded={addMenuOpen}
            disabled={!canAdd}
            onClick={() => setAddMenuOpen((o) => !o)}
            className="shrink-0 px-1.5 text-xs border border-line rounded-r text-ink-dim hover:text-accent hover:border-accent disabled:opacity-50 disabled:cursor-default cursor-pointer"
          >
            ▾
          </button>
        )}
        {addMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden="true"
              onClick={() => setAddMenuOpen(false)}
            />
            <div
              data-testid="watchlist-add-menu"
              role="menu"
              className="absolute right-0 top-full z-50 min-w-28 py-0.5 bg-bg-deep border border-line-strong rounded shadow-lg"
            >
              {watchlist.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleAddCurrent(g.id);
                    setAddMenuOpen(false);
                  }}
                  className="w-full px-2 py-1 text-left text-xs text-ink-muted cursor-pointer hover:bg-line-strong/20 hover:text-accent"
                >
                  加入到「{g.name}」
                </button>
              ))}
            </div>
          </>
        )}
      </div>
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
              className="px-2 pt-2 pb-1 text-2xs uppercase tracking-wider"
            >
              <span className="block truncate text-[#f0b429]">{g.name}</span>
            </div>
            {watchlist.items.filter((i) => i.groupId === g.id).map(itemRow)}
          </div>
        ))}
      </div>
      {/* SC-1c:分組建立/刪除集中管理面板(標頭「管理」開關) */}
      {manageOpen && (
        <div
          data-testid="watchlist-manage-panel"
          className="shrink-0 border-t border-line px-2 py-1.5 flex flex-col gap-1"
        >
          <form onSubmit={handleCreateGroup} className="flex items-center gap-1">
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
          {watchlist.groups.length === 0 ? (
            <div className="text-2xs text-ink-dim italic px-0.5">尚無分組</div>
          ) : (
            watchlist.groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-1 px-0.5 text-xs text-ink-muted"
              >
                <span className="flex-1 min-w-0 truncate">{g.name}</span>
                <span className="shrink-0 text-2xs text-ink-dim tabular-nums">
                  {watchlist.items.filter((i) => i.groupId === g.id).length}
                </span>
                <button
                  type="button"
                  aria-label={`刪除分組 ${g.name}`}
                  title="刪除分組(股票退回未分組)"
                  onClick={() => setWatchlist((w) => deleteGroup(w, g.id))}
                  className="shrink-0 text-ink-dim hover:text-bear cursor-pointer leading-none px-0.5"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );

  const manageToggle = (
    <button
      type="button"
      aria-label="管理分組"
      aria-expanded={manageOpen}
      title="管理分組"
      onClick={() => setManageOpen((o) => !o)}
      className={`shrink-0 text-2xs px-1.5 py-0.5 border rounded cursor-pointer ${
        manageOpen
          ? "text-accent border-accent"
          : "text-ink-dim border-line hover:text-accent hover:border-accent"
      }`}
    >
      管理
    </button>
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
          <span className="ml-auto text-ink-dim">{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div className="max-h-[45vh] flex flex-col border-t border-line/50">
            <div className="shrink-0 flex justify-end px-2 pt-1.5">
              {manageToggle}
            </div>
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
      className="relative shrink-0 border-r border-line flex flex-col bg-bg-deep/20 overflow-hidden"
      style={{ width }}
    >
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-line">
        <span className="text-sm text-ink font-medium">自選清單</span>
        <span className="ml-auto inline-flex items-center gap-1">
          {manageToggle}
          <button
            type="button"
            aria-label="收合自選清單"
            title="收合自選清單"
            onClick={() => setOpen(false)}
            className="text-ink-dim hover:text-accent cursor-pointer px-1"
          >
            «
          </button>
        </span>
      </div>
      {listBody}
      {/* SC-1a:右緣拖曳把手(180–320px clamp,localStorage 持久化) */}
      <div
        data-testid="watchlist-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="調整自選清單寬度"
        aria-valuenow={width}
        aria-valuemin={WIDTH_MIN}
        aria-valuemax={WIDTH_MAX}
        tabIndex={0}
        onMouseDown={handleResizeMouseDown}
        onKeyDown={handleResizeKeyDown}
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
      />
    </aside>
  );
}
