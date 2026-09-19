import type { PullRequestMergeability, PullRequestState } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { PullRequestConflictGlyph, PullRequestStateGlyph } from "./pullRequestPresentation";

/**
 * The one row shape both pull request lists share: the full page and a thread's linked panel.
 * A glyph, then two lines — number and title with the verdict, checks and diff counts on the
 * right; author, branches and the rest under them with the time on the right. The caller owns
 * the wrapper (a link on the panel, a button on the page) and hands in the slots.
 */
export const PULL_REQUEST_ROW_CLASS =
  "group/pr-row flex w-full items-center gap-2 rounded-md py-1 pr-1 text-left";

/** The wrapper's own block size, for `content-visibility` on the long page list. */
export const PULL_REQUEST_ROW_INTRINSIC_HEIGHT = "[contain-intrinsic-block-size:44px]";

export const PULL_REQUEST_ROW_NUMBER_CLASS =
  "shrink-0 font-mono text-xs tabular-nums text-muted-foreground";

/**
 * The conflict warning rides the corner of the lifecycle glyph, over the arrow's merge circle,
 * so the leading slot stays one icon wide and titles line up whether or not a row is blocked.
 * The background fill cuts it out of the glyph beneath.
 */
export function PullRequestRowGlyph({
  state,
  isDraft,
  mergeability,
  baseBranch,
}: {
  state: PullRequestState;
  isDraft: boolean;
  mergeability?: PullRequestMergeability | undefined;
  baseBranch?: string | undefined;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <PullRequestStateGlyph state={state} isDraft={isDraft} />
      {/* The wrapper takes the offset, not the icon, so the tooltip trigger inside keeps the
          badge's size and anchors the popup to it. */}
      <span className="absolute -right-1 -bottom-1 inline-flex">
        <PullRequestConflictGlyph
          state={state}
          isDraft={isDraft}
          {...(mergeability === undefined ? {} : { mergeability })}
          {...(baseBranch === undefined ? {} : { baseBranch })}
          className="size-3 fill-background [stroke-width:2.5]"
        />
      </span>
    </span>
  );
}

export function PullRequestRowLines({
  number,
  title,
  status,
  meta,
  metaClassName,
  updatedAt,
}: {
  /** The `#n` reference, already wrapped in whatever tooltip or menu the caller wants on it. */
  number: ReactNode;
  title: ReactNode;
  /** Right end of the first line: review verdict, checks, diff counts. */
  status?: ReactNode;
  /** Left of the second line: author, branches, labels. */
  meta?: ReactNode;
  metaClassName?: string;
  updatedAt?: string | null | undefined;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-1.5">
        {number}
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
        {status ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px]">{status}</span>
        ) : null}
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground",
          metaClassName,
        )}
      >
        {meta}
        {updatedAt ? (
          <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">
            {formatRelativeTimeLabel(updatedAt)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** `head → base`, in the mono the branches are typed in. */
export function PullRequestRowBranches({ head, base }: { head: string; base: string }) {
  return (
    <span className="truncate font-mono">
      {head} → {base}
    </span>
  );
}
