import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  showCancel?: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  showCancel = true,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <>
      {showCancel ? (
        <Button
          size="xs"
          variant="ghost-muted"
          className="h-5 px-1.5 text-[11px] font-normal"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "cancel")}
        >
          Cancel
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="ghost-muted"
        className="h-5 px-1.5 text-[11px] font-normal text-destructive-foreground hover:text-destructive-foreground"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "decline")}
      >
        Decline
      </Button>
      <Button
        size="xs"
        variant="ghost-muted"
        className="h-5 px-1.5 text-[11px] font-normal"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
      >
        Always allow this session
      </Button>
      <Button
        size="xs"
        variant="ghost-muted"
        className="h-5 px-1.5 text-[11px] font-normal text-foreground"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "accept")}
      >
        Approve
      </Button>
    </>
  );
});
