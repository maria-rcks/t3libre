import type { EnvironmentId, PreviewRuntime } from "@t3tools/contracts";

import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { readEnvironmentSupportsServerBrowser } from "~/state/entities";

export function previewRuntimeFor(environmentId: EnvironmentId): PreviewRuntime | undefined {
  return readEnvironmentSupportsServerBrowser(environmentId) ? "server" : undefined;
}

export function isPreviewAvailableFor(environmentId: EnvironmentId): boolean {
  return isPreviewSupportedInRuntime() || readEnvironmentSupportsServerBrowser(environmentId);
}
