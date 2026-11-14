/** Per-subject chat pin + manual order. Pure helpers; storage is local. */

export type ChatOrderMode = "recent" | "manual";

export type ChatOrderPrefs = {
  mode: ChatOrderMode;
  pinned: string[];
  order: string[];
};

const PREFIX = "tidyai.chatOrder.";

export function emptyChatOrder(): ChatOrderPrefs {
  return { mode: "recent", pinned: [], order: [] };
}

export function loadChatOrder(projectId: string): ChatOrderPrefs {
  if (!projectId) return emptyChatOrder();
  try {
    const raw = localStorage.getItem(PREFIX + projectId);
    if (!raw) return emptyChatOrder();
    const parsed = JSON.parse(raw) as Partial<ChatOrderPrefs>;
    return {
      mode: parsed.mode === "manual" ? "manual" : "recent",
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((id) => typeof id === "string") : [],
      order: Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return emptyChatOrder();
  }
}

export function saveChatOrder(projectId: string, prefs: ChatOrderPrefs): void {
  if (!projectId) return;
  try {
    localStorage.setItem(PREFIX + projectId, JSON.stringify(prefs));
  } catch {
    // Private mode can refuse writes.
  }
}

/** Drop unknown ids; append new chats; keep pin ∩ known. */
export function reconcileChatOrder(prefs: ChatOrderPrefs, chatIds: string[]): ChatOrderPrefs {
  const known = new Set(chatIds);
  const pinned = prefs.pinned.filter((id) => known.has(id));
  const pinnedSet = new Set(pinned);
  const order = prefs.order.filter((id) => known.has(id) && !pinnedSet.has(id));
  for (const id of chatIds) {
    if (!pinnedSet.has(id) && !order.includes(id)) order.push(id);
  }
  return { mode: prefs.mode, pinned, order };
}

export function sortChats<T extends { id: string }>(
  chats: T[],
  prefs: ChatOrderPrefs,
): T[] {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const clean = reconcileChatOrder(prefs, chats.map((chat) => chat.id));
  if (clean.mode === "recent") {
    const pinned = clean.pinned.map((id) => byId.get(id)).filter(Boolean) as T[];
    const rest = chats.filter((chat) => !clean.pinned.includes(chat.id));
    return [...pinned, ...rest];
  }
  const orderedIds = [...clean.pinned, ...clean.order];
  const seen = new Set<string>();
  const next: T[] = [];
  for (const id of orderedIds) {
    const chat = byId.get(id);
    if (chat && !seen.has(id)) {
      next.push(chat);
      seen.add(id);
    }
  }
  for (const chat of chats) {
    if (!seen.has(chat.id)) next.push(chat);
  }
  return next;
}

export function togglePin(prefs: ChatOrderPrefs, chatId: string): ChatOrderPrefs {
  const pinned = prefs.pinned.includes(chatId)
    ? prefs.pinned.filter((id) => id !== chatId)
    : [...prefs.pinned, chatId];
  const order = prefs.order.filter((id) => id !== chatId);
  if (!pinned.includes(chatId) && !order.includes(chatId)) order.push(chatId);
  return { mode: "manual", pinned, order };
}

export function moveChat(
  prefs: ChatOrderPrefs,
  chatId: string,
  direction: -1 | 1,
): ChatOrderPrefs {
  const clean = { ...prefs, mode: "manual" as const };
  const inPinned = clean.pinned.includes(chatId);
  const list = inPinned ? [...clean.pinned] : [...clean.order];
  const index = list.indexOf(chatId);
  if (index < 0) return clean;
  const target = index + direction;
  if (target < 0 || target >= list.length) return clean;
  const swap = list[target];
  list[target] = chatId;
  list[index] = swap;
  return inPinned ? { ...clean, pinned: list } : { ...clean, order: list };
}

export function moveChatToIndex(
  prefs: ChatOrderPrefs,
  chatId: string,
  toIndex: number,
  inPinned: boolean,
): ChatOrderPrefs {
  const clean = { ...prefs, mode: "manual" as const };
  const list = inPinned ? [...clean.pinned] : [...clean.order];
  const from = list.indexOf(chatId);
  if (from < 0) return clean;
  list.splice(from, 1);
  const clamped = Math.max(0, Math.min(list.length, toIndex));
  list.splice(clamped, 0, chatId);
  return inPinned ? { ...clean, pinned: list } : { ...clean, order: list };
}
