import { useState } from "react";

const PROJECTS = ["Mechanics", "Organic chemistry"];
const NOTES = [
  { id: "torque", title: "Torque", depth: 0 },
  { id: "newton", title: "Newton's second law", depth: 1 },
];

export function App() {
  const [sideOpen, setSideOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [project, setProject] = useState(PROJECTS[0]);
  const [draft, setDraft] = useState("");

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
        <ul id="project-nav" className="nav-list">
          {PROJECTS.map((name) => (
            <li key={name}>
              <button
                type="button"
                aria-current={name === project ? "page" : undefined}
                aria-label={name}
                onClick={() => setProject(name)}
              >
                {sideOpen ? name : name.slice(0, 1)}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat">
        <div className="thread">
          <div className="column">
            <article className="msg user">
              <span className="who">You</span>
              <div className="body">What is torque, in one sitting?</div>
            </article>
            <article className="msg">
              <span className="who">Session · {project}</span>
              <div className="body">
                <p>Torque is the turning effect of a force about a point.</p>
                <p>τ = r × F. Direction follows the right-hand rule.</p>
              </div>
            </article>
          </div>
        </div>
        <div className="composer">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setDraft("");
            }}
          >
            <label className="sr" htmlFor="draft">
              Message
            </label>
            <textarea
              id="draft"
              rows={1}
              placeholder={`Study ${project}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  setDraft("");
                }
              }}
            />
            <button className="send" type="submit">
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
          <h2>{project}</h2>
          <button className="icon-btn" type="button" onClick={() => setNotesOpen(false)}>
            Close
          </button>
        </div>
        <div className="note-body">
          <ul className="note-list">
            {NOTES.map((note) => (
              <li key={note.id} style={{ paddingLeft: note.depth * 12 }}>
                <button type="button" aria-current={note.id === "torque" ? "true" : undefined}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
          <h3>Torque</h3>
          <p>Turning effect of a force about a point. τ = r × F.</p>
        </div>
      </aside>
    </div>
  );
}
