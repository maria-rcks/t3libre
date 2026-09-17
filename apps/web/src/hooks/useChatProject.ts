import { CHAT_PROJECT_TITLE, findChatProject } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { newProjectId } from "~/lib/utils";
import { readProjects, waitForProject } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

// One create per environment at a time: a second click while the first
// project.create is in flight would be rejected as a duplicate workspace root.
const inFlightByEnvironment = new Map<EnvironmentId, Promise<EnvironmentProject | null>>();

function reportChatStartFailure(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Failed to start chat",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * "Just chat" runs a thread in a plain folder the server offers instead of a
 * repository. That folder becomes an ordinary project the first time it is
 * used, so everything downstream is the regular non-git project path.
 */
export function useChatProject() {
  const { environments } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  const chatWorkspaceRootFor = useCallback(
    (environmentId: EnvironmentId | null): string | null => {
      const environment = environments.find((entry) => entry.environmentId === environmentId);
      if (!environment || environment.connection.phase !== "connected") return null;
      return environment.serverConfig?.chatWorkspaceRoot ?? null;
    },
    [environments],
  );

  const ensureChatProject = useCallback(
    (environmentId: EnvironmentId): Promise<EnvironmentProject | null> => {
      const chatWorkspaceRoot = chatWorkspaceRootFor(environmentId);
      if (chatWorkspaceRoot === null) return Promise.resolve(null);
      const findExisting = () =>
        findChatProject({ projects: readProjects(), environmentId, chatWorkspaceRoot });
      const existing = findExisting();
      if (existing) return Promise.resolve(existing);
      const pending = inFlightByEnvironment.get(environmentId);
      if (pending) return pending;

      const create = (async () => {
        const projectId = newProjectId();
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            title: CHAT_PROJECT_TITLE,
            workspaceRoot: chatWorkspaceRoot,
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: null,
          },
        });
        if (result._tag === "Failure") {
          // Another client may have created it first; that project is fine to use.
          const raced = findExisting();
          if (raced) return raced;
          if (!isAtomCommandInterrupted(result)) {
            reportChatStartFailure(squashAtomCommandFailure(result));
          }
          return null;
        }
        // Drafts key off the project's stored path and settings, so wait for
        // the create event to reach the client store before targeting one.
        try {
          return await waitForProject({ environmentId, projectId });
        } catch (error) {
          reportChatStartFailure(error);
          return null;
        }
      })().finally(() => {
        inFlightByEnvironment.delete(environmentId);
      });
      inFlightByEnvironment.set(environmentId, create);
      return create;
    },
    [chatWorkspaceRootFor, createProject],
  );

  return { chatWorkspaceRootFor, ensureChatProject };
}
