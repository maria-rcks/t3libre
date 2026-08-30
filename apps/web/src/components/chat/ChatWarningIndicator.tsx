import { type ContextMenuItem, type EnvironmentId, type ServerProvider } from "@t3tools/contracts";
import { CircleAlertIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

import { readLocalApi } from "~/localApi";
import { formatProviderDriverKindLabel } from "~/providerModels";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ChatWarning {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export type ChatWarningContextMenuAction =
  | `warning:${number}`
  | `dismiss-now:${number}`
  | `dismiss-forever:${number}`
  | "dismiss-all-now"
  | "dismiss-all-forever";

export function resolveProviderChatWarning(
  environmentId: EnvironmentId,
  status: ServerProvider | null,
): ChatWarning | null {
  if (!status || status.status === "ready" || status.status === "disabled") return null;

  const providerName = status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
  const isUnauthenticated = status.status === "error" && status.auth.status === "unauthenticated";
  const title = isUnauthenticated
    ? `${providerName} needs authentication`
    : status.status === "error"
      ? `${providerName} is unavailable`
      : `${providerName} has limited availability`;
  const description = isUnauthenticated
    ? status.message
      ? `${status.message}\n\nSign in through the ${providerName} CLI to authenticate again.`
      : `Sign in through the ${providerName} CLI to authenticate again.`
    : (status.message ??
      (status.status === "error"
        ? `${providerName} could not start. Check its provider settings and installation.`
        : `${providerName} reported limited availability. Check its provider settings for details.`));

  return {
    id: [
      "provider",
      environmentId,
      status.instanceId,
      status.status,
      status.auth.status,
      status.message ?? "",
    ].join("\u0000"),
    title,
    description,
  };
}

export function resolveThreadErrorChatWarning(
  threadKey: string,
  error: string | null,
): ChatWarning | null {
  if (!error) return null;
  return {
    id: ["thread", threadKey, error].join("\u0000"),
    title: "Thread failed",
    description: error,
  };
}

export function buildChatWarningContextMenuItems(
  warnings: ReadonlyArray<ChatWarning>,
  canDismissForNow = true,
): ReadonlyArray<ContextMenuItem<ChatWarningContextMenuAction>> {
  const temporarilyUnavailable = canDismissForNow ? {} : { disabled: true };
  if (warnings.length === 1) {
    return [
      { id: "dismiss-now:0", label: "Dismiss for now", ...temporarilyUnavailable },
      { id: "dismiss-forever:0", label: "Don't show again" },
    ];
  }
  return [
    ...warnings.map(
      (warning, index): ContextMenuItem<ChatWarningContextMenuAction> => ({
        id: `warning:${index}`,
        label: warning.title,
        children: [
          {
            id: `dismiss-now:${index}`,
            label: "Dismiss for now",
            ...temporarilyUnavailable,
          },
          { id: `dismiss-forever:${index}`, label: "Don't show again" },
        ],
      }),
    ),
    {
      id: "dismiss-all-now",
      label: "Dismiss all for now",
      ...temporarilyUnavailable,
      separatorBefore: true,
    },
    { id: "dismiss-all-forever", label: "Don't show these again" },
  ];
}

export const ChatWarningIndicator = memo(function ChatWarningIndicator({
  warnings,
  onDismissWarningForNow,
  onDismissWarningForever,
  onDismissAllWarningsForNow,
  onDismissAllWarningsForever,
  canDismissForNow,
}: {
  readonly warnings: ReadonlyArray<ChatWarning>;
  readonly onDismissWarningForNow: (warningId: string) => void;
  readonly onDismissWarningForever: (warningId: string) => void;
  readonly onDismissAllWarningsForNow: () => void;
  readonly onDismissAllWarningsForever: () => void;
  readonly canDismissForNow: boolean;
}) {
  const activeContextMenusRef = useRef(new Set<symbol>());
  const closeContextMenu = useCallback(() => {
    if (activeContextMenusRef.current.size === 0) return;
    activeContextMenusRef.current.clear();
    void readLocalApi()?.contextMenu.close();
  }, []);
  const warningIds = JSON.stringify(warnings.map((warning) => warning.id));
  useEffect(() => {
    closeContextMenu();
  }, [closeContextMenu, warningIds]);
  useEffect(() => closeContextMenu, [closeContextMenu]);

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api) return;
      const contextMenuToken = Symbol();
      activeContextMenusRef.current.add(contextMenuToken);
      try {
        const action = await api.contextMenu.show(
          buildChatWarningContextMenuItems(warnings, canDismissForNow),
          {
            x: event.clientX,
            y: event.clientY,
          },
        );
        if (!activeContextMenusRef.current.has(contextMenuToken)) return;
        if (action === "dismiss-all-now") {
          if (canDismissForNow) onDismissAllWarningsForNow();
          return;
        }
        if (action === "dismiss-all-forever") {
          onDismissAllWarningsForever();
          return;
        }
        if (action?.startsWith("dismiss-now:")) {
          const warning = warnings[Number(action.slice("dismiss-now:".length))];
          if (warning && canDismissForNow) onDismissWarningForNow(warning.id);
          return;
        }
        if (action?.startsWith("dismiss-forever:")) {
          const warning = warnings[Number(action.slice("dismiss-forever:".length))];
          if (warning) onDismissWarningForever(warning.id);
        }
      } catch {
        // Losing a context menu should not add another warning to the warning center.
      } finally {
        activeContextMenusRef.current.delete(contextMenuToken);
      }
    },
    [
      canDismissForNow,
      onDismissAllWarningsForNow,
      onDismissAllWarningsForever,
      onDismissWarningForNow,
      onDismissWarningForever,
      warnings,
    ],
  );

  if (warnings.length === 0) return null;

  const warningCountLabel = `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`;
  const dismissForNowLabel = warnings.length === 1 ? "Dismiss for now" : "Dismiss all for now";
  const dismissForeverLabel = warnings.length === 1 ? "Don't show again" : "Don't show these again";
  const dismissForNowButton = (
    <Button
      size="xs"
      variant="destructive-outline"
      className="border-destructive/32 bg-error-surface text-error-foreground hover:bg-destructive/12 aria-disabled:hover:border-destructive/32 aria-disabled:hover:bg-error-surface aria-disabled:cursor-default aria-disabled:opacity-64"
      aria-disabled={!canDismissForNow || undefined}
      onClick={() => {
        if (canDismissForNow) onDismissAllWarningsForNow();
      }}
    >
      {dismissForNowLabel}
    </Button>
  );
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
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${warningCountLabel}. Right-click to dismiss.`}
              className="size-6 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onContextMenu={(event) => void handleContextMenu(event)}
            />
          }
        >
          <CircleAlertIcon className="size-4.5 fill-destructive/12 text-destructive" aria-hidden />
        </PopoverTrigger>
        <PopoverPopup
          tooltipStyle
          align="start"
          side="bottom"
          viewportClassName="p-0"
          className="alert-glass w-72 max-w-[calc(100vw-1rem)] border-destructive/40! text-left text-pretty text-error-foreground"
          data-variant="error"
        >
          <div>
            {warnings.map((warning) => (
              <div key={warning.id} className="p-2.5 pb-1.5">
                <div className="font-medium text-error-foreground">{warning.title}</div>
                <div className="mt-0.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-error-foreground/80">
                  {warning.description}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-end gap-1.5 px-2.5 pt-1 pb-2.5">
              {canDismissForNow ? (
                dismissForNowButton
              ) : (
                <Tooltip>
                  <TooltipTrigger render={dismissForNowButton} />
                  <TooltipPopup side="bottom">Available after the server connects</TooltipPopup>
                </Tooltip>
              )}
              <Button size="xs" variant="destructive" onClick={onDismissAllWarningsForever}>
                {dismissForeverLabel}
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
});
