import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * Truncates in the middle, the way Finder does, for strings that carry meaning at both ends:
 * branch names, paths, worktree names, shas. A tail-cut `fix/cache-main-20260918-180825` loses
 * the date that tells two branches apart; a path loses its file name.
 *
 * CSS has no middle ellipsis, so the string is split into a head that truncates and a tail
 * that does not. No measuring and no observers, so it costs the same as `truncate` in a long
 * list and works inside `content-visibility` skipping. Both halves are real text: selection
 * and copy give the whole string, and a screen reader reads it through.
 */
export function MiddleTruncate({
  value,
  tail,
  showTitle = true,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  value: string;
  /** Characters kept at the end. Defaults to the last path segment, capped, or 10. */
  tail?: number;
  /** The full value on hover. Off where a tooltip already carries it. */
  showTitle?: boolean;
}) {
  const split = splitForMiddleTruncate(value, tail);
  return (
    <span
      {...(showTitle ? { title: value } : {})}
      className={cn("inline-flex min-w-0 max-w-full whitespace-nowrap", className)}
      {...props}
    >
      {split ? (
        <>
          <span className="min-w-0 truncate">{split.head}</span>
          <span className="shrink-0">{split.tail}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{value}</span>
      )}
    </span>
  );
}

const DEFAULT_TAIL = 10;
const MAX_SEGMENT_TAIL = 16;

/**
 * Where to cut. A path keeps its last segment when that is short enough to be the useful
 * part; anything else keeps a fixed count. Nothing is split when the tail would be most of
 * the string, since then the head could never show enough to be worth an ellipsis.
 */
export function splitForMiddleTruncate(
  value: string,
  tail?: number,
): { head: string; tail: string } | null {
  let keep = tail ?? DEFAULT_TAIL;
  if (tail === undefined) {
    const slash = value.lastIndexOf("/");
    if (slash > 0 && slash < value.length - 1) {
      const segment = value.length - slash - 1;
      keep = segment <= MAX_SEGMENT_TAIL ? segment : DEFAULT_TAIL;
    }
  }
  if (keep <= 0 || value.length <= keep + 4) return null;
  return { head: value.slice(0, value.length - keep), tail: value.slice(value.length - keep) };
}
