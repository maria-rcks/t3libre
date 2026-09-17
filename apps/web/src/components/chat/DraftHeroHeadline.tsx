import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findChatProject } from "@t3tools/client-runtime/operations/projects";
import { ChevronDownIcon, FolderPlusIcon, MessageCircleIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useChatProject } from "~/hooks/useChatProject";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
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
import { Button } from "../ui/button";
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

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
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
  const { canStartChatIn, chatEnvironmentId, chatWorkspaceRootFor, ensureChatProject } =
    useChatProject();

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
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const canChooseProject = projectPickerEntries.length > 0;
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const chatTargetEnvironmentId =
    activeProjectRef?.environmentId ?? chatEnvironmentId(primaryEnvironmentId);
  const chatWorkspaceRoot = chatWorkspaceRootFor(chatTargetEnvironmentId);
  const chatProject =
    chatTargetEnvironmentId !== null && chatWorkspaceRoot !== null
      ? findChatProject({ projects, environmentId: chatTargetEnvironmentId, chatWorkspaceRoot })
      : null;
  const isChatDraft = activeProject !== null && chatProject?.id === activeProject.id;
  // The chip and its x already stand for chat, so the menu lists repositories only.
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) => targetProject.id !== chatProject?.id,
  );
  const canJustChat = canStartChatIn(chatTargetEnvironmentId) && !isChatDraft;

  // The picker can change the draft's target while "Just chat" is still
  // creating its project; a stale continuation must not retarget it again.
  const latestTargetRef = useRef({ draftId, activeProjectKey, chatTargetEnvironmentId });
  useEffect(() => {
    latestTargetRef.current = { draftId, activeProjectKey, chatTargetEnvironmentId };
  }, [activeProjectKey, chatTargetEnvironmentId, draftId]);
  // Project selection changes the target of the open draft in place. The
  // prompt stays in the same composer session, so the sidebar only gets a
  // draft row if the user later navigates away.
  const selectProject = (project: (typeof projects)[number], logicalProjectKey: string) => {
    if (!draftId) {
      return;
    }
    latestTargetRef.current = {
      draftId,
      activeProjectKey: logicalProjectKey,
      chatTargetEnvironmentId: project.environmentId,
    };
    const currentDraft = getComposerDraft(draftId);
    setLogicalProjectDraftThreadId(
      logicalProjectKey,
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
  const startChat = async () => {
    if (chatTargetEnvironmentId === null || isChatDraft) {
      return;
    }
    const requested = { draftId, activeProjectKey, chatTargetEnvironmentId };
    const project = await ensureChatProject(chatTargetEnvironmentId);
    const latest = latestTargetRef.current;
    if (
      !project ||
      latest.draftId !== requested.draftId ||
      latest.activeProjectKey !== requested.activeProjectKey ||
      latest.chatTargetEnvironmentId !== requested.chatTargetEnvironmentId
    ) {
      return;
    }
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
  };

  const projectMenu = (
    <MenuPopup align="start" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
      <MenuRadioGroup
        value={activeProjectKey}
        onValueChange={(value) => {
          const entry = projectEntryByKey.get(value as string);
          if (!entry || value === activeProjectKey) {
            return;
          }
          selectProject(entry.targetProject, entry.group.projectKey);
        }}
      >
        {menuEntries.map(({ group }) => {
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
  );

  // Chat drafts show a plain "Chat" chip; project drafts show the project
  // with an x that drops into chat in one click. Both open the same menu.
  const projectChip = !canChooseProject ? (
    <Button variant="outline" size="sm" onClick={openAddProject}>
      <FolderPlusIcon />
      Add a project
    </Button>
  ) : isChatDraft || activeProject === null ? (
    <Menu>
      <MenuTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label={
          isChatDraft ? "Chatting without a project. Choose a project" : "Choose a project"
        }
        className="max-w-64 font-normal"
      >
        <MessageCircleIcon />
        <span className="truncate">{isChatDraft ? "Chat" : "Choose a project"}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      {projectMenu}
    </Menu>
  ) : (
    <span className="inline-flex max-w-full items-center">
      <Menu>
        <MenuTrigger
          render={<Button variant="outline" size="sm" />}
          aria-label="Change project"
          className={canJustChat ? "max-w-64 rounded-e-none font-normal" : "max-w-64 font-normal"}
        >
          <ProjectFavicon project={activeProject} className="size-4 shrink-0" />
          <span className="truncate">{activeProjectDisplayName}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
        </MenuTrigger>
        {projectMenu}
      </Menu>
      {canJustChat ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Just chat"
                className="-ms-px rounded-s-none"
                onClick={() => void startChat()}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">Just chat, no project</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        What should we work on?
      </h1>
      <div className="mx-auto mt-6 flex h-8 w-full max-w-3xl items-center">{projectChip}</div>
    </div>
  );
}
