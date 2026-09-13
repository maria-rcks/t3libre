import type { EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

const CATEGORIES = [
  { key: "worktrees", label: "Worktrees" },
  { key: "browserArtifacts", label: "Browser captures" },
  { key: "logs", label: "Logs" },
  { key: "attachments", label: "Attachments" },
  { key: "other", label: "Other T3 files" },
] as const;

function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index =
    bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

function MachineStorageUsage({ environment }: { environment: EnvironmentPresentation }) {
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const supported = environment.serverConfig?.environment.capabilities.storageUsage === true;
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    connected && supported
      ? serverEnvironment.storageUsage({
          environmentId: environment.environmentId,
          input: { refresh: true },
        })
      : null,
  );
  return (
    <div className="space-y-4 px-3 py-4 sm:px-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{environment.label}</div>
          {environment.displayUrl ? (
            <div className="truncate text-xs text-muted-foreground">{environment.displayUrl}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {data ? (
            <div className="text-right">
              <div className="text-sm font-medium tabular-nums">
                {data.partial ? "At least " : ""}
                {formatBytes(data.totalBytes)}
              </div>
              <div className="text-xs text-muted-foreground">T3 files</div>
            </div>
          ) : null}
          {connected && supported ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Refresh storage usage for ${environment.label}`}
              onClick={refresh}
              disabled={isPending}
            >
              <RefreshIcon refreshing={isPending} />
            </Button>
          ) : null}
        </div>
      </div>
      {!connected ? (
        <p className="text-xs text-muted-foreground">Offline</p>
      ) : !supported ? (
        <p className="text-xs text-muted-foreground">Update this server to see storage usage.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          Couldn't measure storage usage. Try refreshing.
        </p>
      ) : null}
      {connected && supported && data === null && !error ? (
        <p role="status" className="text-xs text-muted-foreground">
          Measuring storage usage...
        </p>
      ) : null}
      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {CATEGORIES.map(({ key, label }) => (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm tabular-nums">
                  {data.categories[key].partial ? "≥ " : ""}
                  {formatBytes(data.categories[key].bytes)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {data.disk
                ? `${formatBytes(data.disk.availableBytes)} available of ${formatBytes(data.disk.totalBytes)}`
                : "Disk capacity unavailable"}
            </span>
            <span>
              Measured{" "}
              {new Date(data.sampledAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {data.partial ? (
            <p className="text-xs text-warning">
              Some files couldn't be measured. Sizes shown are a lower bound.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function StorageUsageSection() {
  const { environments } = useSettingsScope();
  return (
    <SettingsSection id="storage-usage" title="Disk usage">
      {environments.map((environment) => (
        <MachineStorageUsage key={environment.environmentId} environment={environment} />
      ))}
      {environments.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
          Connect an environment to see storage usage.
        </p>
      ) : null}
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
        File sizes in this environment's T3 storage. Linked files aren't followed.
      </p>
    </SettingsSection>
  );
}
