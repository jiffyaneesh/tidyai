import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { Streamdown } from "streamdown";
import { math } from "@streamdown/math";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Moon,
  PanelLeft,
  Plus,
  Send,
  Settings as SettingsIcon,
  Square,
  Sun,
} from "lucide-react";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { chatBubble, pageShell } from "@/lib/page-shell";
import { composerBlockReason, friendlyError } from "@/lib/errors";
import { clampNotesWidth, loadNotesWidth, saveNotesWidth } from "@/lib/notes-width";
import { subjectDot } from "@/lib/subject-dot";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";
import {
  createChat,
  createProject,
  getPage,
  health,
  listChats,
  listMessages,
  listPages,
  listProjects,
  putPageBlocks,
  streamTurn,
  type Block,
  type Chat,
  type Message,
  type NotePage,
  type Project,
} from "./api";
import { loadStudyMode, saveStudyMode, type StudyMode } from "./lib/study-mode";
import { bumpStudyStat, loadStudyStats, type StudyStats } from "./lib/study-stats";
import { NotesEditor } from "./notes-editor";
import { Settings } from "./Settings";
import { loadActiveId, loadProfiles, saveActiveId, saveProfiles, type Profile } from "./vault";

type Citation = { sourceType?: string; sourceId?: string; snippet?: string };

export function App() {
  const { theme, toggle } = useTheme();
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia("(min-width: 960px)").matches);
  const [notesOpen, setNotesOpen] = useState(() => window.matchMedia("(min-width: 960px)").matches);
  const [notesWidth, setNotesWidth] = useState(() => loadNotesWidth());
  const [notesResizing, setNotesResizing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [chatsByProject, setChatsByProject] = useState<Record<string, Chat[]>>({});
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [chatId, setChatId] = useState("");
  const [pages, setPages] = useState<NotePage[]>([]);
  const [pageId, setPageId] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [notesRevision, setNotesRevision] = useState(0);
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesReloadPending, setNotesReloadPending] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [dbDown, setDbDown] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [studyMode, setStudyMode] = useState<StudyMode>("web");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [studyStats, setStudyStats] = useState<StudyStats>(() => loadStudyStats());
  const abortRef = useRef<AbortController | null>(null);
  const dbDownRef = useRef(false);

  const active = profiles.find((profile) => profile.id === activeId) ?? null;
  const sendBlock = composerBlockReason({
    dbDown,
    hasProvider: Boolean(active),
    hasChat: Boolean(chatId),
    busy,
    draftEmpty: !draft.trim(),
  });
  const canSend = !sendBlock;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const chats = chatsByProject[projectId] ?? [];
  const session = chats.find((item) => item.id === chatId) ?? null;
  const messages = chatId ? messagesByChat[chatId] ?? [] : [];
  const query = sessionQuery.trim().toLowerCase();
  const activePage = pages.find((page) => page.id === pageId) ?? null;

  useEffect(() => {
    void health()
      .then((body) => {
        const down = body.db !== "ok";
        setDbDown(down);
        if (down && !dbDownRef.current) {
          toast.error("Database is not running.", {
            description: "Start it with docker compose up -d, then Retry.",
          });
        }
        dbDownRef.current = down;
      })
      .catch(() => {
        setDbDown(true);
        if (!dbDownRef.current) {
          toast.error(friendlyError("Failed to fetch"));
        }
        dbDownRef.current = true;
      });
    void loadProfiles()
      .then((saved) => {
        setProfiles(saved);
        const stored = loadActiveId();
        setActiveId(saved.some((profile) => profile.id === stored) ? stored : saved[0]?.id ?? "");
      })
      .catch(() => {
        toast.error("Could not open the key vault in this browser.", {
          description: "Provider keys stay local. Check private mode or storage permissions.",
        });
      });
  }, []);

  useEffect(() => {
    if (dbDown) return;
    void listProjects()
      .then((rows) => {
        setProjects(rows);
        setProjectId((current) => current || rows[0]?.id || "");
      })
      .catch((err: unknown) => toast.error(friendlyError(err, "Could not load subjects.")));
  }, [dbDown]);

  useEffect(() => {
    if (!projectId) return;
    let cancel = false;
    setExpandedIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
    void listChats(projectId)
      .then((rows) => {
        if (cancel) return;
        setChatsByProject((current) => ({ ...current, [projectId]: rows }));
        setChatId((current) => {
          if (current && rows.some((row) => row.id === current)) return current;
          return rows[0]?.id ?? "";
        });
      })
      .catch(() => {
        if (!cancel) toast.error("Could not load chats for this subject.");
      });
    void listPages(projectId)
      .then((rows) => {
        if (cancel) return;
        setPages(rows);
        setPageId((current) => current || rows[0]?.id || "");
      })
      .catch(() => {
        if (!cancel) toast.error("Could not load note pages.");
      });
    return () => {
      cancel = true;
    };
  }, [projectId]);

  useEffect(() => {
    setStudyMode(loadStudyMode(chatId));
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    let cancel = false;
    const requested = chatId;
    void listMessages(requested)
      .then((rows) => {
        if (cancel) return;
        setMessagesByChat((current) => ({ ...current, [requested]: rows }));
      })
      .catch(() => {
        if (!cancel) setMessagesByChat((current) => ({ ...current, [requested]: current[requested] ?? [] }));
      });
    return () => {
      cancel = true;
    };
  }, [chatId]);

  useEffect(() => {
    if (!projectId || !pageId) return;
    let cancel = false;
    void getPage(projectId, pageId)
      .then((page) => {
        if (cancel) return;
        setBlocks(page.blocks ?? []);
        setNotesDirty(false);
        setNotesReloadPending(false);
        setNotesRevision((value) => value + 1);
      })
      .catch(() => {
        if (!cancel) setBlocks([]);
      });
    return () => {
      cancel = true;
    };
  }, [projectId, pageId]);

  useEffect(() => {
    function onOpenPage(event: Event) {
      const pageIdNext = (event as CustomEvent<{ pageId?: string }>).detail?.pageId;
      if (pageIdNext) setPageId(pageIdNext);
    }
    window.addEventListener("tidyai:open-page", onOpenPage);
    return () => window.removeEventListener("tidyai:open-page", onOpenPage);
  }, []);

  async function refreshNotes() {
    if (!projectId) return;
    try {
      const rows = await listPages(projectId);
      setPages(rows);
      const target = pageId || rows[0]?.id || "";
      if (!pageId && target) setPageId(target);
      if (!target) return;
      if (notesDirty) {
        setNotesReloadPending(true);
        return;
      }
      const page = await getPage(projectId, target);
      setBlocks(page.blocks ?? []);
      setNotesRevision((value) => value + 1);
      setNotesReloadPending(false);
    } catch (err) {
      toast.error(friendlyError(err, "Could not refresh notes."));
    }
  }

  async function reloadNotesFromServer() {
    if (!projectId || !pageId) return;
    try {
      const page = await getPage(projectId, pageId);
      setBlocks(page.blocks ?? []);
      setNotesDirty(false);
      setNotesReloadPending(false);
      setNotesRevision((value) => value + 1);
      toast.success("Notes reloaded.");
    } catch (err) {
      toast.error(friendlyError(err, "Could not reload notes."));
    }
  }

  async function reloadHealth() {
    try {
      const body = await health();
      const down = body.db !== "ok";
      setDbDown(down);
      dbDownRef.current = down;
      if (down) {
        toast.error("Database is still down.", { description: "Run docker compose up -d." });
      } else {
        toast.success("Database is back.");
      }
    } catch {
      setDbDown(true);
      dbDownRef.current = true;
      toast.error(friendlyError("Failed to fetch"));
    }
  }

  function expandSubject(id: string) {
    setExpandedIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function toggleSubject(id: string) {
    setExpandedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function selectProject(id: string) {
    expandSubject(id);
    if (id === projectId) return;
    setPageId("");
    setProjectId(id);
  }

  function selectChat(nextProjectId: string, nextChatId: string) {
    expandSubject(nextProjectId);
    if (nextProjectId !== projectId) {
      setPageId("");
      setProjectId(nextProjectId);
    }
    setChatId(nextChatId);
    setStudyMode(loadStudyMode(nextChatId));
    if (window.matchMedia("(max-width: 959px)").matches) setSideOpen(false);
  }

  function changeStudyMode(mode: StudyMode) {
    setStudyMode(mode);
    saveStudyMode(chatId, mode);
  }

  async function onCreateProject() {
    const title = subjectName.trim();
    if (!title) {
      toast.message("Name the subject first.");
      return;
    }
    if (dbDown) {
      toast.error("Database is down. Start Postgres, then retry.");
      return;
    }
    try {
      const created = await createProject(title);
      setProjects((current) => [...current, created]);
      setChatsByProject((current) => ({ ...current, [created.id]: [] }));
      setPageId("");
      setPages([]);
      setChatId("");
      setBlocks([]);
      setProjectId(created.id);
      expandSubject(created.id);
      setSubjectName("");
      setSubjectOpen(false);
      toast.success(`Subject “${created.title}” ready.`);
    } catch (err) {
      toast.error(friendlyError(err, "Could not create that subject."));
    }
  }

  async function onCreateChat(forProjectId = projectId) {
    if (!forProjectId || busy) return;
    if (dbDown) {
      toast.error("Database is down. Start Postgres, then retry.");
      return;
    }
    try {
      const created = await createChat(forProjectId);
      setChatsByProject((current) => ({
        ...current,
        [forProjectId]: [...(current[forProjectId] ?? []), created],
      }));
      setMessagesByChat((current) => ({ ...current, [created.id]: [] }));
      selectChat(forProjectId, created.id);
      toast.success("New chat started.");
    } catch (err) {
      toast.error(friendlyError(err, "Could not create that chat."));
    }
  }

  async function onSend() {
    const text = draft.trim();
    const block = composerBlockReason({
      dbDown,
      hasProvider: Boolean(active),
      hasChat: Boolean(chatId),
      busy,
      draftEmpty: !text,
    });
    if (block) {
      toast.message(block);
      return;
    }
    if (!active || !chatId) return;
    setDraft("");
    setStatus("");
    setStreaming("");
    setCitations([]);
    setBusy(true);
    const activeChat = chatId;
    const turnMode = studyMode;
    setMessagesByChat((current) => ({
      ...current,
      [activeChat]: [...(current[activeChat] ?? []), { id: "pending", role: "user", content: text }],
    }));
    const controller = new AbortController();
    abortRef.current = controller;
    let live = "";
    let sawError = false;
    let sawNotes = false;
    try {
      await streamTurn(
        activeChat,
        {
          text,
          protocol: active.protocol,
          baseUrl: active.baseUrl,
          model: active.model,
          patchModel: active.patchModel,
          pageId,
          embeddingModel: active.embeddingModel,
          embeddingBaseUrl: active.embeddingBaseUrl,
          mode: turnMode,
        },
        active.apiKey,
        (event) => {
          if (event.event === "text") {
            live += event.data;
            setStreaming(live);
          } else if (event.event === "status") {
            setStatus(event.data);
            if (event.data === "Searching notes") {
              setStudyStats(bumpStudyStat("searches"));
            }
          } else if (event.event === "citations") {
            try {
              const parsed = JSON.parse(event.data) as Citation[];
              if (Array.isArray(parsed) && parsed.length) {
                setCitations(parsed);
                setStudyStats(bumpStudyStat("hits", parsed.length));
              }
            } catch {
              // Ignore malformed citation payloads.
            }
          } else if (event.event === "error") {
            sawError = true;
            try {
              const parsed = JSON.parse(event.data) as { message?: string };
              toast.error(friendlyError(parsed.message || "The provider call failed."));
            } catch {
              toast.error("The provider call failed.");
            }
          } else if (event.event === "notes") {
            sawNotes = true;
            void refreshNotes();
          }
        },
        controller.signal,
        active.embeddingKey,
      );
      const [saved, sessions] = await Promise.all([listMessages(activeChat), listChats(projectId)]);
      setStreaming("");
      setMessagesByChat((current) => ({ ...current, [activeChat]: saved }));
      setChatsByProject((current) => ({ ...current, [projectId]: sessions }));
      if (!sawError) setStatus("");
      if (turnMode === "notes" && !sawNotes && !sawError) {
        setStudyStats(bumpStudyStat("noteSkips"));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus(live ? "Stopped. Partial answer kept when the server saved it." : "Stopped.");
        toast.message(live ? "Stopped. Partial answer kept if the server saved it." : "Stopped.");
      } else {
        toast.error(friendlyError(err, "The turn failed."));
      }
      try {
        const saved = await listMessages(activeChat);
        setMessagesByChat((current) => ({ ...current, [activeChat]: saved }));
      } catch {
        // The optimistic user line stays on screen.
      }
    } finally {
      setStreaming("");
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      toast.success("Copied.");
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? "" : current)), 1500);
    } catch {
      toast.error("Could not copy that answer.");
    }
  }

  function changeProfiles(next: Profile[], id: string) {
    setProfiles(next);
    setActiveId(id);
    saveActiveId(id);
    void saveProfiles(next);
  }

  function onNotesResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!notesOpen) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setNotesResizing(true);
    const startX = event.clientX;
    const startWidth = notesWidth;

    function onMove(move: PointerEvent) {
      const next = clampNotesWidth(startWidth + (startX - move.clientX));
      setNotesWidth(next);
    }

    function onUp(up: PointerEvent) {
      handle.releasePointerCapture(up.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setNotesResizing(false);
      setNotesWidth((current) => {
        const width = clampNotesWidth(current);
        saveNotesWidth(width);
        return width;
      });
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster theme={theme} />
      <div className="flex h-full min-h-0 bg-background text-foreground">
        {sideOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-foreground/20 min-[960px]:hidden"
            aria-label="Hide sidebar"
            onClick={() => setSideOpen(false)}
          />
        )}
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
            sideOpen ? "w-[245px]" : "w-14",
            "max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-40 max-[959px]:shadow-lg",
            !sideOpen && "max-[959px]:hidden",
          )}
          aria-label="Subjects"
        >
          <div className="flex h-[52px] items-center gap-2 px-3 pt-2">
            <IconTip label={sideOpen ? "Hide sidebar" : "Show sidebar"}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-expanded={sideOpen}
                aria-controls="project-nav"
                aria-label={sideOpen ? "Hide sidebar" : "Show sidebar"}
                onClick={() => setSideOpen((open) => !open)}
              >
                <PanelLeft />
              </Button>
            </IconTip>
            {sideOpen && (
              <span className="flex items-center gap-2 text-[0.875rem] font-bold tracking-[-0.05em]">
                <span className="wordmark-dot" aria-hidden />
                tidyai
              </span>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1" id="project-nav">
            <div className="flex flex-col gap-0.5 px-3 pb-3 pt-1">
              {sideOpen && (
                <>
                  <div className="sidebar-kicker mb-2 flex items-center justify-between px-2">
                    <span>Your subjects</span>
                    <button
                      type="button"
                      className="text-[0.7rem] leading-none text-muted-foreground hover:text-foreground"
                      aria-label="New subject"
                      onClick={() => setSubjectOpen(true)}
                    >
                      ＋
                    </button>
                  </div>
                  <Input
                    value={sessionQuery}
                    placeholder="Filter"
                    aria-label="Filter subjects and chats"
                    className="mb-2 h-8 rounded-lg border-sidebar-border bg-sidebar-accent/40 text-[0.7rem]"
                    onChange={(event) => setSessionQuery(event.target.value)}
                  />
                </>
              )}
              {projects.map((item) => {
                const open = expandedIds.includes(item.id);
                const subjectChats = (chatsByProject[item.id] ?? []).filter(
                  (chat) => !query || chat.title.toLowerCase().includes(query) || item.title.toLowerCase().includes(query),
                );
                if (query && !item.title.toLowerCase().includes(query) && !subjectChats.length) return null;
                const dot = subjectDot(item.title);
                return (
                  <div key={item.id} className="flex flex-col gap-0.5">
                    <div
                      className={cn(
                        "flex items-center gap-0.5 rounded-lg",
                        item.id === projectId && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <button
                        type="button"
                        aria-current={item.id === projectId ? "page" : undefined}
                        aria-label={item.title}
                        className={cn(
                          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-2.5 text-left transition-colors duration-200",
                          item.id === projectId
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/70",
                          !sideOpen && "justify-center px-0",
                        )}
                        onClick={() => {
                          selectProject(item.id);
                          if (!open) toggleSubject(item.id);
                          if (!chatsByProject[item.id]) {
                            void listChats(item.id).then((rows) =>
                              setChatsByProject((current) => ({ ...current, [item.id]: rows })),
                            );
                          }
                        }}
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
                        {sideOpen ? (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.7rem] font-medium text-foreground">{item.title}</span>
                            <span className="mt-0.5 block text-[0.56rem] text-muted-foreground">
                              {subjectChats.length || (chatsByProject[item.id] ?? []).length} chats
                            </span>
                          </span>
                        ) : (
                          <span className="sr-only">{item.title}</span>
                        )}
                      </button>
                      {sideOpen && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground"
                          aria-label={open ? `Collapse ${item.title}` : `Expand ${item.title}`}
                          aria-expanded={open}
                          onClick={() => {
                            toggleSubject(item.id);
                            if (!open && !chatsByProject[item.id]) {
                              void listChats(item.id).then((rows) =>
                                setChatsByProject((current) => ({ ...current, [item.id]: rows })),
                              );
                            }
                          }}
                        >
                          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </Button>
                      )}
                    </div>
                    {sideOpen && open && (
                      <ul className="ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
                        {subjectChats.map((chat) => (
                          <li key={chat.id}>
                            <button
                              type="button"
                              aria-current={chat.id === chatId ? "true" : undefined}
                              className={cn(
                                "w-full cursor-pointer truncate rounded-md px-2.5 py-1.5 text-left text-[0.7rem] transition-colors duration-200",
                                chat.id === chatId
                                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                              )}
                              onClick={() => selectChat(item.id, chat.id)}
                            >
                              {chat.title}
                            </button>
                          </li>
                        ))}
                        {!subjectChats.length && (
                          <li className={cn(pageShell.subtitle, "px-2.5 py-1 text-[0.65rem]")}>No chats yet.</li>
                        )}
                        <li>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full justify-start px-2.5 text-[0.7rem] font-medium text-muted-foreground"
                            disabled={busy}
                            onClick={() => void onCreateChat(item.id)}
                          >
                            <Plus className="size-3.5" /> New chat
                          </Button>
                        </li>
                      </ul>
                    )}
                  </div>
                );
              })}
              {!projects.length && sideOpen && <p className={cn(pageShell.subtitle, "px-2")}>No subjects yet.</p>}
            </div>
          </ScrollArea>
          <div className="mt-auto flex flex-col gap-1 border-t border-sidebar-border px-3 py-3">
            <IconTip label={dbDown ? "Database is down" : "New subject"}>
              <Button
                type="button"
                variant="ghost"
                size={sideOpen ? "sm" : "icon"}
                className="w-full justify-start text-[0.7rem]"
                aria-label="New subject"
                disabled={dbDown}
                onClick={() => setSubjectOpen(true)}
              >
                <Plus />
                {sideOpen && "New subject"}
              </Button>
            </IconTip>
            <IconTip label="Settings">
              <Button type="button" variant="ghost" size={sideOpen ? "sm" : "icon"} className="w-full justify-start text-[0.7rem]" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon />
                {sideOpen && "Settings"}
              </Button>
            </IconTip>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-background px-5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-[960px]:hidden"
              aria-label="Show sidebar"
              onClick={() => setSideOpen(true)}
            >
              <PanelLeft />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[0.7rem] text-muted-foreground">
              <span className="truncate">
                Subject / <span className="font-medium text-foreground">{project?.title ?? "tidyai"}</span>
              </span>
              {session && (
                <>
                  <span aria-hidden>/</span>
                  <span className="truncate">{session.title}</span>
                </>
              )}
              {!busy && !status && <span className="live-dot hidden sm:inline-block" aria-hidden />}
              {!busy && !status && <span className="hidden sm:inline">Synced</span>}
            </div>
            {active && <span className="tag-purple hidden md:inline">{active.label}</span>}
            {status && <Badge variant="secondary" className="hidden sm:inline-flex text-[0.65rem]">{status}</Badge>}
            {(studyStats.searches > 0 || studyStats.hits > 0 || studyStats.noteSkips > 0) && (
              <span className="hidden text-[0.62rem] text-muted-foreground lg:inline" title="Local study counters">
                search {studyStats.searches} · hits {studyStats.hits} · skip {studyStats.noteSkips}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1">
            <div className="mr-1 flex rounded-lg border border-border p-0.5" role="group" aria-label="Study mode">
              <Button
                type="button"
                size="sm"
                variant={studyMode === "notes" ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-[0.7rem]"
                aria-pressed={studyMode === "notes"}
                disabled={!chatId}
                onClick={() => changeStudyMode("notes")}
              >
                Notes
              </Button>
              <Button
                type="button"
                size="sm"
                variant={studyMode === "web" ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-[0.7rem]"
                aria-pressed={studyMode === "web"}
                disabled={!chatId}
                onClick={() => changeStudyMode("web")}
              >
                Web
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={!projectId}>
                  Chat
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Chats</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {chats.map((chat) => (
                  <DropdownMenuItem key={chat.id} onSelect={() => selectChat(projectId, chat.id)}>
                    {chat.id === chatId && <Check />}
                    {chat.title}
                  </DropdownMenuItem>
                ))}
                {!chats.length && <DropdownMenuItem disabled>No chats yet</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy || dbDown || !projectId} onSelect={() => void onCreateChat()}>
                  New chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Provider
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Active provider</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {profiles.map((profile) => (
                  <DropdownMenuItem key={profile.id} onSelect={() => changeProfiles(profiles, profile.id)}>
                    {profile.id === activeId && <Check />}
                    {profile.label}
                  </DropdownMenuItem>
                ))}
                {!profiles.length && <DropdownMenuItem disabled>No providers yet</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>Open settings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconTip label={notesOpen ? "Hide notes" : "Show notes"}>
              <Button
                type="button"
                variant={notesOpen ? "secondary" : "outline"}
                size="icon"
                aria-expanded={notesOpen}
                aria-controls="notes-pane"
                aria-label={notesOpen ? "Hide notes" : "Show notes"}
                onClick={() => setNotesOpen((open) => !open)}
              >
                <BookOpen />
              </Button>
            </IconTip>
            <IconTip label={theme === "dark" ? "Use light theme" : "Use dark theme"}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
                onClick={toggle}
              >
                {theme === "dark" ? <Sun /> : <Moon />}
              </Button>
            </IconTip>
            <IconTip label="Settings">
              <Button type="button" variant="outline" size="icon" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon />
              </Button>
            </IconTip>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
                  {project && chatId && (
                    <div className="mb-2 flex items-center gap-2 text-[0.75rem] font-bold tracking-[-0.02em]">
                      <span className="size-2 rounded-full" style={{ background: subjectDot(project.title) }} aria-hidden />
                      {project.title}
                      {session && <small className="ml-auto font-normal text-muted-foreground">{session.title}</small>}
                    </div>
                  )}
                  {dbDown && (
                    <div className="flex items-center justify-between gap-3 rounded-[11px] border border-warning/40 bg-warning/10 px-4 py-3 text-[0.8125rem]" role="alert">
                      <span>Database is not running. Start it with docker compose up -d.</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => void reloadHealth()}>
                        Retry
                      </Button>
                    </div>
                  )}
                  {!project && !dbDown && (
                    <section className={pageShell.section}>
                      <h2 className={pageShell.title}>Start a subject</h2>
                      <p className={cn(pageShell.subtitle, "mt-2")}>A subject holds sessions and the notes those sessions write.</p>
                      <Button type="button" className="mt-5" onClick={() => setSubjectOpen(true)}>
                        <Plus /> New subject
                      </Button>
                    </section>
                  )}
                  {project && !chatId && !dbDown && (
                    <section className={pageShell.section}>
                      <h2 className={pageShell.title}>No chat yet</h2>
                      <p className={cn(pageShell.subtitle, "mt-2")}>A chat is one study conversation. Notes stay on the subject.</p>
                      <Button type="button" className="mt-5" disabled={busy} onClick={() => void onCreateChat()}>
                        <Plus /> New chat
                      </Button>
                    </section>
                  )}
                  {chatId && !messages.length && !streaming && (
                    <section className={pageShell.section}>
                      <h2 className={pageShell.title}>Ask something about {project?.title}</h2>
                      <p className={cn(pageShell.subtitle, "mt-2")}>
                        {studyMode === "notes"
                          ? "Notes mode answers from this subject only. It will not edit the notebook."
                          : "Web mode can search outside facts, then update the notebook after the answer."}
                      </p>
                    </section>
                  )}
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={cn(message.role === "user" ? chatBubble.user : chatBubble.assistant)}
                    >
                      {message.role === "assistant" && (
                        <span className="absolute left-0 top-1 text-accent" aria-hidden>
                          ✳
                        </span>
                      )}
                      {message.role === "assistant" ? (
                        <div className="leading-relaxed [&_em]:text-accent [&_i]:text-accent">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="sr-only">Session</span>
                            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-[0.65rem] text-accent" onClick={() => void copyMessage(message)}>
                              {copiedId === message.id ? <Check /> : <Copy />}
                              {copiedId === message.id ? "Copied" : "Copy"}
                            </Button>
                          </div>
                          <Streamdown plugins={{ math }}>{message.content}</Streamdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                      )}
                    </article>
                  ))}
                  {streaming && (
                    <article className={chatBubble.assistant} aria-live="polite">
                      <span className="absolute left-0 top-1 text-accent" aria-hidden>
                        ✳
                      </span>
                      <div className="leading-relaxed [&_em]:text-accent [&_i]:text-accent">
                        <Streamdown plugins={{ math }} isAnimating>
                          {streaming}
                        </Streamdown>
                      </div>
                    </article>
                  )}
                  {!!citations.length && (
                    <aside className="mr-auto max-w-[min(100%,28rem)] rounded-lg border border-border bg-accent-soft/50 px-3 py-2.5" aria-label="Note citations">
                      <p className="sidebar-kicker mb-1.5">From notes</p>
                      <ul className="flex flex-col gap-1">
                        {citations.slice(0, 6).map((hit, index) => (
                          <li key={`${hit.sourceId ?? "hit"}-${index}`} className="truncate text-[0.7rem] text-muted-foreground">
                            <span className="font-medium text-accent">{hit.sourceType ?? "note"}</span>
                            {hit.snippet ? ` — ${hit.snippet}` : ""}
                          </li>
                        ))}
                      </ul>
                    </aside>
                  )}
                </div>
              </ScrollArea>
              <form
                className="relative z-10 border-t border-border bg-background px-6 py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSend();
                }}
              >
                <div
                  className={cn(
                    "mx-auto flex max-w-3xl items-end gap-2 rounded-lg border bg-card px-3 py-2.5 transition-[border-color,box-shadow] duration-200",
                    canSend || busy
                      ? "border-input focus-within:border-ring focus-within:shadow-subtle"
                      : "border-border opacity-90",
                  )}
                >
                  <label className="sr-only" htmlFor="draft">
                    Message
                  </label>
                  <Textarea
                    id="draft"
                    rows={1}
                    placeholder={
                      dbDown
                        ? "Database is down…"
                        : !active
                          ? "Add a provider in Settings"
                          : !chatId
                            ? "Open or create a chat first"
                            : "Ask a follow-up"
                    }
                    value={draft}
                    disabled={dbDown || !active || busy || !chatId}
                    aria-invalid={Boolean(sendBlock && draft.trim())}
                    className="min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-[0.75rem] text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (canSend) void onSend();
                        else if (sendBlock) toast.message(sendBlock);
                      }
                    }}
                  />
                  {busy ? (
                    <Button type="button" variant="destructive" size="icon" className="size-8 shrink-0" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
                      <Square />
                    </Button>
                  ) : (
                    <IconTip label={sendBlock ?? "Send"}>
                      <Button type="submit" size="icon" className="size-8 shrink-0" disabled={!canSend} aria-label="Send">
                        <Send />
                      </Button>
                    </IconTip>
                  )}
                </div>
                <p className="mx-auto mt-2 max-w-3xl text-[0.62rem] text-muted-foreground">
                  {sendBlock && !busy ? sendBlock : "Enter sends · Shift+Enter newline"}
                </p>
              </form>
            </div>
            <aside
              id="notes-pane"
              aria-label="Notes"
              aria-hidden={!notesOpen}
              style={notesOpen ? { width: notesWidth } : undefined}
              className={cn(
                "relative flex shrink-0 flex-col overflow-hidden border-l border-border bg-note-paper",
                "max-[960px]:absolute max-[960px]:inset-y-0 max-[960px]:right-0 max-[960px]:z-20 max-[960px]:max-w-[min(100%,40rem)] max-[960px]:shadow-soft",
                !notesResizing && "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                notesOpen ? "opacity-100" : "pointer-events-none w-0 border-transparent opacity-0",
              )}
            >
              {notesOpen && (
                <button
                  type="button"
                  aria-label="Resize notes pane"
                  className={cn(
                    "absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center border-0 bg-transparent p-0",
                    "before:block before:h-10 before:w-1 before:rounded-full before:bg-border before:transition-colors",
                    "hover:before:bg-accent focus-visible:before:bg-accent",
                    notesResizing && "before:bg-accent",
                  )}
                  onPointerDown={onNotesResizeStart}
                />
              )}
              <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-border px-4">
                <div className="min-w-0">
                  <p className="sidebar-kicker">Editable note</p>
                  <h2 className="truncate font-serif text-[1.05rem] font-normal tracking-[-0.03em]">
                    {activePage?.title ?? project?.title ?? "Notes"}
                  </h2>
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-[0.7rem]" onClick={() => setNotesOpen(false)}>
                  Close
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border px-2 py-2">
                  <p className="sidebar-kicker mb-1.5 px-2">Pages</p>
                  <ul className="flex max-h-36 flex-col gap-0.5 overflow-y-auto">
                    {pages.map((page) => (
                      <li key={page.id} style={{ paddingLeft: page.depth * 12 }}>
                        <button
                          type="button"
                          aria-current={page.id === pageId ? "true" : undefined}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-[0.75rem] transition-colors",
                            page.id === pageId ? "bg-accent-soft text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                          )}
                          onClick={() => setPageId(page.id)}
                        >
                          <FileText className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{page.title}</span>
                        </button>
                      </li>
                    ))}
                    {!pages.length && <li className={cn(pageShell.subtitle, "px-2")}>No pages yet.</li>}
                  </ul>
                </div>
                {notesReloadPending && (
                  <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-accent-soft/40 px-3 py-2 text-sm">
                    <span>Session updated this page.</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => void reloadNotesFromServer()}>
                      Reload
                    </Button>
                  </div>
                )}
                {projectId && pageId ? (
                  <NotesEditor
                    key={pageId}
                    projectId={projectId}
                    pageId={pageId}
                    blocks={blocks}
                    revision={notesRevision}
                    onDirty={() => setNotesDirty(true)}
                    onSaved={(saved) => {
                      setBlocks(saved);
                      setNotesDirty(false);
                    }}
                    onSave={(pid, pidPage, next) => putPageBlocks(pid, pidPage, next)}
                  />
                ) : (
                  <div className="px-4 py-8 text-center">
                    <FileText className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">Pick a page</p>
                    <p className={cn(pageShell.subtitle, "mt-1")}>Notes open in a live notebook editor.</p>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>

        <Dialog open={subjectOpen} onOpenChange={setSubjectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New subject</DialogTitle>
              <DialogDescription>A subject is one course or topic. Sessions and notes stay inside it.</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateProject();
              }}
            >
              <label className="grid gap-1.5 text-[0.79rem] font-medium">
                Name
                <Input
                  value={subjectName}
                  autoFocus
                  placeholder="Mechanics"
                  onChange={(event) => setSubjectName(event.target.value)}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setSubjectOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!subjectName.trim() || dbDown}>
                  Create subject
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {settingsOpen && (
          <Settings profiles={profiles} activeId={activeId} onClose={() => setSettingsOpen(false)} onChange={changeProfiles} />
        )}
      </div>
    </TooltipProvider>
  );
}

function IconTip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
