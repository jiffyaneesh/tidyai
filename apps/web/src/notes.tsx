import { useEffect, useRef, useState } from "react";
import katex from "katex";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "./api";

function Equation({ latex }: { latex: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    katex.render(latex || "", ref.current, { throwOnError: false, trust: false });
  }, [latex]);
  return <div ref={ref} />;
}

export function BlockView({
  block,
  onSave,
  onOpenPage,
}: {
  block: Block;
  onSave: (block: Block, payload: Record<string, unknown>) => Promise<void>;
  onOpenPage: (pageId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const payload = block.payload;
  const text = typeof payload.text === "string" ? payload.text : "";
  const latex = typeof payload.latex === "string" ? payload.latex : "";
  const editable = block.type !== "divider" && block.type !== "table" && block.type !== "child_page";

  async function save(next: Record<string, unknown>) {
    setError("");
    try {
      await onSave(block, next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this block.");
    }
  }

  if (block.type === "divider") return <hr className="border-border" />;
  if (block.type === "child_page") {
    const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
    const title = typeof payload.title === "string" ? payload.title : "Page";
    return (
      <Button type="button" variant="outline" size="sm" disabled={!pageId} onClick={() => pageId && onOpenPage(pageId)}>
        {title}
      </Button>
    );
  }
  if (block.type === "table" && Array.isArray(payload.rows)) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <tbody>
            {payload.rows.map((row, index) =>
              Array.isArray(row) ? (
                <tr key={index} className="border-b last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-2 py-1.5 align-top">
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {block.type === "equation" ? (
            <Equation latex={latex} />
          ) : block.type === "heading" ? (
            <h3 className="text-base font-medium tracking-tight">{text || "Empty block"}</h3>
          ) : block.type === "to_do" ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={payload.checked === true}
                onChange={(event) => void save({ text, checked: event.target.checked })}
              />
              <span>{text || "Empty block"}</span>
            </label>
          ) : (
            <p className="text-sm leading-6">{text || "Empty block"}</p>
          )}
        </div>
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(block.type === "equation" ? latex : text);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Textarea value={draft} rows={3} onChange={(event) => setDraft(event.target.value)} aria-label="Block text" />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() =>
            void save(
              block.type === "equation"
                ? { latex: draft }
                : block.type === "heading"
                  ? { text: draft, level: payload.level ?? 2 }
                  : block.type === "to_do"
                    ? { text: draft, checked: payload.checked === true }
                    : { text: draft },
            )
          }
        >
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
