import { ThreadId, type OrchestrationV2Subagent } from "@t3tools/contracts";
import {
  projectedSubagentsToRuntime,
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDotIcon,
  CircleIcon,
  CodeIcon,
  GitBranchIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { cn } from "~/lib/utils";
import { Button, InlineButton } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { ReadOnlySourcePreview } from "../files/AttachmentFilePreview";
import { AgentElapsed } from "./AgentElapsed";
import { ComposerBanner } from "./ComposerBanner";

type WorkflowStatus = RuntimeSubagent["status"];

function statusLabel(status: WorkflowStatus) {
  switch (status) {
    case "pending":
      return "Queued";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
    case "interrupted":
      return "Stopped";
    case "idle":
      return "Idle";
  }
}

function progressStatus(member: RuntimeSubagent) {
  if (member.status === "completed" || member.status === "failed") return member.status;
  return member.status !== "pending" && isActiveSubagentStatus(member.status)
    ? "inProgress"
    : "pending";
}

function StatusMark({ status }: { status: WorkflowStatus }) {
  const Icon =
    status === "completed"
      ? CheckIcon
      : status === "failed"
        ? XIcon
        : status === "pending"
          ? CircleIcon
          : isActiveSubagentStatus(status)
            ? CircleDotIcon
            : MinusIcon;
  return (
    <span
      className="flex size-3 shrink-0 items-center justify-center"
      aria-label={statusLabel(status)}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3",
          status === "completed"
            ? "text-muted-foreground"
            : status === "failed"
              ? "text-destructive"
              : status !== "pending" && isActiveSubagentStatus(status)
                ? "text-foreground/80"
                : "text-muted-foreground/40",
        )}
      />
    </span>
  );
}

/** The same ordered phase tree in the conversation and workspace lineage. */
export function WorkflowCard({
  agent,
  onOpenThread,
  inWorkflowThread = false,
  variant = "conversation",
  isThreadUnavailable,
}: {
  agent: OrchestrationV2Subagent;
  onOpenThread: (threadId: ThreadId) => void;
  inWorkflowThread?: boolean;
  variant?: "conversation" | "panel";
  isThreadUnavailable?: (threadId: ThreadId) => boolean;
}) {
  const panel = variant === "panel";
  const [expanded, setExpanded] = useState(!panel);
  const [scriptOpen, setScriptOpen] = useState(false);
  const detailsId = useId();
  const { childThreadId } = agent;
  const coordinatorUnavailable = childThreadId !== null && isThreadUnavailable?.(childThreadId);
  const runtime = projectedSubagentsToRuntime([agent]);
  const coordinator = runtime[0]!;
  const members = runtime.slice(1);
  const phaseMap = new Map(coordinator.phases.map((phase) => [phase.index, phase.title]));
  for (const member of members) {
    if (member.phaseIndex !== null && !phaseMap.has(member.phaseIndex)) {
      phaseMap.set(member.phaseIndex, member.phaseTitle ?? `Phase ${member.phaseIndex}`);
    }
  }
  const phases = [...phaseMap]
    .sort(([a], [b]) => a - b)
    .map(([index, title]) => ({ index, title }));
  if (members.some((member) => member.phaseIndex === null)) {
    phases.push({ index: -1, title: "Other agents" });
  }
  const completed = members.filter((member) => member.status === "completed").length;
  const activeMember = members.find((member) => isActiveSubagentStatus(member.status));
  const currentPhase = activeMember
    ? (activeMember.phaseIndex ?? -1)
    : phases.findLast((phase) =>
        members.some((member) => (member.phaseIndex ?? -1) === phase.index),
      )?.index;
  const title = coordinator.workflowName ?? coordinator.title;

  return (
    <section
      aria-label={`Workflow: ${title}`}
      data-workflow-card
      className={cn("min-w-0", !panel && "my-2")}
    >
      <ComposerBanner.Root placement={panel ? "inline" : "floating"}>
        <ComposerBanner.Row>
          <ComposerBanner.Icon>
            <GitBranchIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="block py-1">
            <div className="min-w-0">
              {panel && !inWorkflowThread && childThreadId !== null ? (
                <InlineButton
                  aria-label={`Open workflow: ${title}`}
                  disabled={coordinatorUnavailable}
                  onClick={coordinatorUnavailable ? undefined : () => onOpenThread(childThreadId)}
                  className="max-w-full"
                >
                  <span className="truncate">{title}</span>
                </InlineButton>
              ) : (
                <span className="block truncate font-medium text-foreground/80">{title}</span>
              )}
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground/70">
                <span>{statusLabel(coordinator.status)}</span>
                <AgentElapsed agent={coordinator} />
              </span>
            </div>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            {members.length > 0 ? (
              <ComposerBanner.Count
                aria-label={`${completed} of ${members.length} agents completed`}
              >
                {completed}/{members.length}
              </ComposerBanner.Count>
            ) : null}
            <ComposerBanner.Segments
              tone="neutral"
              className="@min-[560px]:w-20"
              statuses={members.map(progressStatus)}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={expanded ? "Collapse workflow" : "Expand workflow"}
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDownIcon aria-hidden className={cn("size-3.5", !expanded && "rotate-180")} />
            </Button>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        {expanded ? (
          <div id={detailsId}>
            <ComposerBanner.Children
              aria-label="Workflow phases"
              className={panel ? "ml-3 border-l border-border/65 pl-1" : undefined}
            >
              {phases.map((phase) => (
                <WorkflowPhase
                  key={`${agent.id}:${phase.index}`}
                  title={phase.title}
                  members={members.filter((member) => (member.phaseIndex ?? -1) === phase.index)}
                  coordinatorStatus={coordinator.status}
                  defaultExpanded={phase.index === currentPhase}
                  panel={panel}
                  onOpenThread={onOpenThread}
                  isThreadUnavailable={isThreadUnavailable}
                />
              ))}
              {phases.length === 0 ? (
                <p className="px-1 py-2 text-2xs text-muted-foreground">
                  {isActiveSubagentStatus(coordinator.status)
                    ? "Waiting for agents…"
                    : "No agents reported"}
                </p>
              ) : null}
            </ComposerBanner.Children>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
              {agent.prompt ? (
                <Button size="xs" variant="ghost-muted" onClick={() => setScriptOpen(true)}>
                  <CodeIcon aria-hidden className="size-3" />
                  View script
                </Button>
              ) : null}
              {!panel && !inWorkflowThread && childThreadId !== null ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  disabled={coordinatorUnavailable}
                  onClick={coordinatorUnavailable ? undefined : () => onOpenThread(childThreadId)}
                >
                  Open workflow
                  <ArrowUpRightIcon aria-hidden className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </ComposerBanner.Root>
      <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
        <DialogPopup className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Workflow script</DialogTitle>
          </DialogHeader>
          <div className="flex h-[70vh] min-h-0 flex-col">
            <ReadOnlySourcePreview name="workflow.js" text={agent.prompt} />
          </div>
        </DialogPopup>
      </Dialog>
    </section>
  );
}

function WorkflowPhase({
  title,
  members,
  coordinatorStatus,
  defaultExpanded,
  panel,
  onOpenThread,
  isThreadUnavailable,
}: {
  title: string;
  members: RuntimeSubagent[];
  coordinatorStatus: WorkflowStatus;
  defaultExpanded: boolean;
  panel: boolean;
  onOpenThread: (threadId: ThreadId) => void;
  isThreadUnavailable: ((threadId: ThreadId) => boolean) | undefined;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? defaultExpanded;
  const membersId = useId();
  const completed = members.filter((member) => member.status === "completed").length;
  const failed = members.some((member) => member.status === "failed");
  const active = members.some((member) => isActiveSubagentStatus(member.status));
  const summary =
    members.length > 0
      ? `${completed}/${members.length}${failed ? " · failed" : active ? " · active" : ""}`
      : isActiveSubagentStatus(coordinatorStatus)
        ? "Upcoming"
        : "No agents";
  return (
    <div>
      <ComposerBanner.Row
        render={<button type="button" />}
        aria-label={`${title}: ${summary}`}
        aria-expanded={expanded}
        aria-controls={membersId}
        onClick={() => setUserExpanded(!expanded)}
        className="py-1 pe-2 hover:bg-accent/30"
      >
        <ComposerBanner.Icon>
          <ChevronDownIcon className={cn(!expanded && "-rotate-90")} />
        </ComposerBanner.Icon>
        <ComposerBanner.Content>
          <span className="min-w-0 truncate font-medium text-foreground/80">{title}</span>
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          <ComposerBanner.Count>{summary}</ComposerBanner.Count>
          <ComposerBanner.Segments tone="neutral" statuses={members.map(progressStatus)} />
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
      {expanded ? (
        <ul id={membersId} aria-label={`${title} agents`} className="mb-1 ml-3 list-none">
          {members.map((member) => (
            <li key={member.id}>
              <WorkflowMember
                agent={member}
                panel={panel}
                onOpenThread={onOpenThread}
                unavailable={Boolean(
                  member.childThreadId &&
                  isThreadUnavailable?.(ThreadId.make(member.childThreadId)),
                )}
              />
            </li>
          ))}
          {members.length === 0 ? (
            <li className="px-1 py-2 text-2xs text-muted-foreground">
              {isActiveSubagentStatus(coordinatorStatus)
                ? "Waiting for agents in this phase."
                : "No agents were reported for this phase."}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function WorkflowMember({
  agent,
  panel,
  onOpenThread,
  unavailable,
}: {
  agent: RuntimeSubagent;
  panel: boolean;
  onOpenThread: (threadId: ThreadId) => void;
  unavailable?: boolean;
}) {
  const childThreadId = agent.childThreadId ? ThreadId.make(agent.childThreadId) : null;
  const content = (
    <>
      <ComposerBanner.Icon>
        <StatusMark status={agent.status} />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span
          className={cn(
            "min-w-0 truncate",
            agent.status === "completed" && "text-muted-foreground/55",
          )}
        >
          <span className="sr-only">{statusLabel(agent.status)}: </span>
          {agent.title}
        </span>
      </ComposerBanner.Content>
      <ComposerBanner.Actions>
        {agent.attempt !== null && agent.attempt > 1 ? (
          <span className="shrink-0 text-3xs text-muted-foreground">#{agent.attempt}</span>
        ) : null}
        {!panel && agent.model ? (
          <span className="max-w-28 truncate text-3xs text-muted-foreground">{agent.model}</span>
        ) : null}
        <span className="shrink-0 text-3xs tabular-nums text-muted-foreground">
          <AgentElapsed agent={agent} />
        </span>
        {childThreadId ? (
          <ArrowUpRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        ) : null}
      </ComposerBanner.Actions>
    </>
  );
  const className = "py-1 pe-2";
  const description = [
    statusLabel(agent.status),
    agent.model,
    agent.attempt && agent.attempt > 1 ? `Attempt ${agent.attempt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          childThreadId ? (
            <ComposerBanner.Row
              render={<button type="button" disabled={unavailable} />}
              aria-label={`Open ${agent.title}`}
              onClick={unavailable ? undefined : () => onOpenThread(childThreadId)}
              className={cn(
                className,
                "cursor-pointer hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent",
              )}
            />
          ) : (
            <ComposerBanner.Row className={className} tabIndex={0} />
          )
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipPopup>
        {agent.title} · {unavailable ? "This related thread is unavailable" : description}
      </TooltipPopup>
    </Tooltip>
  );
}
