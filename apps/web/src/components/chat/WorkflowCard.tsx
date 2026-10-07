import { ThreadId, type OrchestrationV2Subagent, type ServerProvider } from "@t3tools/contracts";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { ArrowUpRightIcon, ChevronDownIcon, CodeIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { ReadOnlySourcePreview } from "../files/AttachmentFilePreview";
import { WorkLogBlock } from "./WorkLog";
import {
  SubagentAvatar,
  SubagentElapsed,
  SubagentRow,
  subagentRowDetail,
  subagentStatusVisual,
} from "./V2LifecycleRow";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A workflow coordinator drawn like a subagent group: its phases in order, each listing its agents. */
export function WorkflowCard({
  agent,
  provider,
  onOpenThread,
  isThreadUnavailable,
  inWorkflowThread = false,
  initialExpanded = null,
  onExpandedChange,
}: {
  agent: OrchestrationV2Subagent;
  provider: ServerProvider | undefined;
  onOpenThread: (threadId: ThreadId) => void;
  isThreadUnavailable: (threadId: ThreadId) => boolean;
  inWorkflowThread?: boolean;
  /** A remembered user choice; null follows the default of open while running. */
  initialExpanded?: boolean | null;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [userExpanded, setUserExpanded] = useState(initialExpanded);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [coordinator, ...members] = projectedSubagentsToRuntime([agent]);
  const title = coordinator!.workflowName ?? coordinator!.title;
  const active = isActiveSubagentStatus(agent.status);
  const expanded = userExpanded ?? (active || inWorkflowThread);
  const failed = agent.status === "failed" || members.some(({ status }) => status === "failed");

  const phaseTitles = new Map(coordinator!.phases.map((phase) => [phase.index, phase.title]));
  for (const member of members) {
    if (member.phaseIndex !== null && !phaseTitles.has(member.phaseIndex)) {
      phaseTitles.set(member.phaseIndex, member.phaseTitle ?? `Phase ${member.phaseIndex}`);
    }
  }
  const phases = [...phaseTitles].sort(([a], [b]) => a - b);
  const phaseCount = phases.length;
  if (members.some((member) => member.phaseIndex === null)) phases.push([-1, "Other agents"]);
  const done = members.filter(({ status }) => status === "completed").length;
  const current = members.find(({ status }) => isActiveSubagentStatus(status));
  const summary = active
    ? [
        current ? (phaseTitles.get(current.phaseIndex ?? -1) ?? null) : null,
        members.length > 0 ? `${done} of ${plural(members.length, "agent")} done` : "Starting",
      ]
    : [
        phaseCount > 0 ? plural(phaseCount, "phase") : null,
        plural(members.length, "agent"),
        subagentStatusVisual(agent.status).label,
      ];
  const coordinatorThreadId = agent.childThreadId;

  return (
    <WorkLogBlock>
      <Collapsible
        open={expanded}
        onOpenChange={(open) => {
          setUserExpanded(open);
          onExpandedChange?.(open);
        }}
        data-workflow-card
      >
        <CollapsibleTrigger
          aria-label={`Workflow: ${title}`}
          className={cn(
            "flex w-full min-w-0 items-center gap-3 py-2 text-left transition-opacity hover:opacity-100",
            expanded || active ? "text-foreground opacity-100" : "text-muted-foreground opacity-55",
          )}
        >
          <SubagentAvatar driver={agent.driver} provider={provider} status={agent.status} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{title}</span>
            <span
              className={cn(
                "block truncate text-3xs text-muted-foreground",
                active ? "text-info" : failed && "text-destructive",
              )}
            >
              {summary.filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            <SubagentElapsed agent={coordinator!} />
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        {/* Virtualized rows must settle before disclosure scroll anchoring resumes. */}
        <CollapsiblePanel animate={false}>
          {expanded ? (
            <div className="mt-1 mb-1 rounded-lg border border-border/60 bg-card/30 p-1">
              {phases.map(([index, phaseTitle]) => {
                const phaseMembers = members.filter(
                  (member) => (member.phaseIndex ?? -1) === index,
                );
                return (
                  <section key={index} aria-label={phaseTitle}>
                    <h4 className="px-2 pt-2 pb-0.5 text-3xs font-medium text-muted-foreground">
                      {phaseTitle}
                    </h4>
                    {phaseMembers.map((member) => {
                      const childThreadId = member.childThreadId
                        ? ThreadId.make(member.childThreadId)
                        : null;
                      // A member's progress is its prompt, and a structured result is raw
                      // JSON; neither reads as one line, so those rows show their status.
                      const detail = subagentRowDetail(
                        member.status,
                        /^\s*[[{]/.test(member.result ?? "") ? null : member.result,
                        null,
                      );
                      const retried = member.attempt !== null && member.attempt > 1;
                      return (
                        <SubagentRow
                          key={member.id}
                          driver={agent.driver}
                          provider={provider}
                          status={member.status}
                          title={member.title}
                          statusLabel={[
                            subagentStatusVisual(member.status).label,
                            retried ? `Attempt ${member.attempt}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          showStatusLabel={
                            detail !== null && (member.status !== "completed" || retried)
                          }
                          detail={detail}
                          failed={member.status === "failed"}
                          trailing={<SubagentElapsed agent={member} />}
                          onOpen={childThreadId ? () => onOpenThread(childThreadId) : undefined}
                          disabled={childThreadId !== null && isThreadUnavailable(childThreadId)}
                        />
                      );
                    })}
                  </section>
                );
              })}
              {members.length === 0 ? (
                <p className="px-2 py-1.5 text-2xs text-muted-foreground">
                  {active ? "Waiting for agents…" : "No agents reported"}
                </p>
              ) : null}
              <div className="flex justify-end gap-1 pt-1">
                {agent.prompt ? (
                  <Button size="xs" variant="ghost-muted" onClick={() => setScriptOpen(true)}>
                    <CodeIcon aria-hidden className="size-3" />
                    View script
                  </Button>
                ) : null}
                {!inWorkflowThread && coordinatorThreadId !== null ? (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    disabled={isThreadUnavailable(coordinatorThreadId)}
                    onClick={() => onOpenThread(coordinatorThreadId)}
                  >
                    Open workflow
                    <ArrowUpRightIcon aria-hidden className="size-3" />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </CollapsiblePanel>
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
      </Collapsible>
    </WorkLogBlock>
  );
}
