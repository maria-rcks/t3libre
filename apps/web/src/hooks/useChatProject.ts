import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { CHAT_PROJECT_TITLE, findChatProject } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { newProjectId } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * "Just chat" runs a thread in a plain folder the server offers instead of a
 * repository. That folder becomes an ordinary project the first time it is
 * used, so everything downstream is the regular non-git project path.
 */
export function useChatProject() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  const chatWorkspaceRootFor = useCallback(
    (environmentId: EnvironmentId | null): string | null =>
      environmentId === null
        ? null
        : (environments.find((environment) => environment.environmentId === environmentId)
            ?.serverConfig?.chatWorkspaceRoot ?? null),
    [environments],
  );

  const ensureChatProject = useCallback(
    async (environmentId: EnvironmentId): Promise<ScopedProjectRef | null> => {
      const chatWorkspaceRoot = chatWorkspaceRootFor(environmentId);
      if (chatWorkspaceRoot === null) return null;
      const existing = findChatProject({ projects, environmentId, chatWorkspaceRoot });
      if (existing) return scopeProjectRef(environmentId, existing.id);

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
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to start chat",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return null;
      }
      return scopeProjectRef(environmentId, projectId);
    },
    [chatWorkspaceRootFor, createProject, projects],
  );

  return { chatWorkspaceRootFor, ensureChatProject };
}
