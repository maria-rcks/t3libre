import { MessageCircleIcon, PlusIcon } from "lucide-react";
import { useCallback } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useChatProject } from "../hooks/useChatProject";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";

export function NoProjectsHero() {
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { chatWorkspaceRootFor, ensureChatProject } = useChatProject();
  const handleNewThread = useNewThreadHandler();
  const canJustChat = chatWorkspaceRootFor(primaryEnvironmentId) !== null;
  const startChat = useCallback(async () => {
    if (primaryEnvironmentId === null) return;
    const projectRef = await ensureChatProject(primaryEnvironmentId);
    if (projectRef) await handleNewThread(projectRef);
  }, [ensureChatProject, handleNewThread, primaryEnvironmentId]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                What should we work on?
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Add a project to start your first thread.
              </EmptyDescription>
              <div className="mt-6 flex justify-center gap-2">
                <Button size="sm" onClick={openAddProject}>
                  <PlusIcon className="size-4" />
                  Add project
                </Button>
                {canJustChat ? (
                  <Button size="sm" variant="outline" onClick={() => void startChat()}>
                    <MessageCircleIcon className="size-4" />
                    Just chat
                  </Button>
                ) : null}
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
