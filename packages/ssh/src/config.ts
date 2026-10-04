import type { DesktopDiscoveredSshHost } from "@t3tools/contracts";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { SshHostDiscoveryError } from "./errors.ts";

const NO_HOSTS: ReadonlyArray<string> = [] as const;

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf("#");
  return (hashIndex >= 0 ? line.slice(0, hashIndex) : line).trim();
}

function splitDirectiveArgs(value: string): ReadonlyArray<string> {
  const args: Array<string> = [];
  for (const rawEntry of value
    .replace(/=(?!=)/gu, " ")
    .trim()
    .split(/\s+/u)) {
    const entry = rawEntry.trim();
    if (entry.length > 0) {
      args.push(entry);
    }
  }
  return args;
}

function expandHomePath(input: string, homeDir: string): string {
  return input.replace(/^~(?=$|\/|\\)/u, homeDir);
}

export const resolveSshConfigIncludePattern = Effect.fnUntraced(function* (
  includePattern: string,
  _directory: string,
  homeDir: string,
) {
  const path = yield* Path.Path;
  const expandedPattern = expandHomePath(includePattern, homeDir);
  return path.isAbsolute(expandedPattern)
    ? expandedPattern
    : path.resolve(path.join(homeDir, ".ssh"), expandedPattern);
});

function hasSshPattern(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.startsWith("!");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp(
    `^${escapeRegex(pattern).replace(/\\\*/gu, ".*").replace(/\\\?/gu, ".")}$`,
    "u",
  );
}

const expandGlob = Effect.fnUntraced(function* (pattern: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return (yield* fs.exists(pattern)) ? [pattern] : NO_HOSTS;
  }

  const directory = path.dirname(pattern);
  const basePattern = path.basename(pattern);
  if (!(yield* fs.exists(directory))) {
    return NO_HOSTS;
  }

  const matcher = globToRegExp(basePattern);
  const entries = yield* fs.readDirectory(directory);
  const matchedPaths: string[] = [];
  for (const entry of entries) {
    if (!matcher.test(entry)) {
      continue;
    }
    const entryPath = path.join(directory, entry);
    if (yield* fs.exists(entryPath)) {
      matchedPaths.push(entryPath);
    }
  }
  return matchedPaths.toSorted((left, right) => left.localeCompare(right));
});

interface SshTargetRule {
  readonly guards: ReadonlyArray<ReadonlyArray<string> | null>;
  readonly patterns: ReadonlyArray<string> | null;
  readonly directive: "hostname" | "port";
  readonly value: string;
}

function expandConfiguredHostname(hostname: string, alias: string): string | null {
  let supported = true;
  const expanded = hostname.replace(/%(.?)/gsu, (_, token: string) => {
    if (token === "h") return alias.toLowerCase();
    if (token === "%") return "%";
    supported = false;
    return "";
  });
  return supported ? expanded : null;
}

function matchesHostPatterns(alias: string, patterns: ReadonlyArray<string> | null): boolean {
  // Unknown Match conditions may apply; do not let a later value override them.
  if (patterns === null) return true;
  let matched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const candidate = negated ? pattern.slice(1) : pattern;
    if (!new RegExp(globToRegExp(candidate).source, "iu").test(alias)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

const collectSshConfigAliasesFromFile = Effect.fnUntraced(function* (
  filePath: string,
  visited = new Set<string>(),
  homeDir: string,
  context: {
    patterns: ReadonlyArray<string> | null;
    guards: ReadonlyArray<ReadonlyArray<string> | null>;
  },
  targetRules: Array<SshTargetRule>,
): Effect.fn.Return<
  ReadonlyArray<string>,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedPath = path.resolve(filePath);
  if (visited.has(resolvedPath) || !(yield* fs.exists(resolvedPath))) {
    return NO_HOSTS;
  }
  visited.add(resolvedPath);

  const aliases = new Set<string>();
  const directory = path.dirname(resolvedPath);
  const raw = yield* fs.readFileString(resolvedPath);

  for (const line of raw.split(/\r?\n/u)) {
    const stripped = stripInlineComment(line);
    if (stripped.length === 0) {
      continue;
    }

    const [directive = "", ...rawArgs] = splitDirectiveArgs(stripped);
    const normalizedDirective = directive.toLowerCase();
    if (normalizedDirective === "include") {
      for (const includePattern of rawArgs) {
        const resolvedPattern = yield* resolveSshConfigIncludePattern(
          includePattern,
          directory,
          homeDir,
        );
        const includedPaths = yield* expandGlob(resolvedPattern);
        for (const includedPath of includedPaths) {
          const includedAliases = yield* collectSshConfigAliasesFromFile(
            includedPath,
            visited,
            homeDir,
            {
              patterns: context.patterns,
              guards: [...context.guards, context.patterns],
            },
            targetRules,
          );
          for (const alias of includedAliases) {
            aliases.add(alias);
          }
        }
      }
      continue;
    }

    if (normalizedDirective !== "host") {
      if (normalizedDirective === "match") {
        const condition = rawArgs[0]?.toLowerCase();
        context.patterns =
          condition === "all" && rawArgs.length === 1
            ? ["*"]
            : condition === "originalhost" && rawArgs.length === 2
              ? (rawArgs[1]?.split(",") ?? [])
              : null;
      }
      if (normalizedDirective === "hostname" || normalizedDirective === "port") {
        const value = rawArgs[0]?.replace(/^(["'])(.*)\1$/u, "$2");
        if (value) {
          targetRules.push({
            guards: context.guards,
            patterns: context.patterns,
            directive: normalizedDirective,
            value,
          });
        }
      }
      continue;
    }

    context.patterns = rawArgs;
    for (const alias of rawArgs) {
      if (alias.length === 0 || hasSshPattern(alias)) {
        continue;
      }
      if (context.guards.every((guard) => matchesHostPatterns(alias, guard))) {
        aliases.add(alias);
      }
    }
  }

  visited.delete(resolvedPath);
  return [...aliases].toSorted((left, right) => left.localeCompare(right));
});

function normalizeKnownHostsHostname(rawHost: string): string {
  const bracketMatch = /^\[([^\]]+)\]:(\d+)$/u.exec(rawHost);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }

  if (!rawHost.includes(":")) {
    return rawHost;
  }

  const firstColonIndex = rawHost.indexOf(":");
  const lastColonIndex = rawHost.lastIndexOf(":");
  return firstColonIndex === lastColonIndex ? rawHost.slice(0, lastColonIndex) : rawHost;
}

export function parseKnownHostsHostnames(
  raw: string,
  excludedTargets: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> {
  const hostnames = new Set<string>();

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const withoutMarker = trimmed.startsWith("@")
      ? trimmed.split(/\s+/u).slice(1).join(" ")
      : trimmed;
    const [hostField = ""] = withoutMarker.split(/\s+/u);
    if (hostField.length === 0 || hostField.startsWith("|")) {
      continue;
    }

    for (const rawHost of hostField.split(",")) {
      const host = normalizeKnownHostsHostname(rawHost).trim();
      if (host.length === 0 || hasSshPattern(host)) {
        continue;
      }
      const explicitPort =
        /^\[[^\]]+\]:(\d+)$/u.exec(rawHost)?.[1] ?? /^[^:]+:(\d+)$/u.exec(rawHost)?.[1];
      const port = explicitPort ? Number(explicitPort) : 22;
      if (excludedTargets.has(`${host.toLowerCase()}\u0000${port}`)) {
        continue;
      }
      hostnames.add(host);
    }
  }

  return [...hostnames].toSorted((left, right) => left.localeCompare(right));
}

const readKnownHostsHostnames = Effect.fnUntraced(function* (
  filePath: string,
  excludedTargets: ReadonlySet<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(filePath))) {
    return NO_HOSTS;
  }
  return parseKnownHostsHostnames(yield* fs.readFileString(filePath), excludedTargets);
});

export const discoverSshHosts = Effect.fnUntraced(
  function* (input: { readonly homeDir?: string }) {
    const path = yield* Path.Path;
    const env = yield* Config.all({
      home: Config.String("HOME").pipe(Config.option),
      userProfile: Config.String("USERPROFILE").pipe(Config.option),
    });
    const homeDir =
      input?.homeDir ??
      Option.getOrUndefined(env.home) ??
      Option.getOrUndefined(env.userProfile) ??
      "";
    if (homeDir.trim().length === 0) {
      return [];
    }

    const sshDirectory = path.join(homeDir, ".ssh");
    const targetRules: Array<SshTargetRule> = [];
    const configAliases = yield* collectSshConfigAliasesFromFile(
      path.join(sshDirectory, "config"),
      new Set<string>(),
      homeDir,
      { patterns: ["*"], guards: [] },
      targetRules,
    );
    const discovered = new Map<string, DesktopDiscoveredSshHost>();
    const configuredTargets = new Set<string>();

    for (const alias of configAliases) {
      const hostnameRule = targetRules.find(
        (rule) =>
          rule.directive === "hostname" &&
          rule.guards.every((guard) => matchesHostPatterns(alias, guard)) &&
          matchesHostPatterns(alias, rule.patterns),
      );
      const configuredHostname = hostnameRule
        ? hostnameRule.patterns !== null && !hostnameRule.guards.includes(null)
          ? expandConfiguredHostname(hostnameRule.value, alias)
          : null
        : alias;
      const hostname = configuredHostname ?? alias;
      const portRule = targetRules.find(
        (rule) =>
          rule.directive === "port" &&
          rule.guards.every((guard) => matchesHostPatterns(alias, guard)) &&
          matchesHostPatterns(alias, rule.patterns),
      );
      const port = portRule
        ? portRule.patterns !== null && !portRule.guards.includes(null)
          ? Number(portRule.value)
          : Number.NaN
        : 22;
      if (configuredHostname && Number.isInteger(port) && port > 0 && port <= 65_535) {
        configuredTargets.add(`${hostname.toLowerCase()}\u0000${port}`);
      }
      discovered.set(alias, {
        alias,
        hostname,
        username: null,
        port: null,
        source: "ssh-config",
      });
    }

    const knownHosts = yield* readKnownHostsHostnames(
      path.join(sshDirectory, "known_hosts"),
      configuredTargets,
    );
    for (const hostname of knownHosts) {
      if (discovered.has(hostname)) {
        continue;
      }
      discovered.set(hostname, {
        alias: hostname,
        hostname,
        username: null,
        port: null,
        source: "known-hosts",
      });
    }

    return [...discovered.values()].toSorted((left, right) =>
      left.alias.localeCompare(right.alias),
    );
  },
  Effect.mapError(
    (cause) =>
      new SshHostDiscoveryError({
        message: "Failed to discover SSH hosts.",
        cause,
      }),
  ),
);
