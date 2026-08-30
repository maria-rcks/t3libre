import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildChatWarningContextMenuItems,
  resolveProviderChatWarning,
  resolveThreadErrorChatWarning,
  type ChatWarning,
} from "./ChatWarningIndicator";

const warning: ChatWarning = {
  id: "provider-warning",
  title: "Codex is unavailable",
  description: "Codex App Server process exited with code 1.",
};

describe("ChatWarningIndicator", () => {
  it("turns provider status into a specific title with the exact failure", () => {
    expect(
      resolveProviderChatWarning(EnvironmentId.make("local"), {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        enabled: true,
        installed: true,
        version: "1.0.0",
        status: "error",
        auth: { status: "authenticated" },
        checkedAt: "2026-07-23T12:00:00.000Z",
        message: "Codex App Server process exited with code 1.",
        models: [],
        slashCommands: [],
        skills: [],
      }),
    ).toMatchObject({
      title: "Codex is unavailable",
      description: "Codex App Server process exited with code 1.",
    });
  });

  it("keeps thread errors separate from provider warnings", () => {
    expect(resolveThreadErrorChatWarning("local:thread-a", "Turn failed")).toEqual({
      id: "thread\u0000local:thread-a\u0000Turn failed",
      title: "Thread failed",
      description: "Turn failed",
    });
  });

  it("offers individual and bulk dismissal from the context menu", () => {
    expect(
      buildChatWarningContextMenuItems([
        warning,
        { id: "thread-warning", title: "Thread failed", description: "Turn failed" },
      ]),
    ).toEqual([
      {
        id: "warning:0",
        label: "Codex is unavailable",
        children: [
          { id: "dismiss-now:0", label: "Dismiss for now" },
          { id: "dismiss-forever:0", label: "Don't show again" },
        ],
      },
      {
        id: "warning:1",
        label: "Thread failed",
        children: [
          { id: "dismiss-now:1", label: "Dismiss for now" },
          { id: "dismiss-forever:1", label: "Don't show again" },
        ],
      },
      {
        id: "dismiss-all-now",
        label: "Dismiss all for now",
        separatorBefore: true,
      },
      { id: "dismiss-all-forever", label: "Don't show these again" },
    ]);
  });

  it("keeps temporary dismissals visible but disabled until the server run is known", () => {
    expect(buildChatWarningContextMenuItems([warning], false)).toEqual([
      { id: "dismiss-now:0", label: "Dismiss for now", disabled: true },
      { id: "dismiss-forever:0", label: "Don't show again" },
    ]);
  });
});
