import { ThreadId, type OrchestrationV2Subagent } from "@t3tools/contracts";
import {
  projectedSubagentsToRuntime,
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  ArrowUpRightIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  GitBranchIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { ReadOnlySourcePreview } from "../files/AttachmentFilePreview";
import { AgentElapsed } from "./AgentElapsed";

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

function StatusMark({ status }: { status: WorkflowStatus }) {
  const Icon = status === "completed" ? CheckIcon : status === "failed" ? XIcon : MinusIcon;
  return isActiveSubagentStatus(status) ? (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "pending" ? "bg-muted-foreground/40" : "bg-info",
      )}
    />
  ) : (
    <Icon
      aria-hidden
      className={cn(
        "size-3 shrink-0",
        status === "completed"
          ? "text-success"
          : status === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
      )}
    />
  );
}

/** One workflow, with its parallel agents grouped by the provider's declared phases. */
export function WorkflowCard({
  agent,
  onOpenThread,
  inWorkflowThread = false,
}: {
  agent: OrchestrationV2Subagent;
  onOpenThread: (threadId: ThreadId) => void;
  inWorkflowThread?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const detailsId = useId();
  const { childThreadId } = agent;
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
  const activeMember = members.find((member) => isActiveSubagentStatus(member.status));
  const activePhase = phases.some((phase) => phase.index === selectedPhase)
    ? selectedPhase
    : activeMember
      ? (activeMember.phaseIndex ?? -1)
      : phases[0]?.index;
  const visibleMembers =
    phases.length === 0
      ? members
      : members.filter((member) => (member.phaseIndex ?? -1) === activePhase);
  const completed = members.filter((member) => member.status === "completed").length;
  const running = members.filter((member) => isActiveSubagentStatus(member.status)).length;
  const title = coordinator.workflowName ?? coordinator.title;
  const selectedTitle = phases.find((phase) => phase.index === activePhase)?.title;

  return (
    <section
      aria-label={`Workflow: ${title}`}
      data-workflow-card
      className="my-2 overflow-hidden rounded-xl border border-border/70 bg-card/30"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-4" />
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
          className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span>Workflow</span>
            <span aria-hidden>·</span>
            <StatusMark status={coordinator.status} />
            <span>{statusLabel(coordinator.status)}</span>
          </span>
          <span className="mt-1 block break-words text-sm font-medium text-foreground">
            {title}
          </span>
        </button>
        <span className="mt-0.5 shrink-0 text-2xs text-muted-foreground">
          <AgentElapsed agent={coordinator} />
        </span>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={expanded ? "Collapse workflow" : "Expand workflow"}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")}
          />
        </Button>
      </div>
      {expanded ? (
        <div id={detailsId}>
          {phases.length > 0 ? (
            <div
              aria-label="Workflow phases"
              className="flex flex-wrap gap-x-3 gap-y-2 border-y border-border/50 bg-muted/20 px-4 py-3"
            >
              {phases.map((phase, index) => {
                const phaseMembers = members.filter(
                  (member) => (member.phaseIndex ?? -1) === phase.index,
                );
                const settled = phaseMembers.filter(
                  (member) => member.status === "completed",
                ).length;
                const failed = phaseMembers.some((member) => member.status === "failed");
                const active = phaseMembers.some((member) => isActiveSubagentStatus(member.status));
                const done = phaseMembers.length > 0 && settled === phaseMembers.length;
                const selected = phase.index === activePhase;
                return (
                  <button
                    key={phase.index}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedPhase(phase.index)}
                    className={cn(
                      "group/phase min-w-24 flex-1 cursor-pointer rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring",
                      selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mb-2 block h-0.5 rounded-full",
                        failed
                          ? "bg-destructive"
                          : done
                            ? "bg-success/70"
                            : active
                              ? "bg-info"
                              : "bg-border",
                        selected && "ring-1 ring-current/10",
                      )}
                    />
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="text-3xs font-normal tabular-nums text-muted-foreground/60">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {phase.title}
                    </span>
                    <span className="mt-1 block text-3xs text-muted-foreground">
                      {phaseMembers.length > 0
                        ? `${settled}/${phaseMembers.length} complete${failed ? " · failed" : active ? " · running" : ""}`
                        : isActiveSubagentStatus(coordinator.status)
                          ? "Upcoming"
                          : "No agents"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div
            className="px-2 py-2"
            aria-label={selectedTitle ? `${selectedTitle} agents` : "Workflow agents"}
          >
            {visibleMembers.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {isActiveSubagentStatus(coordinator.status)
                  ? "Waiting for agents in this phase."
                  : "No agents were reported for this phase."}
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {visibleMembers.map((member) => (
                  <li key={member.id}>
                    <WorkflowMember agent={member} onOpenThread={onOpenThread} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2">
            <span className="text-3xs text-muted-foreground">
              {members.length === 0
                ? isActiveSubagentStatus(coordinator.status)
                  ? "Agents will appear as they start"
                  : "No agents reported"
                : `${completed} of ${members.length} agents complete${running > 0 ? ` · ${running} active` : ""}`}
            </span>
            <div className="flex items-center gap-1">
              {agent.prompt ? (
                <Button size="xs" variant="ghost-muted" onClick={() => setScriptOpen(true)}>
                  <CodeIcon aria-hidden className="size-3" />
                  View script
                </Button>
              ) : null}
              {!inWorkflowThread && childThreadId !== null ? (
                <Button size="xs" variant="ghost-muted" onClick={() => onOpenThread(childThreadId)}>
                  Open workflow
                  <ArrowUpRightIcon aria-hidden className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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

function WorkflowMember({
  agent,
  onOpenThread,
}: {
  agent: RuntimeSubagent;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const childThreadId = agent.childThreadId ? ThreadId.make(agent.childThreadId) : null;
  const content = (
    <>
      <span className="relative flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        <BotIcon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{agent.title}</span>
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
          {agent.model ?? statusLabel(agent.status)}
          {agent.attempt !== null && agent.attempt > 1 ? ` · attempt ${agent.attempt}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-3xs text-muted-foreground">
        <StatusMark status={agent.status} />
        <span>{statusLabel(agent.status)}</span>
      </span>
      <span className="min-w-8 shrink-0 text-right text-3xs tabular-nums text-muted-foreground">
        <AgentElapsed agent={agent} />
      </span>
      {agent.childThreadId ? (
        <ArrowUpRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
      ) : null}
    </>
  );
  const className = "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left";
  return childThreadId ? (
    <button
      type="button"
      aria-label={`Open ${agent.title}`}
      onClick={() => onOpenThread(childThreadId)}
      className={cn(
        className,
        "cursor-pointer hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
