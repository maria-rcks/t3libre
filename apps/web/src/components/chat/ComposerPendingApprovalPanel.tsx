import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const fallbackLabel =
    approval.requestKind === "command"
      ? "Command approval"
      : approval.requestKind === "file-read"
        ? "File read approval"
        : "File change approval";
  const detailAriaLabel =
    approval.requestKind === "command"
      ? "Command"
      : approval.requestKind === "file-read"
        ? "File to read"
        : "File change";

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <code
        aria-label={detailAriaLabel}
        className="block min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px] text-foreground/85"
        data-approval-detail="complete"
      >
        {approval.detail ?? fallbackLabel}
      </code>
      {pendingCount > 1 ? (
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
          1/{pendingCount}
        </span>
      ) : null}
    </div>
  );
});
