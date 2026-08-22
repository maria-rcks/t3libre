import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Effect, pipe } from 'effect';
import { apiClientEffect, NetworkError } from '../lib/effect';
import type {
  DockerApp,
  ServerPermissionSet,
  ServerRoleAssignment,
  ServerSnapshot,
  ServerWorkspace,
} from '../lib/types';

const SERVER_PERMISSIONS: Array<keyof ServerPermissionSet> = [
  'start',
  'stop',
  'console',
  'files',
  'backups',
  'deployments',
];

const permissionLabels: Record<keyof ServerPermissionSet, string> = {
  start: 'Start',
  stop: 'Stop',
  console: 'Konsole',
  files: 'Dateien',
  backups: 'Backups',
  deployments: 'Deployments',
};

interface ServerOperationsHubProps {
  app: DockerApp;
  onCloned?: (clone: DockerApp) => void;
}

export function ServerOperationsHub({ app, onCloned }: ServerOperationsHubProps) {
  const [cloneName, setCloneName] = useState(`${app.name}-clone`);
  const [snapshots, setSnapshots] = useState<ServerSnapshot[]>([]);
  const [roles, setRoles] = useState<ServerRoleAssignment[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [workspaces, setWorkspaces] = useState<ServerWorkspace[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [roleEmail, setRoleEmail] = useState('ops@example.com');
  const [snapshotName, setSnapshotName] = useState(`${app.name} manual snapshot`);
  const [workspaceName, setWorkspaceName] = useState('Kundenprojekt Alpha');
  const [loading, setLoading] = useState(true);

  const latestSnapshot = snapshots[0];
  const hasAllCriticalPermissions = useMemo(
    () => roles.some((role) => SERVER_PERMISSIONS.every((permission) => role.permissions[permission])),
    [roles]
  );

  useEffect(() => {
    const program = pipe(
      Effect.all([
        apiClientEffect.listServerSnapshots(app.id),
        apiClientEffect.listServerRoles(app.id),
        apiClientEffect.getAutopilotRecommendations(app.id),
        apiClientEffect.listWorkspaces(),
        apiClientEffect.getServerBilling(app.id),
      ]),
      Effect.tap(([snapshotData, roleData, autopilotData, workspaceData, billingData]) =>
        Effect.sync(() => {
          setSnapshots(snapshotData);
          setRoles(roleData as ServerRoleAssignment[]);
          setRecommendations(autopilotData);
          setWorkspaces(workspaceData);
          setBilling(billingData);
        })
      ),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          if (error instanceof NetworkError) {
            toast.error('Netzwerkfehler beim Laden der Server-Operationen');
          } else {
            toast.error('Server-Operations konnten nicht geladen werden');
          }
        })
      ),
      Effect.ensuring(Effect.sync(() => setLoading(false)))
    );

    const cancel = Effect.runCallback(program, {
      onInterrupt: () => setLoading(false),
    });
    return cancel;
  }, [app.id]);

  const cloneServer = () => {
    Effect.runPromise(
      pipe(
        apiClientEffect.cloneServer(app.id, { name: cloneName, includeBackups: true, includeFiles: true }),
        Effect.tap((clone) => Effect.sync(() => {
          toast.success(`Server ${clone.name} wurde dupliziert`);
          onCloned?.(clone);
        })),
        Effect.catchAll(() => Effect.sync(() => toast.error('Server konnte nicht dupliziert werden')))
      )
    );
  };

  const createSnapshot = (schedule: 'manual' | 'automatic') => {
    Effect.runPromise(
      pipe(
        apiClientEffect.createServerSnapshot(app.id, { name: snapshotName, schedule }),
        Effect.tap((snapshot) => Effect.sync(() => {
          setSnapshots((current) => [snapshot, ...current]);
          toast.success('Snapshot wurde erstellt');
        })),
        Effect.catchAll(() => Effect.sync(() => toast.error('Snapshot konnte nicht erstellt werden')))
      )
    );
  };

  const restoreSnapshot = (snapshotId: string) => {
    Effect.runPromise(
      pipe(
        apiClientEffect.restoreServerSnapshot(app.id, snapshotId),
        Effect.tap(() => Effect.sync(() => toast.success('Snapshot-Restore wurde eingeplant'))),
        Effect.catchAll(() => Effect.sync(() => toast.error('Snapshot konnte nicht wiederhergestellt werden')))
      )
    );
  };

  const addRole = () => {
    Effect.runPromise(
      pipe(
        apiClientEffect.upsertServerRole(app.id, {
          principal: roleEmail,
          role: 'operator',
          permissions: { start: true, stop: true, console: true, files: false, backups: true, deployments: false },
        }),
        Effect.tap((assignment) => Effect.sync(() => {
          setRoles((current) => [assignment, ...current.filter((r) => r.id !== assignment.id)]);
          toast.success('Rollenrechte gespeichert');
        })),
        Effect.catchAll(() => Effect.sync(() => toast.error('Rollenrechte konnten nicht gespeichert werden')))
      )
    );
  };

  const createWorkspace = () => {
    Effect.runPromise(
      pipe(
        apiClientEffect.createWorkspace({ name: workspaceName, appIds: [app.id] }),
        Effect.tap((workspace) => Effect.sync(() => {
          setWorkspaces((current) => [workspace, ...current]);
          toast.success('Workspace wurde erstellt');
        })),
        Effect.catchAll(() => Effect.sync(() => toast.error('Workspace konnte nicht erstellt werden')))
      )
    );
  };

  const installPlugin = (pluginId: string) => {
    Effect.runPromise(
      pipe(
        apiClientEffect.installServerPlugin(app.id, pluginId),
        Effect.tap(() => Effect.sync(() => toast.success('Plugin/Mod wurde installiert'))),
        Effect.catchAll(() => Effect.sync(() => toast.error('Plugin/Mod konnte nicht installiert werden')))
      )
    );
  };

  if (loading) {
    return <div className="text-slate-400">Lade Server-Automation...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-xs uppercase tracking-wide text-blue-300">1-Klick Clone</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Server vollständig duplizieren</h3>
          <p className="mt-2 text-sm text-slate-400">Kopiert Konfiguration, Ports, Volumes, Labels, Dateien und Backup-Verknüpfungen in eine neue Instanz.</p>
          <input
            value={cloneName}
            onChange={(event) => setCloneName(event.target.value)}
            className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          />
          <button onClick={cloneServer} className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Clone jetzt erstellen
          </button>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-xs uppercase tracking-wide text-emerald-300">Snapshots</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Zeitpunkte sichern & wiederherstellen</h3>
          <input
            value={snapshotName}
            onChange={(event) => setSnapshotName(event.target.value)}
            className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => createSnapshot('manual')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Manuell</button>
            <button onClick={() => createSnapshot('automatic')} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600">Auto-Plan</button>
          </div>
          {latestSnapshot && <p className="mt-3 text-xs text-slate-400">Letzter Punkt: {latestSnapshot.name} · {new Date(latestSnapshot.createdAt).toLocaleString()}</p>}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-xs uppercase tracking-wide text-purple-300">Abrechnung</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Kosten pro Server/Projekt</h3>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-bold text-white">€{billing?.monthlyEstimate.toFixed(2)}</p><p className="text-xs text-slate-400">Monat</p></div>
            <div><p className="text-2xl font-bold text-white">€{billing?.currentMonth.toFixed(2)}</p><p className="text-xs text-slate-400">Aktuell</p></div>
            <div><p className="text-2xl font-bold text-white">{billing?.lineItems.length}</p><p className="text-xs text-slate-400">Positionen</p></div>
          </div>
          <p className="mt-3 text-xs text-slate-400">CPU, RAM, Storage, Backups und Netzwerk werden getrennt ausgewiesen.</p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-amber-300">Rollen & Rechte</p>
              <h3 className="text-lg font-semibold text-white">Granulare Server-Berechtigungen</h3>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs ${hasAllCriticalPermissions ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>{hasAllCriticalPermissions ? 'Admin vorhanden' : 'Review nötig'}</span>
          </div>
          <div className="mt-4 flex gap-2">
            <input value={roleEmail} onChange={(event) => setRoleEmail(event.target.value)} className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" />
            <button onClick={addRole} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Zuweisen</button>
          </div>
          <div className="mt-4 space-y-2">
            {roles.map((role) => (
              <div key={role.id} className="rounded-lg bg-slate-800 p-3">
                <div className="flex justify-between text-sm"><span className="font-medium text-white">{role.principal}</span><span className="text-slate-400">{role.role}</span></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SERVER_PERMISSIONS.map((permission) => (
                    <span key={permission} className={`rounded-full px-2 py-1 text-xs ${role.permissions[permission] ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-700 text-slate-400'}`}>{permissionLabels[permission]}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-xs uppercase tracking-wide text-cyan-300">Ressourcen-Autopilot</p>
          <h3 className="text-lg font-semibold text-white">Lastspitzen erkennen und Limits vorschlagen</h3>
          <div className="mt-4 space-y-3">
            {recommendations.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-sm text-slate-400">{item.description}</p></div>
                  <span className="rounded-full bg-cyan-500/15 px-2 py-1 text-xs text-cyan-300">{item.confidence}%</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">Empfehlung: {item.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 xl:col-span-2">
          <p className="text-xs uppercase tracking-wide text-pink-300">Plugin-/Mod-Manager</p>
          <h3 className="text-lg font-semibold text-white">Suchen, installieren, updaten, entfernen</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {['paper-optimizations', 'worldedit', 'fabric-api'].map((plugin) => (
              <div key={plugin} className="rounded-lg bg-slate-800 p-3">
                <p className="font-medium text-white">{plugin}</p>
                <p className="mt-1 text-xs text-slate-400">Kompatibel mit Templates und Rollback-fähig.</p>
                <button onClick={() => installPlugin(plugin)} className="mt-3 rounded bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white">Installieren/Updaten</button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-xs uppercase tracking-wide text-orange-300">Team-Workspace</p>
          <h3 className="text-lg font-semibold text-white">Kunden & Projekte bündeln</h3>
          <div className="mt-4 flex gap-2">
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" />
            <button onClick={createWorkspace} className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white">Neu</button>
          </div>
          <div className="mt-4 space-y-2">
            {workspaces.slice(0, 3).map((workspace) => (
              <div key={workspace.id} className="rounded-lg bg-slate-800 p-3 text-sm text-slate-300">
                <p className="font-medium text-white">{workspace.name}</p>
                <p className="text-xs text-slate-400">{workspace.appIds.length} Server · {workspace.memberCount} Mitglieder · gemeinsame Logs/Backups</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <p className="text-xs uppercase tracking-wide text-emerald-300">Snapshot-Historie</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="rounded-lg bg-slate-800 p-3">
              <p className="font-medium text-white">{snapshot.name}</p>
              <p className="text-xs text-slate-400">{snapshot.schedule} · {snapshot.sizeMb} MB · {snapshot.status}</p>
              <button onClick={() => restoreSnapshot(snapshot.id)} className="mt-3 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Rollback</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
