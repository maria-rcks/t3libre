import { useMemo, useState, type ReactNode } from "react";
import { visualizationDocument } from "../../html-visualization";
import { Button } from "../ui/button";

export function HtmlVisualization({
  html,
  title,
  dark,
  children,
}: {
  html: string;
  title: string;
  dark: boolean;
  children: ReactNode;
}) {
  const [showSource, setShowSource] = useState(false);
  const [generation, setGeneration] = useState(0);
  const document = useMemo(() => visualizationDocument(html, dark), [html, dark]);
  return (
    <div className="my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-secondary">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{title}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowSource((value) => !value)}
            aria-pressed={showSource}
          >
            {showSource ? "Show visualization" : "Show source"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setGeneration((value) => value + 1)}
            disabled={showSource}
          >
            Reset
          </Button>
        </span>
      </div>
      {showSource ? (
        children
      ) : (
        <iframe
          key={generation}
          title={title}
          srcDoc={document}
          sandbox=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block h-96 w-full border-0 bg-background"
        />
      )}
    </div>
  );
}
