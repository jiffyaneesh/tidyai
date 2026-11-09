import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PROVIDER_PRESETS, presetById } from "./lib/provider-presets";
import { profileError, type Profile } from "./vault";

const EMPTY: Profile = {
  id: "",
  label: "",
  protocol: "openai_chat",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  patchModel: "",
  apiKey: "",
  embeddingModel: "text-embedding-3-small",
  embeddingBaseUrl: "",
  embeddingKey: "",
};

function matchPreset(profile: Profile): string {
  const hit = PROVIDER_PRESETS.find(
    (item) => item.id !== "custom" && item.protocol === profile.protocol && item.baseUrl === profile.baseUrl.trim(),
  );
  return hit?.id ?? "custom";
}

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
  const [presetId, setPresetId] = useState("openai");
  const [customModel, setCustomModel] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");

  const preset = presetById(presetId);
  const modelInList = preset.models.includes(draft.model);

  function startNew() {
    const next = presetById("openai");
    setDraft({
      ...EMPTY,
      label: next.label,
      protocol: next.protocol,
      baseUrl: next.baseUrl,
      model: next.models[0] ?? "",
      embeddingModel: next.embeddingModel ?? "",
    });
    setPresetId("openai");
    setCustomModel(false);
    setAdvanced(false);
    setError("");
  }

  function editProfile(profile: Profile) {
    const id = matchPreset(profile);
    const matched = presetById(id);
    setDraft({
      ...profile,
      embeddingModel: profile.embeddingModel ?? "",
      embeddingBaseUrl: profile.embeddingBaseUrl ?? "",
      embeddingKey: profile.embeddingKey ?? "",
    });
    setPresetId(id);
    setCustomModel(id === "custom" || !matched.models.includes(profile.model));
    setAdvanced(Boolean(profile.patchModel || profile.embeddingBaseUrl || profile.embeddingKey));
    setError("");
  }

  function applyPreset(id: string) {
    const next = presetById(id);
    setPresetId(id);
    setCustomModel(id === "custom" || next.models.length === 0);
    setDraft((current) => ({
      ...current,
      label: current.label.trim() || next.label,
      protocol: next.protocol,
      baseUrl: next.baseUrl,
      model: next.models[0] ?? current.model,
      embeddingModel: next.embeddingModel ?? (id === "custom" ? current.embeddingModel : ""),
    }));
  }

  function saveDraft() {
    const problem = profileError(draft);
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }
    const id = draft.id || crypto.randomUUID();
    const next = profiles.some((profile) => profile.id === id)
      ? profiles.map((profile) => (profile.id === id ? { ...draft, id } : profile))
      : [...profiles, { ...draft, id }];
    onChange(next, activeId || id);
    setDraft(EMPTY);
    setPresetId("openai");
    setCustomModel(false);
    setAdvanced(false);
    setError("");
    toast.success(`Saved “${draft.label.trim() || "provider"}”.`);
  }

  const editing = Boolean(draft.label || draft.apiKey || draft.id || draft.model !== EMPTY.model);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Providers</DialogTitle>
          <DialogDescription>
            Pick a host, a model, and paste the key. The key stays in this browser.
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
              <Button type="button" variant="outline" size="sm" onClick={() => editProfile(profile)}>
                Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  const next = profiles.filter((item) => item.id !== profile.id);
                  onChange(next, activeId === profile.id ? next[0]?.id ?? "" : activeId);
                  if (draft.id === profile.id) startNew();
                }}
              >
                Delete
              </Button>
            </li>
          ))}
          {!profiles.length && <li className="text-[0.79rem] text-muted-foreground">No providers yet. Add one below.</li>}
        </ul>
        {!editing ? (
          <Button type="button" variant="outline" onClick={startNew}>
            Add provider
          </Button>
        ) : (
          <div className="grid gap-3">
            <Field label="Name">
              <Input
                aria-label="Name"
                value={draft.label}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
            </Field>
            <Field label="Provider">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full justify-between font-normal"
                    aria-label="Provider"
                  >
                    {preset.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  {PROVIDER_PRESETS.map((item) => (
                    <DropdownMenuItem key={item.id} onSelect={() => applyPreset(item.id)}>
                      {presetId === item.id && <Check />}
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Field>
            {presetId === "custom" && (
              <Field label="Base URL">
                <Input
                  aria-label="Base URL"
                  value={draft.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                />
              </Field>
            )}
            <Field label="Model">
              {customModel || preset.models.length === 0 ? (
                <Input
                  aria-label="Model"
                  value={draft.model}
                  placeholder="model id"
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full justify-between font-normal"
                      aria-label="Model"
                    >
                      {modelInList ? draft.model : "Custom…"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    {preset.models.map((model) => (
                      <DropdownMenuItem key={model} onSelect={() => setDraft({ ...draft, model })}>
                        {draft.model === model && <Check />}
                        {model}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onSelect={() => setCustomModel(true)}>Custom…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </Field>
            <Field label="API key">
              <Input
                type="password"
                autoComplete="off"
                aria-label="API key"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </Field>
            <button
              type="button"
              className="flex items-center gap-1 text-left text-[0.79rem] text-muted-foreground"
              onClick={() => setAdvanced((open) => !open)}
              aria-expanded={advanced}
            >
              {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              Advanced
            </button>
            {advanced && (
              <div className="grid gap-3 border-t border-border/40 pt-3">
                <Field label="Note model">
                  <Input
                    aria-label="Note model"
                    value={draft.patchModel}
                    placeholder="Same as chat when empty"
                    onChange={(event) => setDraft({ ...draft, patchModel: event.target.value })}
                  />
                </Field>
                <Field label="Embedding model">
                  <Input
                    aria-label="Embedding model"
                    value={draft.embeddingModel}
                    placeholder="Optional. Leave empty for keyword search"
                    onChange={(event) => setDraft({ ...draft, embeddingModel: event.target.value })}
                  />
                </Field>
                <Field label="Embedding base URL">
                  <Input
                    aria-label="Embedding base URL"
                    value={draft.embeddingBaseUrl}
                    placeholder="Same as chat when empty"
                    onChange={(event) => setDraft({ ...draft, embeddingBaseUrl: event.target.value })}
                  />
                </Field>
                <Field label="Embedding key">
                  <Input
                    type="password"
                    autoComplete="off"
                    aria-label="Embedding key"
                    value={draft.embeddingKey}
                    placeholder="Same as chat key when empty"
                    onChange={(event) => setDraft({ ...draft, embeddingKey: event.target.value })}
                  />
                </Field>
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {editing && (
            <Button type="button" onClick={saveDraft}>
              Save profile
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm font-medium leading-none">{label}</Label>
      {children}
    </div>
  );
}
