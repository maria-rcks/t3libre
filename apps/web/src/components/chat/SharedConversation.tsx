import type { SharedThread } from "@t3tools/contracts";
import { FileTextIcon, TerminalIcon } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const SHARED_MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => <span className="text-muted-foreground">[image{alt ? `: ${alt}` : ""}]</span>,
};

/** Public markdown never resolves workspace paths or loads remote images. */
function SharedMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown min-w-0 text-sm leading-7 text-foreground/90 [overflow-wrap:anywhere] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-4 [&_table]:block [&_table]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={SHARED_MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function SharedConversation({ share }: { share: SharedThread }) {
  const entries = [
    ...share.messages.map((message) => ({ type: "message" as const, ...message })),
    ...share.tools.map((tool) => ({ type: "tool" as const, ...tool })),
    ...share.plans.map((plan) => ({ type: "plan" as const, ...plan })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="space-y-8">
      {entries.map((entry) =>
        entry.type === "message" ? (
          <article
            key={`message:${entry.id}`}
            className={
              entry.role === "user"
                ? "rounded-xl border border-border/60 bg-muted/30 px-5 py-4"
                : "px-1"
            }
          >
            <div className="mb-3 text-xs font-medium text-muted-foreground">
              {entry.role === "user" ? "You" : "Assistant"}
            </div>
            <SharedMarkdown text={entry.text} />
          </article>
        ) : entry.type === "tool" ? (
          <details
            key={`tool:${entry.id}`}
            className="group rounded-lg border border-border/70 text-sm"
          >
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-muted-foreground">
              <TerminalIcon className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span className="text-xs group-open:hidden">Show details</span>
            </summary>
            <div className="space-y-4 border-t border-border/60 p-4">
              {entry.input !== undefined && (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Input</p>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                    {entry.input}
                  </pre>
                </div>
              )}
              {entry.result !== undefined && (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Result</p>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                    {entry.result}
                  </pre>
                </div>
              )}
              {entry.input === undefined && entry.result === undefined && (
                <p className="text-xs text-muted-foreground">Tool details were not included.</p>
              )}
            </div>
          </details>
        ) : (
          <article key={`plan:${entry.id}`} className="rounded-lg border border-border p-5">
            <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <FileTextIcon className="size-3.5" />
              Plan
            </p>
            <SharedMarkdown text={entry.text} />
          </article>
        ),
      )}
    </div>
  );
}
