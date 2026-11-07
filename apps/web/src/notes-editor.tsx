import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { blocksEqual, fromBlockNote, toBlockNote, type TidyaiBlock } from "@/lib/block-mapper";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { notesSchema } from "./notes-schema";
import type { Block } from "./api";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function NotesEditor({
  projectId,
  pageId,
  blocks,
  revision,
  onSaved,
  onSave,
  onDirty,
  className,
}: {
  projectId: string;
  pageId: string;
  blocks: Block[];
  revision: number;
  onSaved: (blocks: Block[]) => void;
  onSave: (projectId: string, pageId: string, blocks: TidyaiBlock[]) => Promise<Block[]>;
  onDirty?: () => void;
  className?: string;
}) {
  const { theme } = useTheme();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<TidyaiBlock[]>(
    blocks.map((block) => ({ id: block.id, type: block.type, payload: block.payload })),
  );

  const initial = toBlockNote(
    blocks.map((block) => ({ id: block.id, type: block.type, payload: block.payload })),
  );

  const editor = useCreateBlockNote(
    {
      schema: notesSchema,
      initialContent: initial as never,
    },
    [pageId, revision],
  );

  async function flush(doc = editor.document) {
    const mapped = fromBlockNote(doc as never);
    if (blocksEqual(mapped, lastSavedRef.current)) {
      dirtyRef.current = false;
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    setError("");
    try {
      const saved = await onSave(projectId, pageId, mapped);
      lastSavedRef.current = saved.map((block) => ({
        id: block.id,
        type: block.type,
        payload: block.payload,
      }));
      dirtyRef.current = false;
      setSaveState("saved");
      onSaved(saved);
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Could not save notes.");
    }
  }

  function scheduleSave() {
    dirtyRef.current = true;
    setSaveState("dirty");
    onDirty?.();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flush();
    }, 500);
  }

  const bootRef = useRef(true);
  useEditorChange(() => {
    // BlockNote can emit an initial change while hydrating. Skip that one.
    if (bootRef.current) {
      bootRef.current = false;
      return;
    }
    scheduleSave();
  }, editor);

  useEffect(() => {
    lastSavedRef.current = blocks.map((block) => ({
      id: block.id,
      type: block.type,
      payload: block.payload,
    }));
  }, [pageId, revision, blocks]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    function onHide() {
      if (dirtyRef.current) void flush();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
    // flush closes over the latest editor; rebind when page changes.
  }, [pageId, revision, editor]);

  const label =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "dirty"
          ? "Editing…"
          : saveState === "error"
            ? "Save failed"
            : "Ready";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}>
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
        <p className="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Page</p>
        <p
          className={cn(
            "text-[0.68rem] uppercase tracking-wide",
            saveState === "error" ? "text-destructive" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {label}
        </p>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-2 px-3 pb-2" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            className="shrink-0 text-[0.79rem] font-medium text-foreground underline-offset-2 hover:underline"
            onClick={() => void flush()}
          >
            Retry
          </button>
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-background px-1 pb-4"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dirtyRef.current) {
            if (timerRef.current) window.clearTimeout(timerRef.current);
            void flush();
          }
        }}
      >
        <BlockNoteView
          editor={editor}
          theme={theme === "dark" ? "dark" : "light"}
          className="bn-tidyai min-h-[12rem] bg-background"
        />
      </div>
    </div>
  );
}
