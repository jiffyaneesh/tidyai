import { useEffect, useRef } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import katex from "katex";
import { FileText, Sigma } from "lucide-react";

function EquationRender(props: {
  block: { props: { latex: string } };
  editor: { updateBlock: (block: unknown, update: { props: { latex: string } }) => void };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latex = props.block.props.latex || "";
  useEffect(() => {
    if (!ref.current) return;
    katex.render(latex || "\\,", ref.current, {
      throwOnError: false,
      trust: false,
      displayMode: true,
    });
  }, [latex]);
  return (
    <div className="bn-equation rounded-xl border border-border/50 bg-muted/30 px-3 py-2" contentEditable={false}>
      <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        <Sigma className="size-3" aria-hidden /> Equation
      </div>
      <div ref={ref} className="overflow-x-auto py-1" />
      <input
        className="mt-2 w-full rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-xs"
        value={latex}
        aria-label="LaTeX"
        placeholder="\\tau = r F \\sin\\theta"
        onChange={(event) => {
          props.editor.updateBlock(props.block, {
            props: { latex: event.target.value },
          });
        }}
      />
    </div>
  );
}

const createEquation = createReactBlockSpec(
  {
    type: "equation",
    propSchema: {
      latex: { default: "" },
    },
    content: "none",
  },
  {
    render: EquationRender as never,
  },
);

function ChildPageRender(props: {
  block: { props: { title: string; pageId: string } };
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-3 py-2 text-left text-sm font-medium"
      contentEditable={false}
      onClick={() => {
        const pageId = props.block.props.pageId;
        if (!pageId) return;
        window.dispatchEvent(new CustomEvent("tidyai:open-page", { detail: { pageId } }));
      }}
    >
      <FileText className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="truncate">{props.block.props.title || "Page"}</span>
    </button>
  );
}

const createChildPage = createReactBlockSpec(
  {
    type: "child_page",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      title: { default: "Page" },
      pageId: { default: "" },
    },
    content: "none",
  },
  {
    render: ChildPageRender as never,
  },
);

const {
  audio: _audio,
  video: _video,
  file: _file,
  image: _image,
  ...noteDefaults
} = defaultBlockSpecs;

export const notesSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...noteDefaults,
    equation: createEquation(),
    child_page: createChildPage(),
  },
});
