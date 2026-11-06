import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Providers</DialogTitle>
          <DialogDescription>
            OpenAI-compatible covers OpenAI, Groq, Together, Ollama, and a local server. Gemini uses the native
            protocol. The key stays in this browser.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center gap-2">
              <Button
                type="button"
                variant={profile.id === activeId ? "secondary" : "ghost"}
                className="min-w-0 flex-1 justify-start"
                aria-current={profile.id === activeId ? "true" : undefined}
                onClick={() => onChange(profiles, profile.id)}
              >
                <span className="truncate">{profile.label}</span>
                {profile.id === activeId && <Badge variant="outline">Active</Badge>}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...profile, embeddingModel: profile.embeddingModel ?? "", embeddingBaseUrl: profile.embeddingBaseUrl ?? "", embeddingKey: profile.embeddingKey ?? "" })}>
                Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  const next = profiles.filter((item) => item.id !== profile.id);
                  onChange(next, activeId === profile.id ? next[0]?.id ?? "" : activeId);
                  if (draft.id === profile.id) setDraft(EMPTY);
                }}
              >
                Delete
              </Button>
            </li>
          ))}
          {!profiles.length && <li className="text-[0.79rem] text-muted-foreground">No providers yet. Add one below.</li>}
        </ul>
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
          </Field>
          <Field label="Protocol">
            <select
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={draft.protocol}
              onChange={(event) => setDraft({ ...draft, protocol: event.target.value as Protocol })}
            >
              <option value="openai_chat">OpenAI-compatible</option>
              <option value="gemini">Gemini</option>
            </select>
          </Field>
          <Field label="Base URL">
            <Input
              value={draft.baseUrl}
              placeholder="https://api.groq.com/openai/v1"
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            />
          </Field>
          <Field label="Model">
            <Input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </Field>
          <Field label="Note model">
            <Input
              value={draft.patchModel}
              placeholder="Optional cheaper model"
              onChange={(event) => setDraft({ ...draft, patchModel: event.target.value })}
            />
          </Field>
          <Field label="Embedding model">
            <Input
              value={draft.embeddingModel}
              placeholder="Optional. text-embedding-3-small"
              onChange={(event) => setDraft({ ...draft, embeddingModel: event.target.value })}
            />
          </Field>
          <Field label="Embedding base URL">
            <Input
              value={draft.embeddingBaseUrl}
              placeholder="Same as chat when empty"
              onChange={(event) => setDraft({ ...draft, embeddingBaseUrl: event.target.value })}
            />
          </Field>
          <Field label="Embedding key">
            <Input
              type="password"
              autoComplete="off"
              value={draft.embeddingKey}
              placeholder="Same as chat key when empty"
              onChange={(event) => setDraft({ ...draft, embeddingKey: event.target.value })}
            />
          </Field>
          <p className="text-[0.79rem] text-muted-foreground">Leave embedding empty for keyword search. The chat still runs.</p>
          <Field label="API key">
            <Input
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
          </Field>
        </div>
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={saveDraft}>
            Save profile
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-1.5">
      {label}
      {children}
    </Label>
  );
}
