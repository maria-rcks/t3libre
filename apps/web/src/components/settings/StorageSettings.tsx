import type {
  StorageCleanupReport,
  StorageCleanupSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { CheckIcon, CircleAlertIcon, MinusIcon } from "lucide-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { toastManager } from "../ui/toast";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function WorktreesDirectoryRow() {
  const { connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  const edited = useRef(false);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={
        "Folder where new worktrees are created, on any drive, such as D:\\worktrees or ~/worktrees. Existing worktrees stay where they are. Leave empty to use the T3 home folder."
      }
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label="worktree location"
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={`${scopeKey}:${mixed}:${settings.worktreesDirectory}`}
          aria-label="Worktree location"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={mixed ? "Mixed" : "Default"}
          defaultValue={mixed ? "" : settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.worktreesDirectory))
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={1}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(1, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${label}`} />
            <NumberFieldInput
              aria-label={`${label} in days`}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              days
            </span>
            <NumberFieldIncrement aria-label={`Increase ${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

const KEEP_WHEN_LABELS = {
  "any-local-files": "Any local files",
  "uncommitted-changes": "Uncommitted changes",
  "tracked-changes": "Edited tracked files",
} as const;

function cleanupSummary(report: StorageCleanupReport | null) {
  if (report === null) return "Hasn't run yet";
  return `Last ${report.trigger} run ${formatRelativeTimeLabel(report.finishedAt)}: removed ${report.counts.removed}, kept ${report.counts.kept}, ${report.counts.failed} failed`;
}

function CleanupSection() {
  const { connectedEnvironments } = useSettingsScope();
  const [pending, setPending] = useState(false);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
  );
  const state = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) =>
          connectedEnvironments.flatMap((environment) => {
            if (environment.serverConfig?.environment.capabilities.storageCleanupRun !== true)
              return [];
            const query = get(
              serverEnvironment.storageCleanupReport({
                environmentId: environment.environmentId,
                input: {},
              }),
            );
            return [
              {
                environmentId: environment.environmentId,
                allowed: get(
                  serverEnvironment.runStorageCleanup.permissionAtom(environment.environmentId),
                ),
                report: query._tag === "Success" ? query.value : null,
                loading: query.waiting,
                failed: query._tag === "Failure",
              },
            ];
          }),
        ),
      [connectedEnvironments],
    ),
  );
  const hasRules = supported.some((environment) => {
    const settings = environment.serverConfig?.settings;
    if (!settings) return false;
    const enabled = (rules: WorktreeCleanupRules) =>
      rules.worktreeAfterDays !== null ||
      rules.worktreeOnMerge ||
      rules.worktreeOnDelete ||
      rules.worktreeUnchanged;
    return (
      settings.storageCleanup.browserArtifactsAfterDays !== null ||
      settings.storageCleanup.logsAfterDays !== null ||
      enabled(resolveWorktreeCleanup(settings, null)) ||
      Object.values(settings.projectSettingsOverrides).some(
        (override) =>
          override.worktreeCleanup?.mode === "custom" && enabled(override.worktreeCleanup.rules),
      )
    );
  });
  if (supported.length === 0) return null;
  const summaries = supported.map((environment) => {
    const query = state.find((entry) => entry.environmentId === environment.environmentId);
    const report = query?.report ?? null;
    return {
      environment,
      report,
      description: report
        ? cleanupSummary(report)
        : query?.failed
          ? "Could not load the last run"
          : query?.loading
            ? "Loading last run…"
            : "Hasn't run yet",
    };
  });
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    try {
      await Promise.all(
        supported.map(async (environment) => {
          const result = await run({ environmentId: environment.environmentId, input: {} });
          if (result._tag === "Success") {
            const failures = result.value.entries.filter((entry) => entry.outcome === "failed");
            if (failures.length > 0)
              toastManager.add({
                type: "error",
                title: `Cleanup failed on ${environment.label}`,
                description: failures[0]!.reason,
              });
          } else if (!isAtomCommandInterrupted(result)) {
            toastManager.add({
              type: "error",
              title: `Could not run cleanup on ${environment.label}`,
              description: String(squashAtomCommandFailure(result)),
            });
          }
        }),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <SettingsSection id="storage-cleanup" title="Cleanup">
      <SettingsRow
        {...searchableSetting("storage-delete-now")}
        description={
          <span className="space-y-1">
            {summaries.map(({ environment, description }) => (
              <span key={environment.environmentId} className="block">
                {supported.length > 1 ? `${environment.label}: ` : ""}
                {description}
              </span>
            ))}
          </span>
        }
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !hasRules || state.some((entry) => !entry.allowed)}
            onClick={() => void deleteNow()}
          >
            {pending ? "Deleting…" : "Delete now"}
          </Button>
        }
      />
      <div aria-live="polite">
        {summaries.map(({ environment, report }) =>
          report && report.entries.length > 0 ? (
            <ul
              key={environment.environmentId}
              aria-label={`Cleanup results for ${environment.label}`}
              className="max-h-80 space-y-3 overflow-y-auto border-t border-border px-3 py-3 sm:px-4"
            >
              {report.entries.map((entry, index) => {
                const Icon =
                  entry.outcome === "failed"
                    ? CircleAlertIcon
                    : entry.outcome === "removed"
                      ? CheckIcon
                      : MinusIcon;
                const name =
                  entry.kind === "worktree"
                    ? (entry.path?.split(/[\\/]/).findLast(Boolean) ?? "Worktrees")
                    : entry.kind === "logs"
                      ? "Rotated logs"
                      : "Browser artifacts";
                return (
                  <li
                    key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
                    className="flex items-start gap-2 text-xs"
                  >
                    <Icon
                      aria-hidden="true"
                      className={`mt-0.5 size-3.5 shrink-0 ${entry.outcome === "failed" ? "text-destructive" : entry.outcome === "removed" ? "text-success-foreground" : "text-muted-foreground"}`}
                    />
                    <div className="min-w-0">
                      <Tooltip>
                        <TooltipTrigger render={<p className="break-words text-foreground" />}>
                          {supported.length > 1 ? `${environment.label} · ` : ""}
                          {name}
                          {entry.threadTitle ? ` · ${entry.threadTitle}` : ""}
                        </TooltipTrigger>
                        {entry.path && <TooltipPopup>{entry.path}</TooltipPopup>}
                      </Tooltip>
                      <p
                        className={`break-words ${entry.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {entry.reason}
                      </p>
                    </div>
                  </li>
                );
              })}
              {report.omittedCount > 0 && (
                <li className="text-xs text-muted-foreground">and {report.omittedCount} more</li>
              )}
            </ul>
          ) : null,
        )}
      </div>
    </SettingsSection>
  );
}

export function StorageSettingsPanel() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice target="all">
        Update the selected machines to configure project worktree cleanup.
      </SettingsScopeNotice>
    );
  }

  if (
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId)}
      >
        Update the selected environments to use storage cleanup, or choose a machine that supports
        it.
      </SettingsScopeNotice>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection id="storage-worktrees" title="Worktrees">
        {!isProjectScope && <WorktreesDirectoryRow />}
        {isProjectScope && (
          <SettingsRow
            title="Automatic worktree cleanup"
            description={
              mode === "off"
                ? "Keep this project's worktrees until you delete them manually."
                : mode === "custom"
                  ? "Use these rules for this project."
                  : "Use each machine's worktree cleanup settings."
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label="Automatic worktree cleanup">
                  <SelectValue>
                    {mixedModes
                      ? "Mixed"
                      : mode === "inherit"
                        ? "Inherit"
                        : mode === "off"
                          ? "Off"
                          : "Custom"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">Inherit</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title="Delete worktrees with deleted threads"
              status={ruleStatus("worktreeOnDelete")}
              description="Remove unused worktrees when active or archived threads are deleted. The local changes rule controls which files are kept."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete worktrees with deleted threads"
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title="Delete inactive worktrees"
              status={ruleStatus("worktreeAfterDays")}
              description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept."
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label="Delete inactive worktrees"
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <SettingsRow
              title="Delete merged worktrees"
              status={ruleStatus("worktreeOnMerge")}
              description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete merged worktrees"
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title="Delete unchanged worktrees"
              status={ruleStatus("worktreeUnchanged")}
              description="Remove worktrees with no commits beyond the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete unchanged worktrees"
                  checked={settings.worktreeUnchanged}
                  onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                />
              }
            />
            {connectedEnvironments.every(
              (environment) =>
                environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
            ) && (
              <SettingsRow
                {...searchableSetting("storage-worktree-keep-when")}
                status={ruleStatus("worktreeKeepWhen")}
                description={
                  settings.worktreeKeepWhen === "any-local-files"
                    ? "Keep worktrees containing local files, including ignored files except node_modules."
                    : settings.worktreeKeepWhen === "tracked-changes"
                      ? "Keep edited tracked files. Untracked and ignored files, including .env and build output, are deleted with the worktree."
                      : "Keep tracked edits and untracked files. Ignored files, including .env and build output, are deleted with the worktree."
                }
                serverScoped={!isProjectScope}
                control={
                  <Select
                    value={ruleStatus("worktreeKeepWhen") ? null : settings.worktreeKeepWhen}
                    onValueChange={(next) => {
                      if (
                        next === "any-local-files" ||
                        next === "uncommitted-changes" ||
                        next === "tracked-changes"
                      )
                        updateWorktree({ worktreeKeepWhen: next });
                    }}
                  >
                    <SelectTrigger size="sm" aria-label="Keep worktrees with local changes">
                      <SelectValue>
                        {ruleStatus("worktreeKeepWhen")
                          ? "Mixed"
                          : KEEP_WHEN_LABELS[settings.worktreeKeepWhen]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="any-local-files">Any local files</SelectItem>
                      <SelectItem value="uncommitted-changes">Uncommitted changes</SelectItem>
                      <SelectItem value="tracked-changes">Edited tracked files</SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
            )}
          </>
        )}
      </SettingsSection>

      {!isProjectScope && (
        <SettingsSection id="storage-artifacts" title="Artifacts and logs">
          <SettingsRow
            title="Delete old browser artifacts"
            status={ruleStatus("browserArtifactsAfterDays")}
            description="Delete saved browser captures after this many days. Older capture links will no longer open."
            serverScoped
            control={
              <RetentionControl
                label="Delete old browser artifacts"
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title="Delete old rotated logs"
            status={ruleStatus("logsAfterDays")}
            description="Delete inactive rotated log files after this many days. Current logs are kept."
            serverScoped
            control={
              <RetentionControl
                label="Delete old rotated logs"
                value={settings.logsAfterDays}
                onChange={(logsAfterDays) => update({ logsAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
      {!isProjectScope && <CleanupSection />}
    </SettingsPageContainer>
  );
}
