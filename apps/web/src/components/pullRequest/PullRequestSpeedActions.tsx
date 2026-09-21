import type { PullRequestAction, PullRequestMergeMethod } from "@t3tools/contracts";
import { MessageSquareIcon } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "./pullRequestDetail.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";

export type PullRequestSpeedAction = Extract<PullRequestAction, "close" | "reopen" | "merge">;

/**
 * The actions a row offers while Shift is held: the ones a reader clears a list with, right on
 * the row, without opening it. Close and reopen go at once; merge asks, always, because it is
 * the one that cannot be taken back. They sit over the right end of the second line, where the
 * linked panel keeps its row menu, so the row keeps its width and nothing else moves.
 */
export function PullRequestSpeedActions({
  entry,
  shown,
  pending,
  onAct,
  onCloseWithComment,
}: {
  entry: EnvironmentPullRequestEntry;
  /** Shift is held. Not the whole story: an open comment keeps the buttons past its release. */
  shown: boolean;
  /** An action of this row's is still with the host: no second one until it answers. */
  pending: boolean;
  onAct: (entry: EnvironmentPullRequestEntry, action: PullRequestSpeedAction) => void;
  /** Resolves to whether the comment landed; the composer closes only when it did. */
  onCloseWithComment: (entry: EnvironmentPullRequestEntry, body: string) => Promise<boolean>;
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  // Typing the comment moves focus into a field and lets Shift go, both of which end speed
  // mode for the page; this row keeps its buttons while the composer is open so the anchor
  // does not vanish from under it.
  if (!shown && !commentOpen) return null;
  // Only for GitHub rows: the row does not carry what a host allows, and GitHub is the one
  // whose close, reopen and merge the page knows. The host still has the last word, and a
  // refusal takes the row's note back.
  if (entry.state === "merged" || entry.provider !== "github") return null;
  const act = (action: PullRequestSpeedAction) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onAct(entry, action);
  };
  return (
    <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 rounded-md bg-background py-1 pl-6 [mask-image:linear-gradient(to_right,transparent,black_1.25rem)]">
      <span aria-hidden className="absolute inset-0 -z-10 bg-accent/60" />
      {entry.state === "open" ? (
        <>
          {/* A stacked pull request merges through its stack, where the detail decides
              whether one layer may go alone; the row offers no lone merge for it. */}
          {entry.isDraft || entry.stack ? null : (
            <Button size="xs" variant="outline" disabled={pending} onClick={act("merge")}>
              <PullRequestGlyph.merged className="size-3.5" />
              Merge
            </Button>
          )}
          <Button size="xs" variant="destructive-outline" disabled={pending} onClick={act("close")}>
            <PullRequestGlyph.closed className="size-3.5" />
            Close
          </Button>
          <SpeedCloseWithComment
            entry={entry}
            open={commentOpen}
            pending={pending}
            onOpenChange={setCommentOpen}
            onSubmit={onCloseWithComment}
          />
        </>
      ) : (
        <Button size="xs" variant="outline" disabled={pending} onClick={act("reopen")}>
          <PullRequestGlyph.reopen className="size-3.5" />
          Reopen
        </Button>
      )}
    </span>
  );
}

/**
 * The one speed action that needs words: a close with a comment, written in a popover on the
 * row rather than the detail's composer. The text stays after a refusal so it can be sent again.
 */
function SpeedCloseWithComment({
  entry,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  entry: EnvironmentPullRequestEntry;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (entry: EnvironmentPullRequestEntry, body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || sending || pending) return;
    setSending(true);
    const posted = await onSubmit(entry, trimmed);
    setSending(false);
    if (posted) {
      setBody("");
      onOpenChange(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button size="xs" variant="destructive-outline" disabled={pending} />}
        // The row under it is a button: a click that reached it would open the detail.
        onClick={(event: MouseEvent) => event.stopPropagation()}
      >
        <MessageSquareIcon className="size-3.5" />
        Close with comment
      </PopoverTrigger>
      <PopoverPopup
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-2rem)]"
        initialFocus={textareaRef}
      >
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            size="sm"
            className="[&_textarea]:max-h-48"
            disabled={sending || pending}
            value={body}
            rows={3}
            placeholder="Leave a comment"
            aria-label={`Comment and close #${entry.number}`}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) void submit();
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={body.trim().length === 0 || sending || pending}
              onClick={() => void submit()}
            >
              <PullRequestGlyph.closed className="size-3.5" />
              {sending ? "Closing..." : "Comment and close"}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * The one confirmation speed mode keeps. The strategies come from the detail read, since the
 * row does not carry what the repository allows; until it answers the buttons wait.
 */
export function PullRequestSpeedMergeDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: EnvironmentPullRequestEntry | null;
  onClose: () => void;
  onConfirm: (entry: EnvironmentPullRequestEntry, method: PullRequestMergeMethod) => void;
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogPopup>
        {target ? <SpeedMergeBody target={target} onConfirm={onConfirm} /> : null}
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function SpeedMergeBody({
  target,
  onConfirm,
}: {
  target: EnvironmentPullRequestEntry;
  onConfirm: (entry: EnvironmentPullRequestEntry, method: PullRequestMergeMethod) => void;
}) {
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({
      environmentId: target.environmentId,
      input: {
        projectId: target.projectId,
        repository: target.repository,
        number: target.number,
        host: target.host,
      },
    }),
  );
  const detail = detailQuery.data;
  const methods = detail
    ? detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method])
    : [];
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Merge #{target.number}?</AlertDialogTitle>
        <AlertDialogDescription>
          {target.title}
          {detail && methods.length === 0 ? " This repository allows no merge strategy here." : ""}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" size="sm" />}>Cancel</AlertDialogClose>
        {detail ? (
          methods.map((method) => (
            <Button key={method} size="sm" onClick={() => onConfirm(target, method)}>
              {PULL_REQUEST_MERGE_METHOD_LABELS[method]}
            </Button>
          ))
        ) : (
          <Button size="sm" disabled>
            {detailQuery.error ? "Could not read the pull request" : "Reading…"}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}
