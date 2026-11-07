/** Bridge tidyai Postgres blocks ↔ BlockNote documents. Lossless for allowlisted types. */

export type TidyaiBlock = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  pageId?: string;
  position?: number;
  version?: number;
};

export type BlockNoteDocBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockNoteDocBlock[];
};

function inlineText(text: string): { type: "text"; text: string; styles: Record<string, never> }[] {
  if (!text) return [];
  return [{ type: "text", text, styles: {} }];
}

function readInline(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const node = item as { type?: string; text?: string; content?: unknown };
    if (node.type === "text" && typeof node.text === "string") parts.push(node.text);
    else if (node.type === "link") parts.push(readInline(node.content));
  }
  return parts.join("");
}

function tableToBlockNote(id: string, rows: unknown): BlockNoteDocBlock {
  const grid = Array.isArray(rows)
    ? rows.filter(Array.isArray).map((row) => row.map((cell) => String(cell ?? "")))
    : [["", ""]];
  const width = Math.max(1, ...grid.map((row) => row.length));
  const normalized = grid.map((row) => {
    const cells = row.slice(0, width);
    while (cells.length < width) cells.push("");
    return cells;
  });
  if (!normalized.length) normalized.push(Array.from({ length: width }, () => ""));
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      columnWidths: Array.from({ length: width }, () => undefined),
      headerRows: normalized.length > 1 ? 1 : 0,
      rows: normalized.map((row) => ({
        cells: row.map((cell) => inlineText(cell)),
      })),
    },
  };
}

function tableFromBlockNote(content: unknown): string[][] {
  if (!content || typeof content !== "object") return [[""]];
  const rows = (content as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || !rows.length) return [[""]];
  return rows.map((row) => {
    const cells = row && typeof row === "object" ? (row as { cells?: unknown }).cells : null;
    if (!Array.isArray(cells)) return [""];
    return cells.map((cell) => {
      if (Array.isArray(cell)) return readInline(cell);
      if (cell && typeof cell === "object" && "content" in cell) {
        return readInline((cell as { content: unknown }).content);
      }
      return readInline(cell);
    });
  });
}

export function toBlockNote(blocks: TidyaiBlock[]): BlockNoteDocBlock[] {
  if (!blocks.length) {
    return [{ type: "paragraph", content: [] } as BlockNoteDocBlock];
  }
  return blocks.map((block) => {
    const text = typeof block.payload.text === "string" ? block.payload.text : "";
    switch (block.type) {
      case "heading": {
        const level = typeof block.payload.level === "number" ? block.payload.level : 2;
        return {
          id: block.id,
          type: "heading",
          props: { level: Math.min(3, Math.max(1, level)) },
          content: inlineText(text),
        };
      }
      case "bulleted_list_item":
        return { id: block.id, type: "bulletListItem", content: inlineText(text) };
      case "numbered_list_item":
        return { id: block.id, type: "numberedListItem", content: inlineText(text) };
      case "to_do":
        return {
          id: block.id,
          type: "checkListItem",
          props: { checked: block.payload.checked === true },
          content: inlineText(text),
        };
      case "callout":
        return { id: block.id, type: "quote", content: inlineText(text) };
      case "toggle":
        return { id: block.id, type: "toggleListItem", content: inlineText(text) };
      case "divider":
        return { id: block.id, type: "divider", content: undefined };
      case "equation":
        return {
          id: block.id,
          type: "equation",
          props: { latex: typeof block.payload.latex === "string" ? block.payload.latex : "" },
          content: undefined,
        };
      case "child_page":
        return {
          id: block.id,
          type: "child_page",
          props: {
            title: typeof block.payload.title === "string" ? block.payload.title : "Page",
            pageId: typeof block.payload.pageId === "string" ? block.payload.pageId : "",
          },
          content: undefined,
        };
      case "table":
        return tableToBlockNote(block.id, block.payload.rows);
      case "paragraph":
      default:
        return { id: block.id, type: "paragraph", content: inlineText(text) };
    }
  });
}

export function fromBlockNote(doc: BlockNoteDocBlock[]): TidyaiBlock[] {
  const out: TidyaiBlock[] = [];
  for (const block of doc) {
    const id = block.id || crypto.randomUUID();
    const text = readInline(block.content);
    switch (block.type) {
      case "heading": {
        const level = typeof block.props?.level === "number" ? block.props.level : 2;
        out.push({
          id,
          type: "heading",
          payload: { text, level: Math.min(3, Math.max(1, level)) },
        });
        break;
      }
      case "bulletListItem":
        out.push({ id, type: "bulleted_list_item", payload: { text } });
        break;
      case "numberedListItem":
        out.push({ id, type: "numbered_list_item", payload: { text } });
        break;
      case "checkListItem":
        out.push({
          id,
          type: "to_do",
          payload: { text, checked: block.props?.checked === true },
        });
        break;
      case "quote":
        out.push({ id, type: "callout", payload: { text } });
        break;
      case "toggleListItem":
        out.push({ id, type: "toggle", payload: { text } });
        if (Array.isArray(block.children)) {
          for (const child of fromBlockNote(block.children)) out.push(child);
        }
        break;
      case "divider":
        out.push({ id, type: "divider", payload: {} });
        break;
      case "equation":
        out.push({
          id,
          type: "equation",
          payload: { latex: typeof block.props?.latex === "string" ? block.props.latex : "" },
        });
        break;
      case "child_page": {
        const title = typeof block.props?.title === "string" ? block.props.title : "Page";
        const payload: Record<string, unknown> = { title };
        if (typeof block.props?.pageId === "string" && block.props.pageId) {
          payload.pageId = block.props.pageId;
        }
        out.push({ id, type: "child_page", payload });
        break;
      }
      case "table":
        out.push({ id, type: "table", payload: { rows: tableFromBlockNote(block.content) } });
        break;
      case "codeBlock":
        out.push({
          id,
          type: "paragraph",
          payload: { text: typeof block.content === "string" ? block.content : readInline(block.content) },
        });
        break;
      case "paragraph":
        out.push({ id, type: "paragraph", payload: { text } });
        break;
      default:
        if (text) out.push({ id, type: "paragraph", payload: { text } });
        break;
    }
  }
  return out;
}

export function blocksEqual(a: TidyaiBlock[], b: TidyaiBlock[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((block, index) => {
    const other = b[index];
    return (
      block.id === other.id &&
      block.type === other.type &&
      JSON.stringify(block.payload) === JSON.stringify(other.payload)
    );
  });
}
