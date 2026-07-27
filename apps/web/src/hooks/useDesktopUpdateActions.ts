import { useCallback } from "react";

import {
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  shouldToastDesktopUpdateActionResult,
} from "../components/desktopUpdate.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useDesktopUpdateState } from "../state/desktopUpdate";

export function useDesktopUpdateDownload() {
  const state = useDesktopUpdateState();

  return useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;

    void bridge
      .downloadUpdate()
      .then((result) => {
        if (result.completed) {
          toastManager.add({
            type: "success",
            title: "Update downloaded",
            description: "Restart the app to install it.",
          });
        }

        if (!shouldToastDesktopUpdateActionResult(result)) return;
        const actionError = getDesktopUpdateActionError(result);
        if (!actionError) return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not download update",
            description: actionError,
          }),
        );
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
  }, [state]);
}

export function useDesktopUpdateInstall() {
  const state = useDesktopUpdateState();

  return useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;

    const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(state));
    if (!confirmed) return;

    void bridge
      .installUpdate()
      .then((result) => {
        if (!shouldToastDesktopUpdateActionResult(result)) return;
        const actionError = getDesktopUpdateActionError(result);
        if (!actionError) return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not install update",
            description: actionError,
          }),
        );
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
  }, [state]);
}
