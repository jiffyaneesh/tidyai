import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export function Toaster({ theme = "system", ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      richColors
      gap={10}
      toastOptions={{
        classNames: {
          toast:
            "rounded-[11px] border border-border bg-card text-card-foreground shadow-soft !font-[family-name:var(--font-sans)]",
          title: "text-[0.8125rem] font-semibold tracking-[-0.01em]",
          description: "text-[0.75rem] text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
          closeButton: "border-border bg-card text-foreground",
        },
      }}
      {...props}
    />
  );
}
