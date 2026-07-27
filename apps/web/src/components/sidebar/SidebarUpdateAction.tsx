import { DownloadIcon, LoaderIcon, RotateCwIcon } from "lucide-react";
import { useCallback, memo } from "react";
import { useDesktopUpdateDownload, useDesktopUpdateInstall } from "~/hooks/useDesktopUpdateActions";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import {
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowDesktopUpdateButton,
} from "../desktopUpdate.logic";
import { SidebarMenuAction } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const SidebarUpdateAction = memo(function SidebarUpdateAction() {
  const state = useDesktopUpdateState();
  const handleDownload = useDesktopUpdateDownload();
  const handleInstall = useDesktopUpdateInstall();

  if (!state || !shouldShowDesktopUpdateButton(state)) {
    return null;
  }

  const action = resolveDesktopUpdateButtonAction(state);
  const disabled = isDesktopUpdateButtonDisabled(state);
  const tooltip = getDesktopUpdateButtonTooltip(state);
  const isDownloading = state.status === "downloading";

  const handleClick = useCallback(() => {
    if (disabled) return;

    if (action === "download") {
      handleDownload();
      return;
    }

    if (action === "install") {
      handleInstall();
    }
  }, [action, disabled, handleDownload, handleInstall]);

  const icon = isDownloading ? (
    <LoaderIcon className="size-3.5 animate-spin !text-primary" />
  ) : action === "install" ? (
    <RotateCwIcon className="size-3.5 !text-primary" />
  ) : (
    <DownloadIcon className="size-3.5 !text-primary" />
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuAction
            aria-label={tooltip}
            disabled={disabled}
            className="right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 !text-primary shadow-xs transition-colors hover:bg-primary/22 hover:!text-primary disabled:opacity-60"
            onClick={handleClick}
          >
            {icon}
          </SidebarMenuAction>
        }
      />
      <TooltipPopup align="end" side="top">
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
});
