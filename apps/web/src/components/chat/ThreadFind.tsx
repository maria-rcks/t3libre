import type { OrchestrationFindThreadResult, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface ThreadFindTarget {
  readonly messageId: NonNullable<OrchestrationFindThreadResult["match"]>["messageId"];
  readonly occurrence: number;
  readonly query: string;
  readonly key: string;
}

/** Queries persisted history, rather than the subset mounted by the virtual list. */
export function ThreadFind({
  threadRef,
  onTarget,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onTarget: (target: ThreadFindTarget | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const find = useAtomQueryRunner(orchestrationEnvironment.threadFind, {
    refresh: true,
    reportFailure: false,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => () => onTarget(null), [onTarget]);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(query.trim().length > 0);
    if (!query.trim()) {
      onTarget(null);
      setTotal(0);
      return;
    }
    const timer = window.setTimeout(() => {
      void find({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, query: query.trim(), index },
      }).then((result) => {
        if (cancelled) return;
        setLoading(false);
        if (result._tag === "Failure") {
          onTarget(null);
          setError("Could not search this conversation");
          setTotal(0);
          return;
        }
        setTotal(result.value.total);
        if (index >= result.value.total && result.value.total > 0) {
          setIndex(0);
          return;
        }
        onTarget(
          result.value.match
            ? {
                ...result.value.match,
                query: query.trim(),
                key: `${threadRef.threadId}:${query.trim()}:${index}`,
              }
            : null,
        );
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [find, index, onTarget, query, threadRef]);
  const move = (direction: -1 | 1) => {
    if (total > 0 && !loading) setIndex((current) => (current + direction + total) % total);
  };
  return (
    <div
      role="search"
      aria-label="Find in conversation"
      className="flex items-center gap-1 border-b border-border bg-background px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          move(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <div className="min-w-0 flex-1 max-w-sm">
        <Input
          ref={inputRef}
          size="compact"
          aria-label="Find in conversation"
          type="search"
          placeholder="Find in conversation"
          value={query}
          maxLength={200}
          onChange={(event) => {
            onTarget(null);
            setQuery(event.target.value);
            setIndex(0);
            setTotal(0);
          }}
        />
      </div>
      <span
        role="status"
        aria-live="polite"
        className="min-w-14 text-center text-xs text-muted-foreground tabular-nums"
      >
        {error ?? (loading ? "Searching…" : `${total ? index + 1 : 0} of ${total}`)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={total === 0 || loading}
        onClick={() => move(-1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={total === 0 || loading}
        onClick={() => move(1)}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close find"
        title="Close find (Escape)"
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>
  );
}
