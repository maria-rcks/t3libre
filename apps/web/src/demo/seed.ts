/**
 * Seeds first-visit client state for the demo: Sidebar V2 on, the fake remote
 * machines registered in the connection catalog (so T3 Connect environments
 * show up and connect through the demo transport), and the browser panel open
 * on a couple of showcase threads. Existing state is never overwritten, so a
 * visitor's own toggles and panel layout persist across reloads.
 */
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { EnvironmentId } from "@t3tools/contracts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import * as Schema from "effect/Schema";

import { readBrowserClientSettings, writeBrowserClientSettings } from "../clientPersistenceStorage";
import { demoBrowserPanelThreadKeys, demoEnvironments } from "./fixtures";

const CONNECTION_DATABASE_NAME = "t3code:connection-runtime";
const CONNECTION_DATABASE_VERSION = 4;
const CATALOG_STORE_NAME = "catalog";
const CATALOG_KEY = "document";

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 7;

const DIFF_PANEL_STORAGE_KEY = "t3code:diff-panel-state:v1";
const DIFF_PANEL_STORAGE_VERSION = 1;

/**
 * Identifies the fixture generation the visitor's persisted state was seeded
 * from. When the fixtures change (new environments/threads), stale seeded
 * state would reference machines that no longer exist, so it is re-seeded.
 */
const DEMO_SEED_VERSION_KEY = "t3code:demo-seed-version";
const DEMO_SEED_VERSION = demoEnvironments
  .map((environment) => environment.environmentId)
  .join("|");

const encodeCatalogDocument = Schema.encodeSync(Schema.fromJsonString(ConnectionCatalogDocument));

function demoCatalogDocument(): string {
  const remotes = demoEnvironments.filter(
    (environment) => environment.origin !== null && environment.bearerToken !== null,
  );
  return encodeCatalogDocument({
    schemaVersion: 1,
    targets: remotes.map(
      (environment) =>
        new BearerConnectionTarget({
          environmentId: EnvironmentId.make(environment.environmentId),
          label: environment.label,
          connectionId: `demo-connection-${environment.environmentId}`,
        }),
    ),
    profiles: remotes.map(
      (environment) =>
        new BearerConnectionProfile({
          connectionId: `demo-connection-${environment.environmentId}`,
          environmentId: EnvironmentId.make(environment.environmentId),
          label: environment.label,
          httpBaseUrl: environment.origin as string,
          wsBaseUrl: (environment.origin as string).replace(/^http/, "ws"),
        }),
    ),
    credentials: remotes.map((environment) => ({
      connectionId: `demo-connection-${environment.environmentId}`,
      credential: new BearerConnectionCredential({ token: environment.bearerToken as string }),
    })),
    remoteDpopTokens: [],
  });
}

/** Registers the fake remote machines unless a current catalog already exists. */
function seedConnectionCatalog(force: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const request = indexedDB.open(CONNECTION_DATABASE_NAME, CONNECTION_DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      // Mirror the store set the app's connection storage creates, so the
      // app's own open() (same version) does not need another upgrade.
      for (const store of ["catalog", "shell", "thread", "server-config", "vcs-refs"]) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store);
        }
      }
    });
    request.addEventListener("error", () => resolve());
    request.addEventListener("success", () => {
      const database = request.result;
      const read = database
        .transaction(CATALOG_STORE_NAME, "readonly")
        .objectStore(CATALOG_STORE_NAME)
        .get(CATALOG_KEY);
      read.addEventListener("error", () => {
        database.close();
        resolve();
      });
      read.addEventListener("success", () => {
        if (!force && typeof read.result === "string" && read.result.trim() !== "") {
          database.close();
          resolve();
          return;
        }
        const staleStores = ["shell", "thread", "server-config", "vcs-refs"].filter((store) =>
          database.objectStoreNames.contains(store),
        );
        const write = database.transaction([CATALOG_STORE_NAME, ...staleStores], "readwrite");
        for (const store of staleStores) {
          write.objectStore(store).clear();
        }
        write.objectStore(CATALOG_STORE_NAME).put(demoCatalogDocument(), CATALOG_KEY);
        write.addEventListener("complete", () => {
          database.close();
          resolve();
        });
        write.addEventListener("error", () => {
          database.close();
          resolve();
        });
      });
    });
  });
}

/**
 * Opens the right panel (on the diff surface — the browser preview needs the
 * desktop bridge) on the showcase threads for first-time visitors.
 */
function seedRightPanelState(force: boolean): void {
  if (!force && window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY) !== null) {
    return;
  }
  const byThreadKey = Object.fromEntries(
    demoBrowserPanelThreadKeys.map((threadKey) => [
      threadKey,
      {
        isOpen: true,
        activeSurfaceId: "diff",
        surfaces: [{ id: "diff", kind: "diff" }],
      },
    ]),
  );
  window.localStorage.setItem(
    RIGHT_PANEL_STORAGE_KEY,
    JSON.stringify({ state: { byThreadKey }, version: RIGHT_PANEL_STORAGE_VERSION }),
  );
}

/**
 * Points the diff panel at the latest checkpoint on the showcase thread so the
 * rendered diff (not an empty working-tree view) greets first-time visitors.
 */
function seedDiffPanelSelection(force: boolean): void {
  if (!force && window.localStorage.getItem(DIFF_PANEL_STORAGE_KEY) !== null) {
    return;
  }
  window.localStorage.setItem(
    DIFF_PANEL_STORAGE_KEY,
    JSON.stringify({
      state: {
        byThreadKey: {
          "demo-mac-studio:thread-composer": {
            kind: "turn",
            turnId: "thread-composer-turn-0",
            filePath: null,
            revealRequestId: 1,
          },
        },
        branchBaseRefByThreadKey: {},
      },
      version: DIFF_PANEL_STORAGE_VERSION,
    }),
  );
}

export async function seedDemoClientState(): Promise<void> {
  // The demo showcases the Sidebar v2 beta by default; visitors can still
  // toggle it in Settings, and their choice persists.
  if (readBrowserClientSettings() === null) {
    writeBrowserClientSettings({ ...DEFAULT_CLIENT_SETTINGS, sidebarV2Enabled: true });
  }
  const staleFixtures = window.localStorage.getItem(DEMO_SEED_VERSION_KEY) !== DEMO_SEED_VERSION;
  seedRightPanelState(staleFixtures);
  seedDiffPanelSelection(staleFixtures);
  await seedConnectionCatalog(staleFixtures);
  window.localStorage.setItem(DEMO_SEED_VERSION_KEY, DEMO_SEED_VERSION);
}
