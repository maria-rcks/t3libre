import { DEFAULT_SERVER_SETTINGS, type StorageCleanupSettings } from "@t3tools/contracts";
import { useState } from "react";

import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

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
          className="w-40"
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
              className="text-right in-data-[size=sm]:px-1"
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

export function StorageSettingsPanel() {
  const { scope, connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings(
    (value) => value.storageCleanup ?? DEFAULT_SERVER_SETTINGS.storageCleanup,
  );
  const updateSettings = useUpdateScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some((target) => target.settings.storageCleanup[key] !== settings[key])
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });

  if (scope.kind === "project" || scope.kind === "checkout") {
    return (
      <SettingsScopeNotice target="all">
        Storage cleanup applies to machines. Choose all environments or a single machine to manage
        its files.
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
        <SettingsRow
          title="Delete worktrees with deleted threads"
          status={ruleStatus("worktreeOnDelete")}
          description="Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept."
          serverScoped
          control={
            <Switch
              aria-label="Delete worktrees with deleted threads"
              checked={settings.worktreeOnDelete}
              onCheckedChange={(worktreeOnDelete) => update({ worktreeOnDelete })}
            />
          }
        />
        <SettingsRow
          title="Delete inactive worktrees"
          status={ruleStatus("worktreeAfterDays")}
          description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept."
          serverScoped
          control={
            <RetentionControl
              label="Delete inactive worktrees"
              value={settings.worktreeAfterDays}
              onChange={(worktreeAfterDays) => update({ worktreeAfterDays })}
            />
          }
        />
        <SettingsRow
          title="Delete merged worktrees"
          status={ruleStatus("worktreeOnMerge")}
          description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
          serverScoped
          control={
            <Switch
              aria-label="Delete merged worktrees"
              checked={settings.worktreeOnMerge}
              onCheckedChange={(worktreeOnMerge) => update({ worktreeOnMerge })}
            />
          }
        />
        <SettingsRow
          title="Delete unchanged worktrees"
          status={ruleStatus("worktreeUnchanged")}
          description="Remove worktrees with no commits beyond the default branch."
          serverScoped
          control={
            <Switch
              aria-label="Delete unchanged worktrees"
              checked={settings.worktreeUnchanged}
              onCheckedChange={(worktreeUnchanged) => update({ worktreeUnchanged })}
            />
          }
        />
      </SettingsSection>

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
    </SettingsPageContainer>
  );
}
