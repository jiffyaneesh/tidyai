import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

type Edge = "left" | "right";

/**
 * Accessible pane resize: pointer drag, arrow keys (±8px / ±32 with Shift),
 * double-click resets. Parent owns clamp + persistence.
 */
export function ResizeHandle({
  edge,
  label,
  value,
  onChange,
  onCommit,
  onReset,
  className,
}: {
  edge: Edge;
  label: string;
  value: number;
  onChange: (next: number) => void;
  onCommit: (next: number) => void;
  onReset: () => void;
  className?: string;
}) {
  const start = useRef({ x: 0, width: 0 });

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: value };

    function onMove(move: PointerEvent) {
      const delta = edge === "right" ? move.clientX - start.current.x : start.current.x - move.clientX;
      onChange(start.current.width + delta);
    }

    function onUp(up: PointerEvent) {
      handle.releasePointerCapture(up.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const delta = edge === "right" ? up.clientX - start.current.x : start.current.x - up.clientX;
      onCommit(start.current.width + delta);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = edge === "right" ? value - step : value + step;
      onChange(next);
      onCommit(next);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = edge === "right" ? value + step : value - step;
      onChange(next);
      onCommit(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      onReset();
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      role="slider"
      tabIndex={0}
      className={cn(
        "absolute inset-y-0 z-10 flex w-3 items-center justify-center border-0 bg-transparent p-0",
        edge === "right" ? "right-0 translate-x-1/2 cursor-col-resize" : "left-0 -translate-x-1/2 cursor-col-resize",
        "before:block before:h-10 before:w-1 before:rounded-full before:bg-border before:transition-colors",
        "hover:before:bg-accent focus-visible:outline-none focus-visible:before:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
    />
  );
}
