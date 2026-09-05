import type { EnvironmentId, ProjectScript } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { isElectron } from "../../env";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "../../projectScripts";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  type NewProjectScriptInput,
  type ProjectScriptEditorRequest,
} from "../projectScriptEditor";
import { Button } from "../ui/button";
import { ProjectActionsList } from "./ProjectActionsList";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

export function ProjectDefaultActionsSettings({
  environmentId,
}: {
  environmentId: EnvironmentId | null;
}) {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const targets = environments.filter(
    (environment) =>
      (environmentId === null || environment.environmentId === environmentId) &&
      environment.connection.phase === "connected" &&
      environment.serverConfig !== null,
  );
  const representative = targets[0]?.serverConfig;
  const scripts = representative?.settings.defaultProjectScripts ?? [];
  const keybindings = representative?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const mixed = targets.some(
    (target) =>
      JSON.stringify(target.serverConfig?.settings.defaultProjectScripts) !==
      JSON.stringify(scripts),
  );
  const [request, setRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "default actions update");
  const upsertKeybinding = useAtomCommand(
    serverEnvironment.upsertKeybinding,
    "default action shortcut update",
  );
  const removeKeybinding = useAtomCommand(
    serverEnvironment.removeKeybinding,
    "default action shortcut removal",
  );

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[],
    scriptId?: string,
    keybinding?: string | null,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0)
      return AsyncResult.failure(
        Cause.fail(new Error("No available machine, or another action change is saving.")),
      );
    savingRef.current = true;
    setSaving(true);
    try {
      for (const target of targets) {
        const config = target.serverConfig;
        if (!config) continue;
        const nextScripts = transform(config.settings.defaultProjectScripts);
        const result = await updateSettings({
          environmentId: target.environmentId,
          input: {
            patch: {
              defaultProjectScripts: nextScripts,
            },
          },
        });
        if (result._tag === "Failure") return mapAtomCommandResult(result, () => undefined);
        if (!isElectron || !scriptId) continue;
        const command = commandForProjectScript(scriptId);
        const previousValue = keybindingValueForCommand(config.keybindings, command);
        const previous = previousValue
          ? decodeProjectScriptKeybindingRule({ keybinding: previousValue, command })
          : null;
        const next = decodeProjectScriptKeybindingRule({ keybinding, command });
        if (next) {
          const bindingResult = await upsertKeybinding({
            environmentId: target.environmentId,
            input: previous && previous.key !== next.key ? { ...next, replace: previous } : next,
          });
          if (bindingResult._tag === "Failure")
            return mapAtomCommandResult(bindingResult, () => undefined);
        } else if (
          previous &&
          !(
            !nextScripts.some((script) => script.id === scriptId) &&
            (Object.values(config.settings.projectScriptOverrides).some((scripts) =>
              scripts?.some((script) => script.id === scriptId),
            ) ||
              projects.some(
                (project) =>
                  project.environmentId === target.environmentId &&
                  project.scripts.some((script) => script.id === scriptId),
              ))
          )
        ) {
          const bindingResult = await removeKeybinding({
            environmentId: target.environmentId,
            input: previous,
          });
          if (bindingResult._tag === "Failure")
            return mapAtomCommandResult(bindingResult, () => undefined);
        }
      }
      return AsyncResult.success(undefined);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function submit(scriptId: string | null, input: NewProjectScriptInput) {
    const existingIds = [
      ...projects.flatMap((project) => project.scripts.map((script) => script.id)),
      ...targets.flatMap((target) => {
        const settings = target.serverConfig?.settings;
        return settings
          ? [
              ...settings.defaultProjectScripts,
              ...Object.values(settings.projectScriptOverrides).flatMap((scripts) => scripts ?? []),
            ].map((script) => script.id)
          : [];
      }),
    ];
    const id = scriptId ?? nextProjectScriptId(input.name, existingIds);
    const next = buildProjectScript(id, input);
    return mapAtomCommandResult(
      await persist(
        (current) => {
          const updated = current.map((script) =>
            script.id === id
              ? next
              : input.runOnWorktreeCreate
                ? { ...script, runOnWorktreeCreate: false }
                : script,
          );
          return scriptId === null ? [...updated, next] : updated;
        },
        id,
        input.keybinding,
      ),
      () => undefined,
    );
  }

  return (
    <SettingsSection title="Actions">
      <SettingsRow
        title="Import scripts"
        aria-disabled
        description="Select a project to import actions from its checkout's t3.json."
        control={
          <Button size="xs" variant="ghost" disabled>
            Import scripts
          </Button>
        }
      />
      <SettingsRow
        title="Default actions"
        description="Available in every inheriting checkout. Commands run in that checkout or its worktree."
        resetAction={
          targets.some(
            (target) => (target.serverConfig?.settings.defaultProjectScripts.length ?? 0) > 0,
          ) ? (
            <SettingResetButton
              label="default actions"
              disabled={saving}
              onClick={() => void persist(() => [])}
            />
          ) : null
        }
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={saving || targets.length === 0}
            onClick={() => setRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT })}
          >
            <PlusIcon className="size-3.5" />
            Add action
          </Button>
        }
      />
      {mixed ? (
        <SettingsRow
          title="Different actions across machines"
          description="Select a machine to edit its actions. Adding an action applies to all selected connected machines."
        />
      ) : (
        <ProjectActionsList
          scripts={scripts}
          keybindings={keybindings}
          disabled={saving}
          onEdit={(script) => setRequest(editorRequestForScript(script, keybindings))}
        />
      )}
      <ProjectScriptEditorDialog
        request={request}
        scripts={scripts}
        onSubmit={submit}
        onDelete={(id) =>
          void persist((current) => current.filter((script) => script.id !== id), id, null)
        }
        onClose={() => setRequest(null)}
      />
    </SettingsSection>
  );
}
