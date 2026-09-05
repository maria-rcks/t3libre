/**
 * Shared by the CLI bundler and Windows sidecar dependency selection.
 * Prefixes include platform siblings and native loaders' transitive dependencies:
 * external packages resolve their imports from disk, outside the bundle.
 */
export const CLI_RUNTIME_EXTERNAL_PREFIXES = [
  "node-pty",
  "ffi-rs",
  "@yuuang/",
  "@ff-labs/",
  "@clerk/electron-passkeys",
  "@msgpackr-extract/",
  "msgpackr-extract",
  "node-gyp-build",
  "node-addon-api",
  // node-gyp-build-optional-packages requires this on Linux/WSL.
  "detect-libc",
  // Optional ws addons must stay external so native loaders can locate prebuilds.
  "bufferutil",
  "utf-8-validate",
] as const;

/** Bun-only imports stay unbundled because Node cannot resolve their bun:* specifiers. */
export const CLI_BUILD_ONLY_EXTERNAL_PREFIXES = [
  "@effect/platform-bun",
  "@effect/sql-sqlite-bun",
] as const;

export const CLI_EXTERNAL_PACKAGE_PREFIXES = [
  ...CLI_RUNTIME_EXTERNAL_PREFIXES,
  ...CLI_BUILD_ONLY_EXTERNAL_PREFIXES,
] as const;

export function isRuntimeExternalCliDependency(id: string): boolean {
  return CLI_RUNTIME_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Use with neverBundle; returning false from alwaysBundle still bundles transitive imports. */
export function isExternalCliDependency(id: string): boolean {
  return CLI_EXTERNAL_PACKAGE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** True when the CLI bundle should inline `id` rather than leave it external. */
export function shouldBundleCliDependency(id: string): boolean {
  if (id.startsWith("node:")) return false;
  return !isExternalCliDependency(id);
}

/** Select direct dependency roots whose runtime closure belongs in the sidecar. */
export function selectCliRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => isRuntimeExternalCliDependency(name)),
  );
}

/**
 * Scan Rolldown regions for inlined packages. regionCount detects missing markers;
 * inlinedPackages lets callers verify that ordinary dependencies were bundled too.
 */
export function findInlinedExternalPackages(source: string): {
  readonly regionCount: number;
  readonly inlined: ReadonlyArray<string>;
  readonly inlinedPackages: ReadonlyArray<string>;
} {
  // Rolldown marks each inlined module with a `//#region <path>` comment.
  const regionPattern = /\/\/#region\s+(\S+)/g;
  const packagePattern = /node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g;

  let regionCount = 0;
  const inlined = new Set<string>();
  const inlinedPackages = new Set<string>();
  for (const region of source.matchAll(regionPattern)) {
    regionCount += 1;
    const regionPath = region[1] ?? "";
    for (const candidate of regionPath.matchAll(packagePattern)) {
      const name = candidate[1];
      if (name === undefined || name === ".pnpm") continue;
      inlinedPackages.add(name);
      if (isExternalCliDependency(name)) inlined.add(name);
    }
  }

  return {
    regionCount,
    inlined: [...inlined].sort(),
    inlinedPackages: [...inlinedPackages].sort(),
  };
}
