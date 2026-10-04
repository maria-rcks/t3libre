import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments } from "../state/environments";
import { APP_DISPLAY_NAME } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedStaticOnboardingState />;
  }

  return <IndexDraftLanding />;
}

/**
 * Landing on the index route drops straight into a draft thread for the most
 * recently active project, so the first screen is a prompt instead of a dead
 * end. Falls back to an add-project hero when no project exists yet.
 */
function IndexDraftLanding() {
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const archiveDraftRetry = useLocation({ select: (location) => location.state.archiveDraftRetry });
  const startingRef = useRef(false);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const mostRecentProject = useMemo(
    () =>
      bootstrapped
        ? (sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null)
        : null,
    [bootstrapped, projects, threads],
  );
  const recoveryProjectMissing =
    bootstrapped &&
    archiveDraftRetry !== undefined &&
    !projects.some(
      (project) =>
        project.environmentId === archiveDraftRetry.projectRef.environmentId &&
        project.id === archiveDraftRetry.projectRef.projectId,
    );
  const retryDisabled =
    archiveDraftRetry !== undefined &&
    (!bootstrapped || archiveDraftRetry.cancelled === true || recoveryProjectMissing);

  useEffect(() => {
    const projectRef =
      archiveDraftRetry?.projectRef ??
      (mostRecentProject
        ? scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id)
        : null);
    if (projectRef === null || startingRef.current || retryDisabled || !bootstrapped) {
      return;
    }
    startingRef.current = true;
    void handleNewThread(projectRef, {
      replace: true,
    })
      .then((opened) => {
        if (opened === null) {
          startingRef.current = archiveDraftRetry !== undefined;
          setStartState((state) => ({ ...state, failed: true }));
        }
      })
      .catch(() => {
        startingRef.current = archiveDraftRetry !== undefined;
        setStartState((state) => ({ ...state, failed: true }));
      });
  }, [
    archiveDraftRetry,
    bootstrapped,
    handleNewThread,
    mostRecentProject,
    retryDisabled,
    startState.retryRequest,
  ]);

  if (!bootstrapped && archiveDraftRetry === undefined) {
    return null;
  }
  if (archiveDraftRetry !== undefined || mostRecentProject !== null) {
    return startState.failed || retryDisabled ? (
      <DraftStartError
        disabled={retryDisabled}
        projectMissing={recoveryProjectMissing}
        onRetry={() => {
          startingRef.current = false;
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  // First-run routing to the welcome wizard happens in FirstRunGate at the
  // root, before this route ever renders.
  return <NoProjectsHero />;
}

function DraftStartError({
  onRetry,
  disabled = false,
  projectMissing = false,
}: {
  readonly onRetry: () => void;
  readonly disabled?: boolean;
  readonly projectMissing?: boolean;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            {projectMissing
              ? "This checkout is no longer registered. Choose another checkout from New thread in..."
              : "The project is still available. Try opening the draft again."}
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry} disabled={disabled}>
              <RefreshIcon size="md" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  const cloudEnabled = hasCloudPublicConfig();
  const localEnvironmentOff = isLocalEnvironmentDisabled();
  const description = localEnvironmentOff
    ? "The local environment is turned off. Connect a remote environment, or turn the local environment back on in Connections."
    : cloudEnabled
      ? "Enable T3 Connect on that machine, then open Connections here to sign in with the same account. You can also add the machine using a pairing link."
      : "Open Connections and add that machine using its pairing link. This app must be able to reach it.";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle>Connect to a computer running T3 Code</EmptyTitle>
              <EmptyDescription>
                This app connects to T3 Code running on your computer or a server. Start the T3 Code
                desktop app or command-line server on that machine and keep it running.
              </EmptyDescription>
              <EmptyDescription>{description}</EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Open Connections
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
