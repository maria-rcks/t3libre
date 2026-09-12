import type { SharedThread } from "@t3tools/contracts";
import { ChevronRightIcon, TerminalIcon } from "lucide-react";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { shouldPreserveAssistantLineBreaks } from "./MessagesTimeline.logic";

export function SharedConversation({ share }: { share: SharedThread }) {
  const entries = [
    ...share.messages.map((message) => ({ type: "message" as const, ...message })),
    ...share.tools.map((tool) => ({ type: "tool" as const, ...tool })),
    ...share.plans.map((plan) => ({ type: "plan" as const, ...plan })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="min-w-0 space-y-4">
      {entries.map((entry) =>
        entry.type === "message" ? (
          <article
            key={`message:${entry.id}`}
            aria-label={entry.role === "user" ? "You" : "Assistant"}
            className={
              entry.role === "user"
                ? "flex flex-col items-end pb-4"
                : "relative min-w-0 px-1 py-0.5"
            }
          >
            <div
              className={
                entry.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground"
                  : undefined
              }
            >
              <ChatMarkdown
                text={entry.text}
                cwd={undefined}
                readOnly
                lineBreaks={entry.role === "user" || shouldPreserveAssistantLineBreaks(entry.text)}
                parseRawHtml={false}
                className={entry.role === "user" ? "text-message-foreground" : ""}
              />
            </div>
          </article>
        ) : entry.type === "tool" ? (
          <Collapsible key={`tool:${entry.id}`} className="rounded-md px-0.5 py-0.5">
            <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md text-left text-sm leading-relaxed text-secondary-label transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
              <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
                <TerminalIcon className="size-4 stroke-[1.8]" />
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.name.replaceAll("_", " ")}</span>
              <ChevronRightIcon className="size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200 group-data-panel-open:rotate-90 motion-reduce:transition-none" />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="ms-7 mt-1 space-y-3 rounded-md bg-muted/40 px-3 py-2">
                {entry.input !== undefined && (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Input</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-[length:var(--font-size-code,0.6875rem)] leading-relaxed select-text">
                      {entry.input}
                    </pre>
                  </div>
                )}
                {entry.result !== undefined && (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Result</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-[length:var(--font-size-code,0.6875rem)] leading-relaxed select-text">
                      {entry.result}
                    </pre>
                  </div>
                )}
                {entry.input === undefined && entry.result === undefined && (
                  <p className="text-xs text-muted-foreground">Tool details were not included.</p>
                )}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : (
          <article
            key={`plan:${entry.id}`}
            className="rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5"
          >
            <Badge variant="secondary">Plan</Badge>
            <ChatMarkdown
              text={entry.text}
              cwd={undefined}
              readOnly
              parseRawHtml={false}
              className="mt-4"
            />
          </article>
        ),
      )}
    </div>
  );
}
