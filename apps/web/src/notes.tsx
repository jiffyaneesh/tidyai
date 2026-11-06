import { useEffect, useRef, useState } from "react";
import katex from "katex";
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

  async function save() {
    setError("");
    const next =
      block.type === "equation"
        ? { latex: draft }
        : block.type === "heading"
          ? { text: draft, level: payload.level ?? 2 }
          : block.type === "to_do"
            ? { text: draft, checked: payload.checked === true }
            : { text: draft };
    try {
      await onSave(block, next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this block.");
    }
  }

  if (block.type === "divider") return <hr />;
  if (block.type === "child_page") {
    const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
    const title = typeof payload.title === "string" ? payload.title : "Page";
    return (
      <p>
        <button type="button" onClick={() => pageId && onOpenPage(pageId)}>
          {title}
        </button>
      </p>
    );
  }
  if (block.type === "table" && Array.isArray(payload.rows)) {
    return (
      <table>
        <tbody>
          {payload.rows.map((row, index) =>
            Array.isArray(row) ? (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{String(cell)}</td>
                ))}
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    );
  }
  if (block.type === "equation" && !editing) {
    return (
      <div className="block-row">
        <Equation latex={latex} />
        <button type="button" onClick={() => { setDraft(latex); setEditing(true); }}>
          Edit
        </button>
      </div>
    );
  }

  const Tag = block.type === "heading" ? "h3" : "p";
  if (!editing) {
    return (
      <div className="block-row">
        <Tag>{text || "Empty block"}</Tag>
        {editable && (
          <button type="button" onClick={() => { setDraft(text); setEditing(true); }}>
            Edit
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="block-edit">
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} />
      <button type="button" onClick={() => void save()}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <p className="banner">{error}</p>}
    </div>
  );
}
