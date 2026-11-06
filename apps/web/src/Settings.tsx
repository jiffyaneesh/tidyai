import { useState } from "react";
import { profileError, type Profile, type Protocol } from "./vault";

const EMPTY: Profile = {
  id: "",
  label: "",
  protocol: "openai_chat",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "",
  patchModel: "",
  apiKey: "",
  embeddingModel: "",
  embeddingBaseUrl: "",
  embeddingKey: "",
};

export function Settings({
  profiles,
  activeId,
  onClose,
  onChange,
}: {
  profiles: Profile[];
  activeId: string;
  onClose: () => void;
  onChange: (profiles: Profile[], activeId: string) => void;
}) {
  const [draft, setDraft] = useState<Profile>(EMPTY);
  const [error, setError] = useState("");

  function saveDraft() {
    const problem = profileError(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const id = draft.id || crypto.randomUUID();
    const next = profiles.some((profile) => profile.id === id)
      ? profiles.map((profile) => (profile.id === id ? { ...draft, id } : profile))
      : [...profiles, { ...draft, id }];
    onChange(next, activeId || id);
    setDraft(EMPTY);
    setError("");
  }

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="settings"
        role="dialog"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="settings-title">Providers</h2>
        <p className="hint">
          OpenAI-compatible covers OpenAI, Groq, Together, Ollama, and a local server. Gemini uses
          the native protocol. The key stays in this browser.
        </p>
        <ul className="nav-list">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                aria-current={profile.id === activeId ? "true" : undefined}
                onClick={() => onChange(profiles, profile.id)}
              >
                {profile.label}
              </button>
              <button type="button" onClick={() => setDraft(profile)}>
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = profiles.filter((item) => item.id !== profile.id);
                  onChange(next, activeId === profile.id ? next[0]?.id ?? "" : activeId);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <label>
          Name
          <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
        </label>
        <label>
          Protocol
          <select
            value={draft.protocol}
            onChange={(event) => setDraft({ ...draft, protocol: event.target.value as Protocol })}
          >
            <option value="openai_chat">OpenAI-compatible</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="https://api.groq.com/openai/v1"
          />
        </label>
        <label>
          Model
          <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
        </label>
        <label>
          Note model
          <input
            value={draft.patchModel}
            onChange={(event) => setDraft({ ...draft, patchModel: event.target.value })}
            placeholder="Optional cheaper model"
          />
        </label>
        <label>
          Embedding model
          <input
            value={draft.embeddingModel}
            onChange={(event) => setDraft({ ...draft, embeddingModel: event.target.value })}
            placeholder="Optional. text-embedding-3-small"
          />
        </label>
        <label>
          Embedding base URL
          <input
            value={draft.embeddingBaseUrl}
            onChange={(event) => setDraft({ ...draft, embeddingBaseUrl: event.target.value })}
            placeholder="Same as chat when empty"
          />
        </label>
        <label>
          Embedding key
          <input
            type="password"
            value={draft.embeddingKey}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, embeddingKey: event.target.value })}
            placeholder="Same as chat key when empty"
          />
        </label>
        <p className="hint">Leave embedding empty for keyword search. The chat still runs.</p>
        <label>
          API key
          <input
            type="password"
            value={draft.apiKey}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
        </label>
        {error && <p className="banner">{error}</p>}
        <div className="settings-actions">
          <button type="button" className="send" onClick={saveDraft}>
            Save profile
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
