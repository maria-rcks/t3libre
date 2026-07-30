import { ClientOrchestrationCommand, type GitRunStackedActionInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { demoEnvironments, DEMO_METRICS_WORKTREE_PATH, demoVcsStatusByCwd } from "./fixtures";
import { applyDemoGitActionToStatus, demoGitActionEvents, DemoShellStore } from "./server";

const decodeCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);

describe("demo shell mutations", () => {
  it("timestamps mode changes when they are applied", () => {
    const environment = demoEnvironments.find(
      (candidate) => candidate.environmentId === "demo-mac-studio",
    );
    if (!environment) throw new Error("Missing Mac Studio demo environment");

    const store = new DemoShellStore(environment.shellSnapshot);
    const appliedAfter = Date.now();
    store.dispatch(
      decodeCommand({
        type: "thread.runtime-mode.set",
        commandId: "command-runtime-mode",
        threadId: "thread-composer",
        runtimeMode: "approval-required",
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    store.dispatch(
      decodeCommand({
        type: "thread.interaction-mode.set",
        commandId: "command-interaction-mode",
        threadId: "thread-composer",
        interactionMode: "plan",
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );

    const thread = store.thread("thread-composer");
    expect(thread?.runtimeMode).toBe("approval-required");
    expect(thread?.interactionMode).toBe("plan");
    expect(Date.parse(thread?.updatedAt ?? "")).toBeGreaterThanOrEqual(appliedAfter);
  });
});

describe("demo git actions", () => {
  it("reports and applies a requested feature branch", () => {
    const input = {
      actionId: "demo-feature-branch",
      cwd: DEMO_METRICS_WORKTREE_PATH,
      action: "commit_push_pr",
      commitMessage: "Add release filters",
      featureBranch: true,
    } satisfies GitRunStackedActionInput;
    const current = demoVcsStatusByCwd[DEMO_METRICS_WORKTREE_PATH];
    if (current?._tag !== "snapshot") throw new Error("Missing metrics VCS snapshot");

    const events = demoGitActionEvents(input);
    const started = events.find((event) => event.kind === "action_started");
    const finished = events.find((event) => event.kind === "action_finished");

    expect(started?.phases).toEqual(["branch", "commit", "push", "pr"]);
    expect(finished?.result.branch).toEqual({
      status: "created",
      name: "feat/add-release-filters",
    });
    expect(finished?.result.push).toMatchObject({
      status: "pushed",
      branch: "feat/add-release-filters",
    });

    const next = applyDemoGitActionToStatus(current, input);
    expect(next.local).toMatchObject({
      isDefaultRef: false,
      refName: "feat/add-release-filters",
      hasWorkingTreeChanges: false,
    });
    expect(next.remote).toMatchObject({
      hasUpstream: true,
      aheadCount: 0,
      pr: { headRef: "feat/add-release-filters" },
    });
  });
});
