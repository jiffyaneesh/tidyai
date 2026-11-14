import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical, MoreHorizontal, Pin, PinOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { pageShell } from "@/lib/page-shell";
import {
  emptyChatOrder,
  loadChatOrder,
  moveChat,
  moveChatToIndex,
  reconcileChatOrder,
  saveChatOrder,
  sortChats,
  togglePin,
  type ChatOrderPrefs,
} from "@/lib/chat-order";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { renameChat, type Chat } from "../api";

type Props = {
  projectId: string;
  /** Full subject chat list — never a filtered subset (order prefs need all ids). */
  chats: Chat[];
  activeChatId: string | null;
  /** Lowercased filter; empty = show all. Reorder disabled while filtering. */
  query?: string;
  busy?: boolean;
  onSelect: (chatId: string) => void;
  onCreate: () => void;
  onTitleChange: (chat: Chat) => void;
  onOrderChange?: () => void;
};

type DragState = {
  chatId: string;
  inPinned: boolean;
  fromIndex: number;
  overIndex: number | null;
};

type GrabState = {
  chatId: string;
  inPinned: boolean;
  snapshot: ChatOrderPrefs;
};

/**
 * Subject chat rows: pin, manual reorder (pointer + keyboard), rename, sort mode.
 * Prefs stay in localStorage; App owns selection + create.
 */
export function ChatList({
  projectId,
  chats,
  activeChatId,
  query = "",
  busy,
  onSelect,
  onCreate,
  onTitleChange,
  onOrderChange,
}: Props) {
  const filterActive = Boolean(query);
  const liveId = useId();
  const [prefs, setPrefs] = useState<ChatOrderPrefs>(() =>
    projectId ? loadChatOrder(projectId) : emptyChatOrder(),
  );
  const [announce, setAnnounce] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [grab, setGrab] = useState<GrabState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!projectId) {
      setPrefs(emptyChatOrder());
      return;
    }
    setPrefs(loadChatOrder(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !chats.length) return;
    const next = reconcileChatOrder(prefsRef.current, chats.map((chat) => chat.id));
    if (
      next.mode !== prefsRef.current.mode ||
      next.pinned.join() !== prefsRef.current.pinned.join() ||
      next.order.join() !== prefsRef.current.order.join()
    ) {
      setPrefs(next);
      saveChatOrder(projectId, next);
    }
  }, [projectId, chats]);

  function commit(next: ChatOrderPrefs, message?: string, undo?: ChatOrderPrefs) {
    setPrefs(next);
    saveChatOrder(projectId, next);
    onOrderChange?.();
    if (message) {
      setAnnounce(message);
      if (undo) {
        toast(message, {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: () => {
              setPrefs(undo);
              saveChatOrder(projectId, undo);
              onOrderChange?.();
              setAnnounce("Order restored");
            },
          },
        });
      }
    }
  }

  const sorted = sortChats(chats, prefs).filter(
    (chat) => !query || chat.title.toLowerCase().includes(query),
  );

  function listFor(chatId: string): { inPinned: boolean; ids: string[] } {
    const clean = reconcileChatOrder(prefs, chats.map((c) => c.id));
    if (clean.pinned.includes(chatId)) return { inPinned: true, ids: clean.pinned };
    return { inPinned: false, ids: clean.order };
  }

  function onGripPointerDown(event: ReactPointerEvent<HTMLButtonElement>, chat: Chat) {
    if (filterActive || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const { inPinned, ids } = listFor(chat.id);
    const fromIndex = ids.indexOf(chat.id);
    if (fromIndex < 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const snapshot = structuredClone(prefs);
    setDrag({ chatId: chat.id, inPinned, fromIndex, overIndex: fromIndex });
    setAnnounce(`Grabbed ${chat.title}. Use arrows or drag to move.`);

    function onMove(move: PointerEvent) {
      const el = document.elementFromPoint(move.clientX, move.clientY);
      const row = el?.closest("[data-chat-id]") as HTMLElement | null;
      if (!row) return;
      const overId = row.dataset.chatId;
      if (!overId) return;
      const overPinned = row.dataset.pinned === "1";
      if (overPinned !== inPinned) return;
      const overIds = inPinned
        ? reconcileChatOrder(prefsRef.current, chats.map((c) => c.id)).pinned
        : reconcileChatOrder(prefsRef.current, chats.map((c) => c.id)).order;
      const overIndex = overIds.indexOf(overId);
      if (overIndex < 0) return;
      setDrag((current) =>
        current ? { ...current, overIndex } : { chatId: chat.id, inPinned, fromIndex, overIndex },
      );
    }

    function onUp() {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDrag((current) => {
        if (!current || current.overIndex === null || current.overIndex === current.fromIndex) {
          setAnnounce("Reorder cancelled");
          return null;
        }
        const next = moveChatToIndex(prefsRef.current, current.chatId, current.overIndex, current.inPinned);
        const total = current.inPinned
          ? reconcileChatOrder(next, chats.map((c) => c.id)).pinned.length
          : reconcileChatOrder(next, chats.map((c) => c.id)).order.length;
        commit(next, `Moved to position ${current.overIndex + 1} of ${total}`, snapshot);
        return null;
      });
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function onGripKeyDown(event: KeyboardEvent<HTMLButtonElement>, chat: Chat) {
    if (filterActive) return;
    const { inPinned, ids } = listFor(chat.id);
    const index = ids.indexOf(chat.id);

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grab?.chatId === chat.id) {
        setGrab(null);
        setAnnounce(`Dropped ${chat.title}`);
        return;
      }
      setGrab({ chatId: chat.id, inPinned, snapshot: structuredClone(prefs) });
      setAnnounce(`Grabbed ${chat.title}, position ${index + 1} of ${ids.length}. Arrow keys to move, Space to drop, Escape to cancel.`);
      return;
    }

    if (event.key === "Escape" && grab?.chatId === chat.id) {
      event.preventDefault();
      commit(grab.snapshot, "Reorder cancelled");
      setGrab(null);
      return;
    }

    if (!grab || grab.chatId !== chat.id) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const next = moveChat(prefs, chat.id, direction);
      const nextIds = inPinned
        ? reconcileChatOrder(next, chats.map((c) => c.id)).pinned
        : reconcileChatOrder(next, chats.map((c) => c.id)).order;
      const nextIndex = nextIds.indexOf(chat.id);
      commit(next);
      setAnnounce(`Position ${nextIndex + 1} of ${nextIds.length}`);
    }
  }

  function onTogglePin(chat: Chat) {
    const snapshot = structuredClone(prefs);
    const next = togglePin(prefs, chat.id);
    const pinned = next.pinned.includes(chat.id);
    commit(next, pinned ? `Pinned ${chat.title}` : `Unpinned ${chat.title}`, snapshot);
  }

  function setMode(mode: ChatOrderPrefs["mode"]) {
    if (mode === prefs.mode) return;
    const snapshot = structuredClone(prefs);
    const next = { ...prefs, mode };
    commit(next, mode === "manual" ? "Manual order" : "Recent order", snapshot);
  }

  async function submitRename() {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) {
      toast.error("Title cannot be empty.");
      return;
    }
    if (title === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    setRenameBusy(true);
    try {
      const updated = await renameChat(renameTarget.id, title);
      onTitleChange(updated);
      toast.success("Chat renamed");
      setRenameTarget(null);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-1 px-1">
        <span className="sr-only" id={liveId} aria-live="polite">
          {announce}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[0.65rem] font-medium text-muted-foreground"
              aria-label="Chat sort order"
            >
              {prefs.mode === "manual" ? "Manual" : "Recent"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            <DropdownMenuLabel>Sort chats</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setMode("recent")}>Recent</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMode("manual")}>Manual</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ul className="ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pl-2" aria-describedby={liveId}>
        {sorted.map((chat) => {
          const pinned = prefs.pinned.includes(chat.id);
          const { ids } = listFor(chat.id);
          const index = ids.indexOf(chat.id);
          const showDrop =
            drag &&
            drag.inPinned === pinned &&
            drag.chatId !== chat.id &&
            drag.overIndex === index;
          const grabbing = grab?.chatId === chat.id || drag?.chatId === chat.id;
          return (
            <li
              key={chat.id}
              data-chat-id={chat.id}
              data-pinned={pinned ? "1" : "0"}
              className={cn("relative", showDrop && "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent")}
            >
              <div
                className={cn(
                  "group flex items-center gap-0.5 rounded-md",
                  chat.id === activeChatId && "bg-sidebar-accent text-sidebar-accent-foreground",
                  grabbing && "ring-1 ring-accent/50",
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing",
                    grabbing && "opacity-100",
                    filterActive && "pointer-events-none opacity-30",
                  )}
                  aria-label={
                    filterActive ? `Clear filter to reorder ${chat.title}` : `Reorder ${chat.title}`
                  }
                  aria-pressed={grab?.chatId === chat.id}
                  aria-disabled={filterActive || undefined}
                  aria-keyshortcuts="Space Enter ArrowUp ArrowDown Escape"
                  disabled={filterActive}
                  onPointerDown={(event) => onGripPointerDown(event, chat)}
                  onKeyDown={(event) => onGripKeyDown(event, chat)}
                  onClick={(event) => event.stopPropagation()}
                >
                  <GripVertical className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-current={chat.id === activeChatId ? "true" : undefined}
                  className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate rounded-md px-1 py-1.5 text-left text-[0.7rem] transition-colors duration-200",
                    chat.id === activeChatId
                      ? "font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onSelect(chat.id)}
                >
                  <span className="inline-flex max-w-full items-center gap-1">
                    {pinned && <Pin className="size-2.5 shrink-0 text-accent" aria-hidden />}
                    <span className="truncate">{chat.title}</span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Chat actions for ${chat.title}`}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem onSelect={() => onTogglePin(chat)}>
                      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      {pinned ? "Unpin" : "Pin"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setRenameTarget(chat);
                        setRenameValue(chat.title);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
        {!sorted.length && (
          <li className={cn(pageShell.subtitle, "px-2.5 py-1 text-[0.65rem]")}>No chats yet.</li>
        )}
        <li>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-2.5 text-[0.7rem] font-medium text-muted-foreground"
            disabled={busy}
            onClick={onCreate}
          >
            <Plus className="size-3.5" /> New chat
          </Button>
        </li>
      </ul>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && !renameBusy && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Title shows in the sidebar and chat switcher.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              aria-label="Chat title"
              maxLength={200}
              autoFocus
              disabled={renameBusy}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={renameBusy} onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={renameBusy || !renameValue.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
