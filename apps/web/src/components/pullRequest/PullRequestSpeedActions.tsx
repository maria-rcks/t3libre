import type { PullRequestAction } from "@t3tools/contracts";
import { useUiStateStore } from "~/uiStateStore";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolvePullRequestMergeMethod } from "./pullRequestDetail.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import {
  usePullRequestActionRunner,
  usePullRequestDefaultMergeMethodResolver,
} from "./usePullRequestActions";

export interface PullRequestSpeedActionResult {
  readonly entry: EnvironmentPullRequestEntry;
  readonly action: PullRequestAction;
}

/** No detail or stack reads until a merge is clicked, even on a long list. */
export function PullRequestSpeedActions({
  entry,
  visible,
  onActed,
  closing = false,
  sweeping = false,
  onCloseSweepStart,
}: {
  entry: EnvironmentPullRequestEntry;
  visible: boolean;
  onActed: (result: PullRequestSpeedActionResult) => void;
  closing?: boolean;
  sweeping?: boolean;
  onCloseSweepStart?: (entry: EnvironmentPullRequestEntry, event: PointerEvent) => void;
}) {
  const resolveProjectDefault = usePullRequestDefaultMergeMethodResolver(
    entry.environmentId,
    entry.projectId,
  );
  const reference = {
    projectId: entry.projectId,
    host: entry.host,
    repository: entry.repository,
    number: entry.number,
  };
  const { actionPending, perform } = usePullRequestActionRunner({
    environmentId: entry.environmentId,
    reference,
    onSuccess: (action) => onActed({ entry, action }),
    resolveMergeMethod: (detail) => {
      const allowed = detail.capabilities.mergeMethods.filter(
        (method) => detail.mergeCapabilities[method],
      );
      if (allowed.length === 0)
        throw new Error("No merge method is available for this repository.");
      return resolvePullRequestMergeMethod(
        allowed,
        null,
        resolveProjectDefault(),
        useUiStateStore.getState().pullRequestMergeMethod,
      );
    },
  });
  const actions =
    entry.state === "closed"
      ? (["reopen"] as const)
      : entry.isDraft
        ? (["close", "ready"] as const)
        : (["close", "merge"] as const);
  return (
    <div
      className="relative shrink-0 items-center gap-1 pr-3"
      style={{ display: visible || actionPending || closing || sweeping ? "flex" : "none" }}
      role="group"
      aria-label={`Quick actions for pull request #${entry.number}`}
      data-pull-request-action-pending={actionPending || closing}
    >
      {actions.map((action) => {
        const label = ACTIONS[action].label;
        const Icon = ACTIONS[action].Icon;
        return (
          <Tooltip key={action}>
            <TooltipTrigger
              render={
                <Button
                  variant={action === "close" ? "destructive-outline" : "outline"}
                  size="xs"
                  disabled={
                    closing || actionPending || (action === "merge" && entry.stack !== undefined)
                  }
                  aria-label={`${label} #${entry.number}`}
                  onClick={() => void perform(action)}
                  onPointerDown={(event) => {
                    if (action !== "close" || !event.isPrimary || event.button !== 0) return;
                    event.stopPropagation();
                    onCloseSweepStart?.(entry, event.nativeEvent);
                  }}
                  style={{ visibility: sweeping || closing ? "hidden" : undefined }}
                />
              }
            >
              {actionPending ? <Spinner size="xs" /> : <Icon aria-hidden className="size-3" />}
              {label}
            </TooltipTrigger>
            <TooltipPopup>
              {action === "merge" && entry.stack
                ? "Open this pull request to merge its stack"
                : action === "close"
                  ? "Close immediately, or drag across rows to close several"
                  : `${label} immediately`}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      {sweeping || closing ? (
        <span
          role="status"
          className="pointer-events-none absolute right-3 inline-flex h-5 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
        >
          {closing ? (
            <Spinner size="xs" />
          ) : (
            <PullRequestGlyph.closed aria-hidden className="size-3" />
          )}
          {closing ? "Closing" : "Close"}
        </span>
      ) : null}
    </div>
  );
}

const ACTIONS = {
  close: { label: "Close", Icon: PullRequestGlyph.closed },
  merge: { label: "Merge", Icon: PullRequestGlyph.merged },
  ready: { label: "Ready for review", Icon: PullRequestGlyph.pullRequest },
  reopen: { label: "Reopen", Icon: PullRequestGlyph.reopen },
} as const;
