import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";

export function PanelAnimationsPreview({ enabled }: { enabled: boolean }) {
  const [panelsOpen, setPanelsOpen] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setPanelsOpen(enabled));
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return (
    <button
      type="button"
      aria-label="Replay panel animation preview"
      className="flex h-11 w-24 cursor-pointer overflow-hidden rounded-lg border border-border bg-background p-1 shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      onClick={() => setPanelsOpen((open) => !open)}
    >
      <span
        aria-hidden
        className={cn(
          "h-full shrink-0 rounded-sm bg-sidebar transition-[width] duration-200 ease-out motion-reduce:transition-none",
          panelsOpen ? "w-5" : "w-1",
        )}
      />
      <span aria-hidden className="flex min-w-0 flex-1 flex-col gap-1 px-1 pt-1.5">
        <span className="h-0.5 w-full rounded-full bg-muted-foreground/30" />
        <span className="h-0.5 w-4/5 rounded-full bg-muted-foreground/20" />
        <span className="h-0.5 w-3/5 rounded-full bg-muted-foreground/20" />
      </span>
      <span
        aria-hidden
        className={cn(
          "h-full shrink-0 rounded-sm bg-muted transition-[width] duration-200 ease-out motion-reduce:transition-none",
          panelsOpen ? "w-6" : "w-1",
        )}
      />
    </button>
  );
}
