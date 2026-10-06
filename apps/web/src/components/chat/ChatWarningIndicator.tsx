import {
  type ContextMenuItem,
  type EnvironmentId,
  type OrchestrationV2ProviderFailureClass,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CircleAlertIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { formatProviderDriverKindLabel } from "~/providerModels";
import { Button, InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  getIncompatibleVersion,
  getProviderStatusBannerKey,
  getProviderStatusMessage,
  hasProviderSetup,
} from "./ProviderStatusBanner";

export interface ChatWarning {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: "warning" | "error";
  readonly providerSetupInstanceId?: ProviderInstanceId;
}

type ContextMenuAction =
  | `warning:${number}`
  | `dismiss-now:${number}`
  | `dismiss-forever:${number}`
  | "dismiss-all-now"
  | "dismiss-all-forever";

export function resolveProviderChatWarning(
  environmentId: EnvironmentId,
  status: ServerProvider | null,
): ChatWarning | null {
  const key = getProviderStatusBannerKey(status);
  if (!status || key === null) return null;
  const providerName = status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
  const incompatible = getIncompatibleVersion(status);
  const needsAuthentication = status.status === "error" && status.auth.status === "unauthenticated";
  return {
    id: ["provider", environmentId, key].join("\u0000"),
    title: needsAuthentication
      ? `${providerName} needs authentication`
      : incompatible
        ? `${providerName} ${status.version ?? ""} is ${incompatible.status === "broken" ? "known to be broken" : "unsupported"}`
        : status.status === "error"
          ? `${providerName} is unavailable`
          : `${providerName} has limited availability`,
    description: incompatible?.message ?? getProviderStatusMessage(status),
    severity:
      incompatible?.status !== "broken" && (status.status === "warning" || incompatible !== null)
        ? "warning"
        : "error",
    ...(hasProviderSetup(status) ? { providerSetupInstanceId: status.instanceId } : {}),
  };
}

export function resolveThreadErrorChatWarning(
  threadKey: string,
  error: string | null,
  errorClass?: OrchestrationV2ProviderFailureClass | null,
): ChatWarning | null {
  return error
    ? {
        id: ["thread", threadKey, error].join("\u0000"),
        title: "Thread failed",
        description: error,
        severity: errorClass === "usage_limit" ? "warning" : "error",
      }
    : null;
}

function contextMenuItems(
  warnings: ReadonlyArray<ChatWarning>,
  canDismissForNow: boolean,
): ReadonlyArray<ContextMenuItem<ContextMenuAction>> {
  const actions = (index: number): ReadonlyArray<ContextMenuItem<ContextMenuAction>> => [
    ...(canDismissForNow
      ? ([{ id: `dismiss-now:${index}`, label: "Dismiss for now" }] as const)
      : []),
    { id: `dismiss-forever:${index}`, label: "Don't show again" },
  ];
  if (warnings.length === 1) return actions(0);
  return [
    ...warnings.map((warning, index): ContextMenuItem<ContextMenuAction> => ({
      id: `warning:${index}`,
      label: warning.title,
      children: actions(index),
    })),
    ...(canDismissForNow
      ? ([{ id: "dismiss-all-now", label: "Dismiss all for now", separatorBefore: true }] as const)
      : []),
    { id: "dismiss-all-forever", label: "Don't show these again" },
  ];
}

export const ChatWarningIndicator = memo(function ChatWarningIndicator({
  warnings,
  canDismissForNow,
  onDismissForNow,
  onDismissForever,
  onOpenProviderSetup,
}: {
  readonly warnings: ReadonlyArray<ChatWarning>;
  readonly canDismissForNow: boolean;
  readonly onDismissForNow: (warningIds: ReadonlyArray<string>) => void;
  readonly onDismissForever: (warningIds: ReadonlyArray<string>) => void;
  readonly onOpenProviderSetup: (instanceId: ProviderInstanceId) => void;
}) {
  const menuRequest = useRef(0);
  const menuOpen = useRef(false);
  const warningKey = JSON.stringify(warnings);
  useEffect(
    () => () => {
      menuRequest.current++;
      if (menuOpen.current) {
        menuOpen.current = false;
        void readLocalApi()?.contextMenu.close();
      }
    },
    [warningKey, canDismissForNow, onDismissForNow, onDismissForever],
  );

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api) return;
      const request = ++menuRequest.current;
      menuOpen.current = true;
      let action: ContextMenuAction | null;
      try {
        action = await api.contextMenu.show(contextMenuItems(warnings, canDismissForNow), {
          x: event.clientX,
          y: event.clientY,
        });
      } catch {
        // The native menu can disappear when its window closes.
        return;
      } finally {
        if (request === menuRequest.current) menuOpen.current = false;
      }
      if (request !== menuRequest.current || action === null) return;
      if (action === "dismiss-all-now") return onDismissForNow(warnings.map(({ id }) => id));
      if (action === "dismiss-all-forever") {
        return onDismissForever(warnings.map(({ id }) => id));
      }
      const dismissForNow = action.startsWith("dismiss-now:");
      const warning = warnings[Number(action.slice(action.indexOf(":") + 1))];
      if (!warning) return;
      if (dismissForNow && canDismissForNow) onDismissForNow([warning.id]);
      if (!dismissForNow && action.startsWith("dismiss-forever:")) {
        onDismissForever([warning.id]);
      }
    },
    [canDismissForNow, onDismissForNow, onDismissForever, warnings],
  );

  if (warnings.length === 0) return null;

  const severity = warnings.some((warning) => warning.severity === "error") ? "error" : "warning";
  const warningIds = warnings.map(({ id }) => id);
  const isSingle = warnings.length === 1;
  const isError = severity === "error";
  const actionVariant = isError ? "ghost-error" : "ghost-warning";

  return (
    <>
      <span role="alert" className="sr-only">
        {warnings.map((warning) => `${warning.title}: ${warning.description}`).join(" ")}
      </span>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          closeDelay={200}
          render={
            <Button
              variant={isError ? "ghost-error-icon" : "ghost-warning-icon"}
              size="icon-circle-xs"
              aria-label={`${warnings.length} ${isSingle ? "warning" : "warnings"}. Right-click to dismiss.`}
              onContextMenu={(event) => void handleContextMenu(event)}
            />
          }
        >
          <CircleAlertIcon
            className={cn("size-4.5", isError ? "fill-destructive/12" : "fill-warning/12")}
            aria-hidden
          />
        </PopoverTrigger>
        <PopoverPopup
          tooltipStyle
          align="start"
          side="bottom"
          padding="none"
          width="sm"
          variant={severity}
          data-variant={severity}
        >
          <div className="space-y-2">
            {warnings.map((warning) => (
              <div key={warning.id}>
                <div className="text-xs leading-4 font-medium">{warning.title}</div>
                <div className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-4 opacity-75">
                  {warning.description}
                </div>
                {warning.providerSetupInstanceId ? (
                  <InlineButton
                    onClick={() => {
                      if (warning.providerSetupInstanceId)
                        onOpenProviderSetup(warning.providerSetupInstanceId);
                    }}
                  >
                    Open provider setup
                  </InlineButton>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-1">
            {canDismissForNow ? (
              <Button
                size="micro"
                variant={actionVariant}
                onClick={() => onDismissForNow(warningIds)}
              >
                {isSingle ? "Dismiss for now" : "Dismiss all for now"}
              </Button>
            ) : null}
            <Button
              size="micro"
              variant={actionVariant}
              onClick={() => onDismissForever(warningIds)}
            >
              {isSingle ? "Don't show again" : "Don't show these again"}
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
});
