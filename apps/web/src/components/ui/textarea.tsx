import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-10 w-full resize-none rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-sm shadow-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground focus-visible:border-ring/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
