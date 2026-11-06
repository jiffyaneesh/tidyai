import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { math } from "@streamdown/math";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
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
  const [sideOpen, setSideOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const active = profiles.find((profile) => profile.id === activeId) ?? null;
  const project = projects.find((item) => item.id === projectId) ?? null;

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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load projects."));
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

  async function onCreateProject() {
    const title = window.prompt("Subject name");
    if (!title?.trim()) return;
    const created = await createProject(title.trim());
    setProjects((current) => [...current, created]);
    setPageId("");
    setPages([]);
    setChatId("");
    setBlocks([]);
    setProjectId(created.id);
  }

  async function onCreateChat() {
    if (!projectId) return;
    const created = await createChat(projectId);
    setChats((current) => [...current, created]);
    setChatId(created.id);
    setMessages([]);
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
      );
      const [saved, sessions] = await Promise.all([listMessages(chatId), listChats(projectId)]);
      setStreaming("");
      setMessages(saved);
      setChats(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The turn failed.");
      try {
        setMessages(await listMessages(chatId));
      } catch {
        // The optimistic user line stays on screen.
      }
    } finally {
      setStreaming("");
      setBusy(false);
    }
  }

  async function onSaveBlock(block: Block, payload: Record<string, unknown>) {
    const saved = await patchBlock(block, payload);
    setBlocks((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  }

  return (
    <div className="workspace">
      <aside className={sideOpen ? "sidebar" : "sidebar closed"} aria-label="Projects">
        <div className="side-head">
          <button
            className="icon-btn"
            type="button"
            aria-expanded={sideOpen}
            aria-controls="project-nav"
            aria-label={sideOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSideOpen((open) => !open)}
          >
            {sideOpen ? "‹" : "›"}
          </button>
          {sideOpen && <h1>tidyai</h1>}
        </div>
        <div className="side-scroll" id="project-nav">
          <ul className="nav-list">
            {projects.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={item.id === projectId ? "page" : undefined}
                  aria-label={item.title}
                  onClick={() => {
                    if (item.id === projectId) return;
                    setProjectId(item.id);
                    setPageId("");
                    setPages([]);
                    setChatId("");
                    setBlocks([]);
                  }}
                >
                  {sideOpen ? item.title : item.title.slice(0, 1)}
                </button>
              </li>
            ))}
          </ul>
          {sideOpen && (
            <>
              <button className="text-btn" type="button" onClick={() => void onCreateProject()}>
                New subject
              </button>
              <p className="hint">Sessions</p>
              <ul className="nav-list">
                {chats.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      aria-current={chat.id === chatId ? "true" : undefined}
                      onClick={() => setChatId(chat.id)}
                    >
                      {chat.title}
                    </button>
                  </li>
                ))}
              </ul>
              <button className="text-btn" type="button" onClick={() => void onCreateChat()} disabled={!projectId}>
                New session
              </button>
              <button className="text-btn" type="button" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="chat">
        <div className="thread">
          <div className="column">
            {dbDown && <p className="banner">Database is not running. Start it with docker compose up -d.</p>}
            {error && <p className="banner">{error}</p>}
            {messages.map((message) => (
              <article key={message.id} className={message.role === "user" ? "msg user" : "msg"}>
                <span className="who">{message.role === "user" ? "You" : "Session"}</span>
                <div className="body">
                  {message.role === "assistant" ? (
                    <Streamdown plugins={{ math }}>{message.content}</Streamdown>
                  ) : (
                    message.content
                  )}
                </div>
              </article>
            ))}
            {streaming && (
              <article className="msg">
                <span className="who">Session</span>
                <div className="body">
                  <Streamdown plugins={{ math }} isAnimating>
                    {streaming}
                  </Streamdown>
                </div>
              </article>
            )}
            {status && <p className="hint">{status}</p>}
          </div>
        </div>
        <div className="composer">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onSend();
            }}
          >
            <label className="sr" htmlFor="draft">
              Message
            </label>
            <textarea
              id="draft"
              rows={1}
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
            <button className="send" type="submit" disabled={!active || busy || !chatId || !draft.trim()}>
              Send
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-expanded={notesOpen}
              aria-controls="notes-pane"
              onClick={() => setNotesOpen((open) => !open)}
            >
              {notesOpen ? "Hide notes" : "Notes"}
            </button>
          </form>
        </div>
      </main>

      <aside
        id="notes-pane"
        className={notesOpen ? "notes" : "notes closed"}
        aria-label="Notes"
        inert={!notesOpen ? true : undefined}
      >
        <div className="notes-head">
          <h2>{project?.title ?? "Notes"}</h2>
          <button className="icon-btn" type="button" onClick={() => setNotesOpen(false)}>
            Close
          </button>
        </div>
        <div className="note-body">
          <ul className="note-list">
            {pages.map((page) => (
              <li key={page.id} style={{ paddingLeft: page.depth * 12 }}>
                <button
                  type="button"
                  aria-current={page.id === pageId ? "true" : undefined}
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
          {!blocks.length && <p className="hint">Notes from this session land here.</p>}
        </div>
      </aside>

      {settingsOpen && (
        <Settings
          profiles={profiles}
          activeId={activeId}
          onClose={() => setSettingsOpen(false)}
          onChange={(next, id) => {
            setProfiles(next);
            setActiveId(id);
            saveActiveId(id);
            void saveProfiles(next);
          }}
        />
      )}
    </div>
  );
}
