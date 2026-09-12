import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import {
  CHAT_PROJECT_ID,
  isChatProject,
  resolveEnvironmentMachineKind,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderIcon, FolderPlusIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

interface DraftProjectPickerProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftProjectPicker({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftProjectPickerProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const isChat = activeProjectRef?.projectId === CHAT_PROJECT_ID;
  const activeProjectDisplayName = isChat
    ? null
    : (activeProjectGroup?.displayName ?? activeProjectTitle);
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const selectProject = (value: string) => {
    const entry = projectEntryByKey.get(value);
    if (!entry || value === activeProjectKey) {
      return;
    }
    const project = entry.targetProject;
    if (!draftId) {
      return;
    }
    // Project selection changes the target of the open draft in
    // place. The prompt stays in the same composer session, so the
    // sidebar only gets a draft row if the user later navigates away.
    const currentDraft = getComposerDraft(draftId);
    setLogicalProjectDraftThreadId(
      entry.group.projectKey,
      scopeProjectRef(project.environmentId, project.id),
      draftId,
    );
    if (!hasExplicitComposerModelSelection(currentDraft)) {
      applyStickyState(draftId);
      const environmentSettings = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig?.settings;
      const defaultModelSelection = environmentSettings
        ? resolveProjectSettings(environmentSettings, project.id, project).settings
            .defaultModelSelection
        : project.defaultModelSelection;
      if (defaultModelSelection) {
        setModelSelection(draftId, defaultModelSelection, {
          replaceOptions: true,
        });
      }
    }
  };
  const chatEntry = projectPickerEntries.find(
    ({ targetProject }) =>
      isChatProject(targetProject) &&
      targetProject.environmentId === activeProjectRef?.environmentId,
  );

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label={!isChat && hasResolvedProject ? "Change project" : "Add project"}
              className="inline-flex h-8 min-w-0 max-w-64 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          {isChat ? <PlusIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />}
          <span className="truncate">{activeProjectDisplayName ?? "Add project"}</span>
        </TooltipTrigger>
        {activeProjectDisplayName ? (
          <TooltipPopup side="top" className="max-w-80">
            {activeProjectDisplayName}
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => selectProject(value as string)}
        >
          {projectPickerEntries
            .filter(({ targetProject }) => !isChatProject(targetProject))
            .map(({ group }) => {
              return (
                <MenuRadioItem
                  key={group.projectKey}
                  value={group.projectKey}
                  closeOnClick
                  className="[&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                >
                  <ProjectFavicon project={group} className="size-4 shrink-0" />
                  <Tooltip>
                    <TooltipTrigger render={<span className="block min-w-0 truncate" />}>
                      {group.displayName}
                    </TooltipTrigger>
                    <TooltipPopup side="top" className="max-w-80">
                      {group.displayName}
                    </TooltipPopup>
                  </Tooltip>
                  {showProjectEnvironments ? (
                    <ProjectEnvironmentBadge
                      group={group}
                      primaryEnvironmentId={primaryEnvironmentId}
                      machineByEnvironmentId={environmentMachineById}
                    />
                  ) : null}
                </MenuRadioItem>
              );
            })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PlusIcon className="size-3.5" />
      Add project
    </button>
  );

  return (
    <div className="flex items-center px-2 pt-1.5">
      <div className="inline-flex min-w-0 items-center rounded-lg">
        {projectSelector}
        {!isChat && chatEntry ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Remove project"
                  onClick={() => selectProject(chatEntry.group.projectKey)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <XIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>Don't work in a project</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
