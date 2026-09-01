import { useState } from "react";

import { cn } from "~/lib/utils";

export function PanelAnimationsPreview({ durationMs }: { durationMs: number }) {
  const [panelsOpen, setPanelsOpen] = useState(true);
  const animated = durationMs > 0;
  const transitionStyle = animated ? { transitionDuration: `${durationMs}ms` } : undefined;

  return (
    <button
      type="button"
      aria-label="Replay panel animation preview"
      className="flex h-32 w-full max-w-72 cursor-pointer overflow-hidden rounded-xl border border-border bg-background p-2 shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      onClick={() => setPanelsOpen((open) => !open)}
    >
      <span
        aria-hidden
        className={cn(
          "h-full shrink-0 overflow-hidden rounded-md bg-sidebar",
          animated
            ? "transition-[width] ease-out motion-reduce:transition-none"
            : "transition-none",
          panelsOpen ? "w-12" : "w-0",
        )}
        style={transitionStyle}
      />
      <span aria-hidden className="flex min-w-0 flex-1 flex-col px-2">
        <span className="flex min-h-0 flex-1 flex-col gap-1.5 pt-3">
          <span className="h-1 w-full rounded-full bg-muted-foreground/25" />
          <span className="h-1 w-4/5 rounded-full bg-muted-foreground/20" />
          <span className="h-1 w-3/5 rounded-full bg-muted-foreground/15" />
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center overflow-hidden bg-foreground/5 px-2",
            animated
              ? "transition-[height,border-width] ease-out motion-reduce:transition-none"
              : "transition-none",
            panelsOpen ? "h-9 border-t border-border/70" : "h-0 border-t-0",
          )}
          style={transitionStyle}
        >
          <span className="h-1 w-2/3 rounded-full bg-muted-foreground/25" />
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "h-full shrink-0 overflow-hidden rounded-md bg-muted",
          animated
            ? "transition-[width] ease-out motion-reduce:transition-none"
            : "transition-none",
          panelsOpen ? "w-14" : "w-0",
        )}
        style={transitionStyle}
      />
    </button>
  );
}
