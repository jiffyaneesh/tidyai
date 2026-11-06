import { useEffect, useRef, useState, type ReactElement } from "react";
import { Streamdown } from "streamdown";
import { math } from "@streamdown/math";
import {
  BookOpen,
  Check,
  Copy,
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
import { pageShell } from "@/lib/page-shell";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import {
  createChat,
  createProject,
  getPage,
  health,
  listChats,
  listMessages,
  listPages,
  listProjects,
  patchBlock,
  streamTurn,
  type Block,
  type Chat,
  type Message,
  type NotePage,
  type Project,
} from "./api";
import { BlockView } from "./notes";
import { Settings } from "./Settings";
import { loadActiveId, loadProfiles, saveActiveId, saveProfiles, type Profile } from "./vault";

export function App() {
  const { theme, toggle } = useTheme();
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia("(min-width: 960px)").matches);
  const [notesOpen, setNotesOpen] = useState(() => window.matchMedia("(min-width: 960px)").matches);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [pages, setPages] = useState<NotePage[]>([]);
  const [pageId, setPageId] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [dbDown, setDbDown] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const active = profiles.find((profile) => profile.id === activeId) ?? null;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const session = chats.find((item) => item.id === chatId) ?? null;
  const visibleChats = chats.filter((chat) => chat.title.toLowerCase().includes(sessionQuery.trim().toLowerCase()));

  useEffect(() => {
    void health()
      .then((body) => setDbDown(body.db !== "ok"))
      .catch(() => setDbDown(true));
    void loadProfiles()
      .then((saved) => {
        setProfiles(saved);
        const stored = loadActiveId();
        setActiveId(saved.some((profile) => profile.id === stored) ? stored : saved[0]?.id ?? "");
      })
      .catch(() => setError("Could not open the key vault in this browser."));
  }, []);

  useEffect(() => {
    if (dbDown) return;
    void listProjects()
      .then((rows) => {
        setProjects(rows);
        setProjectId((current) => current || rows[0]?.id || "");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load subjects."));
  }, [dbDown]);

  useEffect(() => {
    if (!projectId) return;
    let cancel = false;
    setChatId("");
    setPageId("");
    void listChats(projectId).then((rows) => {
      if (cancel) return;
      setChats(rows);
      setChatId(rows[0]?.id ?? "");
    });
    void listPages(projectId).then((rows) => {
      if (cancel) return;
      setPages(rows);
      setPageId(rows[0]?.id ?? "");
    });
    return () => {
      cancel = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    void listMessages(chatId).then(setMessages).catch(() => setMessages([]));
  }, [chatId]);

  useEffect(() => {
    if (!projectId || !pageId) {
      setBlocks([]);
      return;
    }
    void getPage(projectId, pageId)
      .then((page) => setBlocks(page.blocks ?? []))
      .catch(() => setBlocks([]));
  }, [projectId, pageId]);

  async function refreshNotes() {
    if (!projectId) return;
    const rows = await listPages(projectId);
    setPages(rows);
    const target = pageId || rows[0]?.id || "";
    if (!pageId && target) setPageId(target);
    if (!target) return;
    const page = await getPage(projectId, target);
    setBlocks(page.blocks ?? []);
  }

  async function reloadHealth() {
    try {
      const body = await health();
      setDbDown(body.db !== "ok");
      if (body.db === "ok") setError("");
    } catch {
      setDbDown(true);
    }
  }

  function selectProject(id: string) {
    if (id === projectId) return;
    setPageId("");
    setPages([]);
    setChatId("");
    setBlocks([]);
    setProjectId(id);
    if (window.matchMedia("(max-width: 959px)").matches) setSideOpen(false);
  }

  async function onCreateProject() {
    const title = subjectName.trim();
    if (!title) return;
    try {
      const created = await createProject(title);
      setProjects((current) => [...current, created]);
      setPageId("");
      setPages([]);
      setChatId("");
      setBlocks([]);
      setProjectId(created.id);
      setSubjectName("");
      setSubjectOpen(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that subject.");
    }
  }

  async function onCreateChat() {
    if (!projectId || busy) return;
    try {
      const created = await createChat(projectId);
      setChats((current) => [...current, created]);
      setChatId(created.id);
      setMessages([]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that session.");
    }
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || !chatId || !active || busy) return;
    setDraft("");
    setError("");
    setStatus("");
    setStreaming("");
    setBusy(true);
    setMessages((current) => [...current, { id: "pending", role: "user", content: text }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let live = "";
    try {
      await streamTurn(
        chatId,
        {
          text,
          protocol: active.protocol,
          baseUrl: active.baseUrl,
          model: active.model,
          patchModel: active.patchModel,
          pageId,
          embeddingModel: active.embeddingModel,
          embeddingBaseUrl: active.embeddingBaseUrl,
        },
        active.apiKey,
        (event) => {
          if (event.event === "text") {
            live += event.data;
            setStreaming(live);
          } else if (event.event === "status") {
            setStatus(event.data);
          } else if (event.event === "error") {
            try {
              const parsed = JSON.parse(event.data) as { message?: string };
              setError(parsed.message || "The provider call failed.");
            } catch {
              setError("The provider call failed.");
            }
          } else if (event.event === "notes") {
            void refreshNotes();
          }
        },
        controller.signal,
        active.embeddingKey,
      );
      const [saved, sessions] = await Promise.all([listMessages(chatId), listChats(projectId)]);
      setStreaming("");
      setMessages(saved);
      setChats(sessions);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("Stopped.");
      } else {
        setError(err instanceof Error ? err.message : "The turn failed.");
      }
      try {
        setMessages(await listMessages(chatId));
      } catch {
        // The optimistic user line stays on screen.
      }
    } finally {
      setStreaming("");
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function onSaveBlock(block: Block, payload: Record<string, unknown>) {
    const saved = await patchBlock(block, payload);
    setBlocks((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? "" : current)), 1500);
    } catch {
      setError("Could not copy that answer.");
    }
  }

  function changeProfiles(next: Profile[], id: string) {
    setProfiles(next);
    setActiveId(id);
    saveActiveId(id);
    void saveProfiles(next);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 bg-background text-foreground">
        {sideOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-foreground/25 min-[960px]:hidden"
            aria-label="Hide sidebar"
            onClick={() => setSideOpen(false)}
          />
        )}
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
            sideOpen ? "w-64" : "w-14",
            "max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-40 max-[959px]:shadow-lg",
            !sideOpen && "max-[959px]:hidden",
          )}
          aria-label="Subjects"
        >
          <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-2">
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
            {sideOpen && <span className="text-sm font-medium tracking-tight">tidyai</span>}
          </div>
          <ScrollArea className="min-h-0 flex-1" id="project-nav">
            <div className="flex flex-col gap-1 p-2">
              {projects.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={item.id === projectId ? "page" : undefined}
                  aria-label={item.title}
                  className={cn(
                    "cursor-pointer truncate rounded-lg px-2 py-2 text-left text-sm",
                    item.id === projectId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/60",
                    !sideOpen && "px-0 text-center",
                  )}
                  onClick={() => selectProject(item.id)}
                >
                  {sideOpen ? item.title : item.title.slice(0, 1)}
                </button>
              ))}
              {!projects.length && sideOpen && (
                <p className={pageShell.subtitle}>No subjects yet.</p>
              )}
            </div>
          </ScrollArea>
          <div className="flex flex-col gap-2 border-t border-sidebar-border p-2">
            {sideOpen && (
              <>
                <Input
                  value={sessionQuery}
                  placeholder="Filter sessions"
                  aria-label="Filter sessions"
                  onChange={(event) => setSessionQuery(event.target.value)}
                />
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {visibleChats.map((chat) => (
                    <li key={chat.id}>
                      <button
                        type="button"
                        aria-current={chat.id === chatId ? "true" : undefined}
                        className={cn(
                          "w-full cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-sm",
                          chat.id === chatId ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
                        )}
                        onClick={() => setChatId(chat.id)}
                      >
                        {chat.title}
                      </button>
                    </li>
                  ))}
                  {!visibleChats.length && <li className={pageShell.subtitle}>No sessions match.</li>}
                </ul>
              </>
            )}
            <div className="flex flex-col gap-2">
              <IconTip label="New subject">
                <Button type="button" variant="secondary" size={sideOpen ? "sm" : "icon"} aria-label="New subject" onClick={() => setSubjectOpen(true)}>
                  <Plus />
                  {sideOpen && "Subject"}
                </Button>
              </IconTip>
              <IconTip label="New session">
                <Button type="button" variant="outline" size={sideOpen ? "sm" : "icon"} aria-label="New session" disabled={!projectId || busy} onClick={() => void onCreateChat()}>
                  <BookOpen />
                  {sideOpen && "Session"}
                </Button>
              </IconTip>
              <IconTip label="Settings">
                <Button type="button" variant="ghost" size={sideOpen ? "sm" : "icon"} aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                  <SettingsIcon />
                  {sideOpen && "Settings"}
                </Button>
              </IconTip>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
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
            <div className="min-w-0 flex-1">
              <h1 className={cn(pageShell.title, "truncate text-base")}>{project?.title ?? "tidyai"}</h1>
              <p className={cn(pageShell.subtitle, "truncate")}>{session?.title ?? "Pick a session or start one."}</p>
            </div>
            {active && <span className="tag-blue hidden md:inline">{active.label}</span>}
            {status && <Badge variant="secondary" className="hidden sm:inline-flex">{status}</Badge>}
            <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={!projectId}>
                  Session
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sessions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {chats.map((chat) => (
                  <DropdownMenuItem key={chat.id} onSelect={() => setChatId(chat.id)}>
                    {chat.id === chatId && <Check />}
                    {chat.title}
                  </DropdownMenuItem>
                ))}
                {!chats.length && <DropdownMenuItem disabled>No sessions yet</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy} onSelect={() => void onCreateChat()}>
                  New session
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

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1">
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
                  {dbDown && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="alert">
                      <span>Database is not running. Start it with docker compose up -d.</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => void reloadHealth()}>
                        Retry
                      </Button>
                    </div>
                  )}
                  {error && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                      <span>{error}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => setError("")}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {!project && !dbDown && (
                    <section className={pageShell.section}>
                      <h2 className={pageShell.title}>Start a subject</h2>
                      <p className={cn(pageShell.subtitle, "mt-1")}>A subject holds sessions and the notes those sessions write.</p>
                      <Button type="button" className="mt-4" onClick={() => setSubjectOpen(true)}>
                        <Plus /> New subject
                      </Button>
                    </section>
                  )}
                  {project && !chatId && (
                    <section className={pageShell.section}>
                      <h2 className={pageShell.title}>No session yet</h2>
                      <p className={cn(pageShell.subtitle, "mt-1")}>A session is one study conversation. Notes stay on the subject.</p>
                      <Button type="button" className="mt-4" onClick={() => void onCreateChat()}>
                        <Plus /> New session
                      </Button>
                    </section>
                  )}
                  {chatId && !messages.length && !streaming && (
                    <section className={pageShell.section}>
                      <h2 className="text-base font-medium tracking-tight">Ask something about {project?.title}</h2>
                      <p className={cn(pageShell.subtitle, "mt-1")}>
                        The current page is already in the prompt. The model can search older notes when it needs them.
                      </p>
                    </section>
                  )}
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={cn(
                        "rounded-xl border px-4 py-3 shadow-sm",
                        message.role === "user" ? "ml-8 border-transparent bg-secondary" : "mr-8 bg-card/80",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "Session"}</span>
                        {message.role === "assistant" && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => void copyMessage(message)}>
                            {copiedId === message.id ? <Check /> : <Copy />}
                            {copiedId === message.id ? "Copied" : "Copy"}
                          </Button>
                        )}
                      </div>
                      {message.role === "assistant" ? (
                        <div className="text-sm leading-6">
                          <Streamdown plugins={{ math }}>{message.content}</Streamdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                      )}
                    </article>
                  ))}
                  {streaming && (
                    <article className="mr-8 rounded-xl border bg-card/80 px-4 py-3 shadow-sm" aria-live="polite">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">Session</span>
                      <div className="text-sm leading-6">
                        <Streamdown plugins={{ math }} isAnimating>
                          {streaming}
                        </Streamdown>
                      </div>
                    </article>
                  )}
                </div>
              </ScrollArea>
              <aside
                id="notes-pane"
                aria-label="Notes"
                className={cn(
                  "flex w-[min(360px,100%)] shrink-0 flex-col border-l bg-card/75 backdrop-blur",
                  "max-[960px]:absolute max-[960px]:inset-y-0 max-[960px]:right-0 max-[960px]:z-20 max-[960px]:shadow-lg",
                  !notesOpen && "hidden",
                )}
              >
                <div className="flex h-14 items-center justify-between gap-2 border-b px-3">
                  <h2 className="truncate text-sm font-medium">{project?.title ?? "Notes"}</h2>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNotesOpen(false)}>
                    Close
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col gap-3 p-3">
                    <ul className="flex flex-col gap-1">
                      {pages.map((page) => (
                        <li key={page.id} style={{ paddingLeft: page.depth * 12 }}>
                          <button
                            type="button"
                            aria-current={page.id === pageId ? "true" : undefined}
                            className={cn(
                              "w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-sm",
                              page.id === pageId ? "bg-accent-soft text-sidebar-accent-foreground" : "hover:bg-muted",
                            )}
                            onClick={() => setPageId(page.id)}
                          >
                            {page.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {blocks.map((block) => (
                      <BlockView key={block.id} block={block} onSave={onSaveBlock} onOpenPage={setPageId} />
                    ))}
                    {!blocks.length && <p className={pageShell.subtitle}>Notes from this session land here.</p>}
                  </div>
                </ScrollArea>
              </aside>
            </div>
            <form
              className="relative z-10 border-t bg-background/90 p-3 backdrop-blur sm:p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void onSend();
              }}
            >
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <label className="sr-only" htmlFor="draft">
                  Message
                </label>
                <Textarea
                  id="draft"
                  rows={2}
                  placeholder={active ? `Study ${project?.title ?? "a subject"}` : "Add a provider in Settings"}
                  value={draft}
                  disabled={!active || busy || !chatId}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void onSend();
                    }
                  }}
                />
                {busy ? (
                  <Button type="button" variant="destructive" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
                    <Square /> Stop
                  </Button>
                ) : (
                  <Button type="submit" disabled={!active || !chatId || !draft.trim()} aria-label="Send">
                    <Send /> Send
                  </Button>
                )}
              </div>
              <p className="mx-auto mt-2 max-w-3xl text-xs text-muted-foreground">Enter sends. Shift+Enter adds a line.</p>
            </form>
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
                <Button type="submit" disabled={!subjectName.trim()}>
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
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
