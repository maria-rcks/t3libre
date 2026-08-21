import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import type {
  ChatAttachment,
  OpenCodeSettings,
  ProviderApprovalDecision,
  RuntimeMode,
} from "@t3tools/contracts";
import {
  createOpencodeClient,
  type Agent,
  type FilePartInput,
  type Model,
  type OpencodeClient,
  type PermissionRuleset,
  type ProviderListResponse,
  type QuestionAnswer,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { isWindowsCommandNotFound } from "../processRunner.ts";
import { collectStreamAsString } from "./providerSnapshot.ts";
import * as NetService from "@t3tools/shared/Net";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const OPENCODE_EMPTY_CONFIG_CONTENT = "{}";

export function resolveOpenCodeConfigContent(
  inputEnvironment: Readonly<Record<string, string | undefined>> | undefined,
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    inputEnvironment?.OPENCODE_CONFIG_CONTENT ??
    inheritedEnvironment.OPENCODE_CONFIG_CONTENT ??
    OPENCODE_EMPTY_CONFIG_CONTENT
  );
}

const OPENCODE_SERVER_READY_PREFIX = "opencode server listening";
const OPENCODE2_SERVER_READY_PREFIX = "server listening";
const OPENCODE2_SERVER_PASSWORD_PREFIX = "server password ";
const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTNAME = "127.0.0.1";

/**
 * Binary name of the OpenCode 2 preview. When the user has not pinned a
 * `binaryPath` (left at the `"opencode"` default), the driver upgrades to this
 * binary whenever it resolves on PATH — no settings change required.
 */
export const OPENCODE2_DEFAULT_BINARY = "opencode2";

export function isOpenCode2BinaryPath(binaryPath: string): boolean {
  return /(?:^|[\\/])opencode2(?:\.exe)?$/i.test(binaryPath.trim());
}

/**
 * Where the OpenCode 2 background service registers itself while running
 * (`~/.local/state/opencode/service.json` by default, `$XDG_STATE_HOME`
 * aware). Reading this file is how we detect an already-running server
 * instead of spawning our own.
 */
export function openCode2ServiceStateFile(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // Unix-only: discovery skips Windows entirely (see
  // discoverRegisteredOpenCode2Server), so forward slashes are correct.
  const stateHome = env.XDG_STATE_HOME?.trim() || `${NodeOS.homedir()}/.local/state`;
  return `${stateHome}/opencode/service.json`;
}

export interface OpenCode2ServiceRegistration {
  readonly url: string;
  readonly serverPassword?: string;
}

/**
 * Validate a parsed `service.json` payload. Returns null for anything that
 * isn't a usable HTTP endpoint so a corrupt or future-shaped registration
 * degrades to "no running server" rather than a failed spawn.
 *
 * @internal
 */
export function parseOpenCode2ServiceRegistration(raw: unknown): OpenCode2ServiceRegistration | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return null;
  const password = typeof record.password === "string" ? record.password.trim() : "";
  return { url, ...(password ? { serverPassword: password } : {}) };
}

export interface OpenCodeServerProcess {
  readonly url: string;
  readonly serverPassword?: string;
  readonly exitCode: Effect.Effect<number, never>;
}

export interface OpenCodeServerConnection {
  readonly url: string;
  readonly serverPassword?: string;
  readonly exitCode: Effect.Effect<number, never> | null;
  readonly external: boolean;
}

const OPENCODE_RUNTIME_ERROR_TAG = "OpenCodeRuntimeError";
export class OpenCodeRuntimeError extends Data.TaggedError(OPENCODE_RUNTIME_ERROR_TAG)<{
  readonly operation: string;
  readonly cause?: unknown;
  readonly detail: string;
}> {
  static readonly is = (u: unknown): u is OpenCodeRuntimeError =>
    P.isTagged(u, OPENCODE_RUNTIME_ERROR_TAG);
}

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

export function openCodeRuntimeErrorDetail(cause: unknown): string {
  if (OpenCodeRuntimeError.is(cause)) return cause.detail;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  if (cause && typeof cause === "object") {
    // SDK v2 throws { response, request, error? } shapes — extract what's useful
    const anyCause = cause as Record<string, unknown>;
    const status = (anyCause.response as { status?: number } | undefined)?.status;
    const body = anyCause.error ?? anyCause.data ?? anyCause.body;
    const encodedBody = encodeJsonStringForDiagnostics(body ?? cause);
    if (encodedBody) {
      return `status=${status ?? "?"} body=${encodedBody}`;
    }
  }
  return String(cause);
}

export const runOpenCodeSdk = <A>(
  operation: string,
  fn: () => Promise<A>,
): Effect.Effect<A, OpenCodeRuntimeError> =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) =>
      new OpenCodeRuntimeError({ operation, detail: openCodeRuntimeErrorDetail(cause), cause }),
  }).pipe(Effect.withSpan(`opencode.${operation}`));

export interface OpenCodeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface OpenCodeInventory {
  readonly providerList: ProviderListResponse;
  readonly agents: ReadonlyArray<Agent>;
  readonly skills: ReadonlyArray<OpenCodeSkill>;
}

export interface ParsedOpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

export interface OpenCodeSkill {
  readonly name?: string | null;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly content?: string | null;
}

const OpenCodeSkillSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  location: Schema.optionalKey(Schema.NullOr(Schema.String)),
  content: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeOpenCodeSkillsCliOutputExit = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.Array(OpenCodeSkillSchema)),
);

export interface OpenCodeRuntimeShape {
  /**
   * Spawns a local OpenCode server process. Its lifetime is bound to the caller's
   * `Scope.Scope` — the child is killed automatically when that scope closes.
   * Consumers that want a long-lived server must create and hold a scope explicitly
   * (see {@link Scope.make}) and close it when done.
   */
  readonly startOpenCodeServerProcess: (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<OpenCodeServerProcess, OpenCodeRuntimeError, Scope.Scope>;
  /**
   * Returns a handle to either an externally-managed OpenCode server (when
   * `serverUrl` is provided — no lifetime is attached to the caller's scope),
   * an already-running OpenCode 2 background service adopted from its
   * registration file (also external — we don't own its lifetime), or a
   * freshly spawned local server whose lifetime is bound to the caller's
   * scope. Adoption is attempted for `opencode2` binaries only and is skipped
   * when an explicit `serverPassword` is set.
   */
  readonly connectToOpenCodeServer: (input: {
    readonly binaryPath: string;
    readonly serverUrl?: string | null;
    readonly serverPassword?: string | null;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<OpenCodeServerConnection, OpenCodeRuntimeError, Scope.Scope>;
  /**
   * Upgrade the default OpenCode binary to the v2 preview when one resolves:
   * a `binaryPath` left at the `"opencode"` default (or empty) becomes
   * `"opencode2"` when `<opencode2> --version` succeeds, so users with the
   * preview installed get it without touching settings. Any explicit path is
   * returned unchanged.
   */
  readonly resolveDefaultBinaryPath: (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<string>;
  readonly runOpenCodeCommand: (input: {
    readonly binaryPath: string;
    readonly args: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
    readonly cwd?: string;
  }) => Effect.Effect<OpenCodeCommandResult, OpenCodeRuntimeError>;
  readonly createOpenCodeSdkClient: (input: {
    readonly baseUrl: string;
    readonly directory: string;
    readonly serverPassword?: string;
  }) => OpencodeClient;
  readonly loadOpenCodeInventory: (
    client: OpencodeClient,
  ) => Effect.Effect<OpenCodeInventory, OpenCodeRuntimeError>;
  readonly loadInventoryFromCli: (input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<OpenCodeInventory, OpenCodeRuntimeError>;
}

export function parseOpenCodeServerReadyOutput(
  output: string,
  isOpenCode2: boolean,
): { readonly url: string; readonly serverPassword?: string } | null {
  let url: string | undefined;
  let serverPassword: string | undefined;
  for (const line of output.split("\n")) {
    const readyPrefix = isOpenCode2 ? OPENCODE2_SERVER_READY_PREFIX : OPENCODE_SERVER_READY_PREFIX;
    if (line.startsWith(readyPrefix)) {
      url = line.match(/on\s+(https?:\/\/[^\s]+)/)?.[1];
    }
    if (isOpenCode2 && line.startsWith(OPENCODE2_SERVER_PASSWORD_PREFIX)) {
      serverPassword = line.slice(OPENCODE2_SERVER_PASSWORD_PREFIX.length).trim() || undefined;
    }
  }
  if (!url || (isOpenCode2 && !serverPassword)) return null;
  return { url, ...(serverPassword ? { serverPassword } : {}) };
}

/** @internal */
export function redactOpenCodeServerOutput(output: string): string {
  return output
    .split("\n")
    .map((line) =>
      line.startsWith(OPENCODE2_SERVER_PASSWORD_PREFIX)
        ? `${OPENCODE2_SERVER_PASSWORD_PREFIX}[redacted]`
        : line,
    )
    .join("\n");
}

const SLUG_LINE_RE = /^(\S+\/\S+)\s*$/;
const AGENT_HEADER_RE = /^(.+)\s+\((\S+)\)\s*$/;
const OPENCODE_SLUG_LABELS: Readonly<Record<string, string>> = {
  deepseek: "DeepSeek",
  glm: "GLM",
  gpt: "GPT",
  minimax: "MiniMax",
  mimo: "MiMo",
  opencode: "OpenCode",
};

export function formatOpenCodeSlugLabel(value: string): string {
  return value
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(
      (segment) =>
        OPENCODE_SLUG_LABELS[segment.toLowerCase()] ??
        segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join(" ");
}

// Agents that are always hidden in OpenCode but the CLI "agent list" command
// does not expose the hidden flag. Keep in sync with OpenCode agent
// definitions (in the OpenCode repo: packages/opencode/src/agent/agent.ts).
const KNOWN_HIDDEN_AGENTS = new Set(["compaction", "summary", "title"]);

/** @internal */
export function parseModelsCliOutput(stdout: string): {
  readonly providers: ReadonlyMap<
    string,
    { readonly id: string; readonly name: string; readonly models: { [key: string]: Model } }
  >;
  readonly connected: ReadonlyArray<string>;
} {
  const providers = new Map<
    string,
    { id: string; name: string; models: { [key: string]: Model } }
  >();
  const lines = stdout.split("\n");
  let currentSlug: string | null = null;
  const jsonLines: Array<string> = [];

  const flushModel = () => {
    if (currentSlug !== null && jsonLines.length > 0) {
      const jsonStr = jsonLines.join("\n").trim();
      if (jsonStr.length > 0) {
        try {
          const model = JSON.parse(jsonStr) as Model;
          const separator = currentSlug.indexOf("/");
          if (separator > 0) {
            const providerID = currentSlug.slice(0, separator);
            const modelID = currentSlug.slice(separator + 1);
            let provider = providers.get(providerID);
            if (!provider) {
              provider = { id: providerID, name: providerID, models: {} };
              providers.set(providerID, provider);
            }
            provider.models[modelID] = model;
          }
        } catch {
          // Skip unparseable model JSON
        }
      }
    }
    currentSlug = null;
    jsonLines.length = 0;
  };

  for (const line of lines) {
    // A model's JSON body is a single `JSON.stringify` line starting with `{`,
    // while a provider/model slug is a bare `provider/model` header. Only the
    // latter can be a slug: without this guard a body line with no interior
    // whitespace and a `/` in one of its values (e.g. an OpenRouter model whose
    // `id` is `vendor/model`) matches SLUG_LINE_RE, so flushModel runs against
    // an empty body and the model is silently dropped.
    const slugMatch = line.trimStart().startsWith("{") ? null : SLUG_LINE_RE.exec(line);
    if (slugMatch) {
      flushModel();
      currentSlug = slugMatch[1]!;
    } else if (currentSlug !== null) {
      jsonLines.push(line);
    }
  }
  flushModel();

  return { providers, connected: [...providers.keys()] };
}

function openCode2ModelFromSlug(slug: ParsedOpenCodeModelSlug): Model {
  return {
    id: slug.modelID,
    providerID: slug.providerID,
    api: { id: slug.modelID, url: "", npm: "" },
    name: formatOpenCodeSlugLabel(slug.modelID),
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, output: 0 },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
  };
}

/** @internal */
export function parseOpenCode2ModelsCliOutput(stdout: string): {
  readonly providers: ReadonlyMap<
    string,
    { readonly id: string; readonly name: string; readonly models: { [key: string]: Model } }
  >;
  readonly connected: ReadonlyArray<string>;
} {
  const providers = new Map<
    string,
    { id: string; name: string; models: { [key: string]: Model } }
  >();

  for (const line of stdout.split(/\r?\n/)) {
    const match = SLUG_LINE_RE.exec(line);
    const slug = parseOpenCodeModelSlug(match?.[1]);
    if (!slug) {
      continue;
    }
    let provider = providers.get(slug.providerID);
    if (!provider) {
      provider = {
        id: slug.providerID,
        name: formatOpenCodeSlugLabel(slug.providerID),
        models: {},
      };
      providers.set(slug.providerID, provider);
    }
    provider.models[slug.modelID] = openCode2ModelFromSlug(slug);
  }

  return { providers, connected: [...providers.keys()] };
}

/** @internal */
export function parseAgentListCliOutput(stdout: string): ReadonlyArray<Agent> {
  const agents: Array<Agent> = [];
  const lines = stdout.split("\n");
  let currentHeader: { name: string; mode: string } | null = null;
  const blockLines: Array<string> = [];

  const flushAgent = () => {
    if (currentHeader !== null) {
      const jsonStr = blockLines.join("\n").trim();
      if (jsonStr.length > 0) {
        try {
          const permission = JSON.parse(jsonStr);
          agents.push({
            name: currentHeader.name,
            mode: currentHeader.mode as Agent["mode"],
            hidden: KNOWN_HIDDEN_AGENTS.has(currentHeader.name),
            permission,
            options: {},
          });
        } catch {
          // Skip unparseable agent
        }
      }
    }
    currentHeader = null;
    blockLines.length = 0;
  };

  for (const line of lines) {
    const match = AGENT_HEADER_RE.exec(line);
    if (match) {
      flushAgent();
      currentHeader = { name: match[1]!, mode: match[2]! };
    } else if (currentHeader !== null) {
      blockLines.push(line);
    }
  }
  flushAgent();

  return agents;
}

/** @internal */
export function parseOpenCode2AgentsCliOutput(stdout: string): ReadonlyArray<Agent> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const agents: Array<Agent> = [];
  for (const value of parsed) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const record = value as Record<string, unknown>;
    const name = typeof record.id === "string" ? record.id.trim() : "";
    const mode = record.mode;
    if (name.length === 0 || (mode !== "primary" && mode !== "subagent" && mode !== "all")) {
      continue;
    }

    const permission = Array.isArray(record.permissions)
      ? record.permissions.flatMap((candidate) => {
          if (!candidate || typeof candidate !== "object") {
            return [];
          }
          const rule = candidate as Record<string, unknown>;
          if (
            typeof rule.action !== "string" ||
            typeof rule.resource !== "string" ||
            (rule.effect !== "allow" && rule.effect !== "deny" && rule.effect !== "ask")
          ) {
            return [];
          }
          return [
            {
              permission: rule.action,
              pattern: rule.resource,
              action: rule.effect,
            } satisfies PermissionRuleset[number],
          ];
        })
      : [];
    const request =
      record.request && typeof record.request === "object"
        ? (record.request as Record<string, unknown>)
        : undefined;
    const options =
      request?.settings && typeof request.settings === "object"
        ? (request.settings as Record<string, unknown>)
        : {};

    agents.push({
      name,
      mode,
      hidden: record.hidden === true,
      permission,
      options,
      ...(typeof record.description === "string" ? { description: record.description } : {}),
    });
  }

  return agents;
}

/** @internal */
export function parseSkillsCliOutput(stdout: string): ReadonlyArray<OpenCodeSkill> {
  const result = decodeOpenCodeSkillsCliOutputExit(stdout);
  return Exit.isSuccess(result) ? result.value : [];
}

export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  if (typeof slug !== "string") {
    return null;
  }

  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }

  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}

export function openCodeQuestionId(
  index: number,
  question: QuestionRequest["questions"][number],
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`;
}

export function toOpenCodeFileParts(input: {
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly resolveAttachmentPath: (attachment: ChatAttachment) => string | null;
}): Array<FilePartInput> {
  const parts: Array<FilePartInput> = [];

  for (const attachment of input.attachments ?? []) {
    const attachmentPath = input.resolveAttachmentPath(attachment);
    if (!attachmentPath) {
      continue;
    }

    parts.push({
      type: "file",
      mime: attachment.mimeType,
      filename: attachment.name,
      url: NodeURL.pathToFileURL(attachmentPath).href,
    });
  }

  return parts;
}

export function buildOpenCodePermissionRules(runtimeMode: RuntimeMode): PermissionRuleset {
  if (runtimeMode === "full-access") {
    return [{ permission: "*", pattern: "*", action: "allow" }];
  }

  return [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "webfetch", pattern: "*", action: "ask" },
    { permission: "websearch", pattern: "*", action: "ask" },
    { permission: "codesearch", pattern: "*", action: "ask" },
    { permission: "external_directory", pattern: "*", action: "ask" },
    { permission: "doom_loop", pattern: "*", action: "ask" },
    { permission: "question", pattern: "*", action: "allow" },
  ];
}

export function toOpenCodePermissionReply(
  decision: ProviderApprovalDecision,
): "once" | "always" | "reject" {
  switch (decision) {
    case "accept":
      return "once";
    case "acceptForSession":
      return "always";
    case "decline":
    case "cancel":
    default:
      return "reject";
  }
}

export function toOpenCodeQuestionAnswers(
  request: QuestionRequest,
  answers: Record<string, unknown>,
): Array<QuestionAnswer> {
  return request.questions.map((question, index) => {
    const raw =
      answers[openCodeQuestionId(index, question)] ??
      answers[question.header] ??
      answers[question.question];
    if (Array.isArray(raw)) {
      return raw.filter((value): value is string => typeof value === "string");
    }
    if (typeof raw === "string") {
      return raw.trim().length > 0 ? [raw] : [];
    }
    return [];
  });
}

function ensureRuntimeError(
  operation: OpenCodeRuntimeError["operation"],
  detail: string,
  cause: unknown,
): OpenCodeRuntimeError {
  return OpenCodeRuntimeError.is(cause)
    ? cause
    : new OpenCodeRuntimeError({ operation, detail, cause });
}

const makeOpenCodeRuntime = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const netService = yield* NetService.NetService;
  const hostPlatform = yield* HostProcessPlatform;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const resolveCommand = (command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
    resolveSpawnCommand(command, args, env ? { env } : {});

  const runOpenCodeCommand: OpenCodeRuntimeShape["runOpenCodeCommand"] = (input) =>
    Effect.gen(function* () {
      const spawnCommand = yield* resolveCommand(input.binaryPath, input.args, input.environment);
      const child = yield* spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          shell: spawnCommand.shell,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.environment ? { env: input.environment } : { extendEnv: true }),
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [collectStreamAsString(child.stdout), collectStreamAsString(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      const exitCode = Number(code);
      if (yield* isWindowsCommandNotFound(exitCode, stderr)) {
        return yield* new OpenCodeRuntimeError({
          operation: "runOpenCodeCommand",
          detail: `spawn ${input.binaryPath} ENOENT`,
        });
      }
      return {
        stdout,
        stderr,
        code: exitCode,
      } satisfies OpenCodeCommandResult;
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) =>
        ensureRuntimeError(
          "runOpenCodeCommand",
          `Failed to execute '${input.binaryPath} ${input.args.join(" ")}': ${openCodeRuntimeErrorDetail(cause)}`,
          cause,
        ),
      ),
    );

  const startOpenCodeServerProcess: OpenCodeRuntimeShape["startOpenCodeServerProcess"] = (input) =>
    Effect.gen(function* () {
      // Bind this server's lifetime to the caller's scope. When the caller's
      // scope closes, the spawned child is killed and all associated fibers
      // are interrupted automatically — no `close()` method needed.
      const runtimeScope = yield* Scope.Scope;

      const hostname = input.hostname ?? DEFAULT_HOSTNAME;
      const port =
        input.port ??
        (yield* netService.findAvailablePort(0).pipe(
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: `Failed to find available port: ${openCodeRuntimeErrorDetail(cause)}`,
                cause,
              }),
          ),
        ));
      const timeoutMs = input.timeoutMs ?? DEFAULT_OPENCODE_SERVER_TIMEOUT_MS;
      const isOpenCode2 = isOpenCode2BinaryPath(input.binaryPath);
      const args = ["serve", `--hostname=${hostname}`, `--port=${port}`];
      const spawnCommand = yield* resolveCommand(input.binaryPath, args, input.environment);

      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            detached: hostPlatform !== "win32",
            shell: spawnCommand.shell,
            env: {
              ...input.environment,
              // Respect an OPENCODE_CONFIG_CONTENT provided by the caller or
              // the inherited process environment, only falling back to the
              // empty config when neither is set. Setting it unconditionally
              // previously clobbered the user's opencode config, hiding their
              // providers/models. The value is set explicitly (rather than
              // relying on inheritance) because `extendEnv` is false whenever
              // `input.environment` is provided.
              OPENCODE_CONFIG_CONTENT: resolveOpenCodeConfigContent(input.environment),
            },
            extendEnv: input.environment === undefined,
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: `Failed to spawn OpenCode server process: ${openCodeRuntimeErrorDetail(cause)}`,
                cause,
              }),
          ),
        );

      const killOpenCodeProcessGroup = (signal: NodeJS.Signals) =>
        hostPlatform === "win32"
          ? child.kill({ killSignal: signal, forceKillAfter: "1 second" }).pipe(Effect.asVoid)
          : Effect.sync(() => {
              try {
                process.kill(-Number(child.pid), signal);
              } catch {
                // The direct child may already have exited after starting the
                // server; the process group kill is best-effort cleanup for
                // any serve process left in that group.
              }
            });
      const terminateChild = killOpenCodeProcessGroup("SIGTERM").pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(killOpenCodeProcessGroup("SIGKILL")),
        Effect.ignore,
      );
      yield* Scope.addFinalizer(runtimeScope, terminateChild);

      const stdoutRef = yield* Ref.make("");
      const stderrRef = yield* Ref.make("");
      const readyDeferred = yield* Deferred.make<
        { readonly url: string; readonly serverPassword?: string },
        OpenCodeRuntimeError
      >();

      const setReadyFromStdoutChunk = (chunk: string) =>
        Ref.updateAndGet(stdoutRef, (stdout) => `${stdout}${chunk}`).pipe(
          Effect.flatMap((nextStdout) => {
            const parsed = parseOpenCodeServerReadyOutput(nextStdout, isOpenCode2);
            return parsed
              ? Deferred.succeed(readyDeferred, parsed).pipe(Effect.ignore)
              : Effect.void;
          }),
        );

      const stdoutFiber = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.runForEach(setReadyFromStdoutChunk),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );
      const stderrFiber = yield* child.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) => Ref.update(stderrRef, (stderr) => `${stderr}${chunk}`)),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );

      const exitFiber = yield* child.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.gen(function* () {
            const stdout = yield* Ref.get(stdoutRef);
            const stderr = yield* Ref.get(stderrRef);
            const diagnosticStdout = redactOpenCodeServerOutput(stdout);
            const diagnosticStderr = redactOpenCodeServerOutput(stderr);
            const exitCode = Number(code);
            yield* Deferred.fail(
              readyDeferred,
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: [
                  `OpenCode server exited before startup completed (code: ${String(exitCode)}).`,
                  diagnosticStdout.trim() ? `stdout:\n${diagnosticStdout.trim()}` : null,
                  diagnosticStderr.trim() ? `stderr:\n${diagnosticStderr.trim()}` : null,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                cause: { exitCode, stdout: diagnosticStdout, stderr: diagnosticStderr },
              }),
            ).pipe(Effect.ignore);
          }),
        ),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );

      const readyExit = yield* Effect.exit(
        Deferred.await(readyDeferred).pipe(Effect.timeoutOption(timeoutMs)),
      );

      // Startup-time fibers are no longer needed once ready has resolved (either
      // way). The exit fiber is only interrupted on failure; on success it keeps
      // the caller's `exitCode` effect observable until the scope closes.
      yield* Fiber.interrupt(stdoutFiber).pipe(Effect.ignore);
      yield* Fiber.interrupt(stderrFiber).pipe(Effect.ignore);

      if (Exit.isFailure(readyExit)) {
        yield* Fiber.interrupt(exitFiber).pipe(Effect.ignore);
        const squashed = Cause.squash(readyExit.cause);
        return yield* ensureRuntimeError(
          "startOpenCodeServerProcess",
          `Failed while waiting for OpenCode server startup: ${openCodeRuntimeErrorDetail(squashed)}`,
          squashed,
        );
      }

      const readyOption = readyExit.value;
      if (Option.isNone(readyOption)) {
        yield* Fiber.interrupt(exitFiber).pipe(Effect.ignore);
        return yield* new OpenCodeRuntimeError({
          operation: "startOpenCodeServerProcess",
          detail: `Timed out waiting for OpenCode server start after ${timeoutMs}ms.`,
        });
      }

      return {
        ...readyOption.value,
        exitCode: child.exitCode.pipe(
          Effect.map(Number),
          Effect.orElseSucceed(() => 0),
        ),
      } satisfies OpenCodeServerProcess;
    });

  /**
   * Look for an already-running OpenCode 2 background service and health-check
   * it before adopting. Any failure — missing registration file, unparsable
   * JSON, dead endpoint, timeout — resolves to null so the caller falls
   * through to spawning its own server. Never starts anything.
   */
  const discoverRegisteredOpenCode2Server = (
    input: {
      readonly environment?: NodeJS.ProcessEnv;
    },
  ): Effect.Effect<OpenCode2ServiceRegistration | null> =>
    Effect.gen(function* () {
      // The service registration is documented for unix state directories;
      // don't guess a Windows location.
      if (hostPlatform === "win32") return null;
      const raw = yield* fileSystem.readFileString(openCode2ServiceStateFile(input.environment)).pipe(
        Effect.option,
      );
      if (Option.isNone(raw)) return null;
      const parsedExit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown))(raw.value);
      if (!Exit.isSuccess(parsedExit)) return null;
      const registration = parseOpenCode2ServiceRegistration(parsedExit.value);
      if (!registration) return null;

      const baseUrl = registration.url.replace(/\/+$/, "");
      let request = HttpClientRequest.get(`${baseUrl}/api/health`);
      if (registration.serverPassword) {
        request = HttpClientRequest.setHeader(
          request,
          "authorization",
          `Basic ${Buffer.from(`opencode:${registration.serverPassword}`, "utf8").toString("base64")}`,
        );
      }
      // A stale registration (crashed daemon, rebooted machine) must fall
      // through to spawning our own server, so any transport failure or
      // timeout resolves to "not adopted".
      const healthy = yield* httpClient.execute(request).pipe(
        Effect.timeout("3 seconds"),
        Effect.map((response) => response.status === 200),
        Effect.orElseSucceed(() => false),
      );
      return healthy ? registration : null;
    }).pipe(Effect.orElseSucceed(() => null));

  const resolveDefaultBinaryPath: OpenCodeRuntimeShape["resolveDefaultBinaryPath"] = (input) => {
    const trimmed = input.binaryPath.trim();
    // Only upgrade when no explicit binary was configured ("opencode" is the
    // settings default; empty behaves the same way).
    if (trimmed.length > 0 && trimmed.toLowerCase() !== "opencode") {
      return Effect.succeed(input.binaryPath);
    }
    return runOpenCodeCommand({
      binaryPath: OPENCODE2_DEFAULT_BINARY,
      args: ["--version"],
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
    }).pipe(
      Effect.map((result) =>
        result.code === 0 ? OPENCODE2_DEFAULT_BINARY : input.binaryPath,
      ),
      Effect.orElseSucceed(() => input.binaryPath),
    );
  };

  const connectToOpenCodeServer: OpenCodeRuntimeShape["connectToOpenCodeServer"] = (input) => {
    const serverUrl = input.serverUrl?.trim();
    if (serverUrl) {
      // We don't own externally-configured servers — no scope interaction.
      return Effect.succeed({
        url: serverUrl,
        exitCode: null,
        external: true,
      });
    }

    // Adopt the user's running OpenCode 2 background service when one is up
    // (mirrors how v2's own clients connect). An explicit `serverPassword`
    // means the user is targeting their own authenticated server, not the
    // shared registration, so discovery stays out of the way. Adopted
    // services are external: we never kill them.
    const adoptSharedService =
      !input.serverPassword && isOpenCode2BinaryPath(input.binaryPath)
        ? discoverRegisteredOpenCode2Server({
            ...(input.environment !== undefined ? { environment: input.environment } : {}),
          })
        : Effect.succeed(null);

    return Effect.flatMap(
      adoptSharedService,
      (adopted): Effect.Effect<OpenCodeServerConnection, OpenCodeRuntimeError, Scope.Scope> => {
        if (adopted) {
          return Effect.succeed({
            url: adopted.url,
            ...(adopted.serverPassword ? { serverPassword: adopted.serverPassword } : {}),
            exitCode: null,
            external: true,
          });
        }
        return startOpenCodeServerProcess({
          binaryPath: input.binaryPath,
          ...(input.environment !== undefined ? { environment: input.environment } : {}),
          ...(input.port !== undefined ? { port: input.port } : {}),
          ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        }).pipe(
          Effect.map((server) => ({
            url: server.url,
            ...(server.serverPassword ? { serverPassword: server.serverPassword } : {}),
            exitCode: server.exitCode,
            external: false,
          })),
        );
      },
    );
  };

  const createOpenCodeSdkClient: OpenCodeRuntimeShape["createOpenCodeSdkClient"] = (input) =>
    createOpencodeClient({
      baseUrl: input.baseUrl,
      directory: input.directory,
      ...(input.serverPassword
        ? {
            headers: {
              Authorization: `Basic ${Buffer.from(`opencode:${input.serverPassword}`, "utf8").toString("base64")}`,
            },
          }
        : {}),
      throwOnError: true,
    });

  const loadProviders = (client: OpencodeClient) =>
    runOpenCodeSdk("provider.list", () => client.provider.list()).pipe(
      Effect.filterMapOrFail(
        (list) =>
          list.data
            ? Result.succeed(list.data)
            : Result.fail(
                new OpenCodeRuntimeError({
                  operation: "provider.list",
                  detail: "OpenCode provider list was empty.",
                }),
              ),
        (result) => result,
      ),
    );

  const loadAgents = (client: OpencodeClient) =>
    runOpenCodeSdk("app.agents", () => client.app.agents()).pipe(
      Effect.map((result) => result.data ?? []),
    );

  const loadSkills = (client: OpencodeClient) =>
    runOpenCodeSdk("app.skills", () => client.app.skills()).pipe(
      Effect.map((result) => (result.data ?? []) as ReadonlyArray<OpenCodeSkill>),
      Effect.orElseSucceed((): ReadonlyArray<OpenCodeSkill> => []),
    );

  const loadOpenCodeInventory: OpenCodeRuntimeShape["loadOpenCodeInventory"] = (client) =>
    Effect.all([loadProviders(client), loadAgents(client), loadSkills(client)], {
      concurrency: "unbounded",
    }).pipe(Effect.map(([providerList, agents, skills]) => ({ providerList, agents, skills })));

  const loadInventoryFromCli: OpenCodeRuntimeShape["loadInventoryFromCli"] = (input) =>
    Effect.gen(function* () {
      const env = input.environment !== undefined ? { environment: input.environment } : ({} as {});
      const commandContext = { cwd: input.cwd, ...env };
      const isOpenCode2 = isOpenCode2BinaryPath(input.binaryPath);

      const runModelsCli = () =>
        runOpenCodeCommand({
          binaryPath: input.binaryPath,
          args: isOpenCode2 ? ["models"] : ["models", "--verbose"],
          ...commandContext,
        }).pipe(Effect.exit);
      const runAgentsCli = () =>
        runOpenCodeCommand({
          binaryPath: input.binaryPath,
          args: isOpenCode2 ? ["debug", "agents"] : ["agent", "list"],
          ...commandContext,
        }).pipe(Effect.exit);
      const runSkillsCli = () =>
        isOpenCode2
          ? Effect.succeed(
              Exit.succeed({ stdout: "", stderr: "", code: 0 } satisfies OpenCodeCommandResult),
            )
          : runOpenCodeCommand({
              binaryPath: input.binaryPath,
              args: ["debug", "skill"],
              ...commandContext,
            }).pipe(Effect.exit);

      // First attempt — run all inventory commands in parallel.
      const [initialModelsResult, initialAgentsResult, initialSkillsResult] = yield* Effect.all(
        [runModelsCli(), runAgentsCli(), runSkillsCli()],
        { concurrency: "unbounded" },
      );
      let modelsResult = initialModelsResult;
      let agentsResult = initialAgentsResult;
      let skillsResult = initialSkillsResult;

      // Retry once after 1s on transient failures (e.g. SQLite "database is locked")
      const needsModelsRetry = modelsResult._tag === "Failure" || modelsResult.value.code !== 0;
      const needsAgentsRetry = agentsResult._tag === "Failure" || agentsResult.value.code !== 0;
      const needsSkillsRetry = skillsResult._tag === "Failure" || skillsResult.value.code !== 0;
      if (needsModelsRetry || needsAgentsRetry || needsSkillsRetry) {
        yield* Effect.sleep("1 second");
        const [m2, a2, s2] = yield* Effect.all(
          [
            needsModelsRetry ? runModelsCli() : Effect.succeed(modelsResult),
            needsAgentsRetry ? runAgentsCli() : Effect.succeed(agentsResult),
            needsSkillsRetry ? runSkillsCli() : Effect.succeed(skillsResult),
          ],
          { concurrency: "unbounded" },
        );
        modelsResult = m2;
        agentsResult = a2;
        skillsResult = s2;
      }

      if (modelsResult._tag === "Failure") {
        const cause = Cause.squash(modelsResult.cause);
        return yield* ensureRuntimeError(
          "loadInventoryFromCli",
          `Failed to load OpenCode models: ${openCodeRuntimeErrorDetail(cause)}`,
          cause,
        );
      }
      if (modelsResult.value.code !== 0) {
        return yield* new OpenCodeRuntimeError({
          operation: "loadInventoryFromCli",
          detail: `OpenCode models command exited with code ${modelsResult.value.code}.`,
        });
      }

      const parsed = isOpenCode2
        ? parseOpenCode2ModelsCliOutput(modelsResult.value.stdout)
        : parseModelsCliOutput(modelsResult.value.stdout);
      const connected = [...parsed.connected];
      const allProviders: ProviderListResponse["all"] = [...parsed.providers.values()].map(
        (provider) => ({
          id: provider.id,
          name: provider.name,
          source: "config" as const,
          env: [],
          options: {},
          models: provider.models,
        }),
      );

      // Agent and skill metadata enrich the provider snapshot but are not required
      // for an authoritative model inventory, so either may degrade to an empty list.
      let agents: ReadonlyArray<Agent> = [];
      if (agentsResult._tag === "Success" && agentsResult.value.code === 0) {
        agents = isOpenCode2
          ? parseOpenCode2AgentsCliOutput(agentsResult.value.stdout)
          : parseAgentListCliOutput(agentsResult.value.stdout);
      }
      let skills: ReadonlyArray<OpenCodeSkill> = [];
      if (skillsResult._tag === "Success" && skillsResult.value.code === 0) {
        skills = parseSkillsCliOutput(skillsResult.value.stdout);
      }

      return {
        providerList: { all: allProviders, default: {}, connected },
        agents,
        skills,
      };
    });

  return {
    startOpenCodeServerProcess,
    connectToOpenCodeServer,
    resolveDefaultBinaryPath,
    runOpenCodeCommand,
    createOpenCodeSdkClient,
    loadOpenCodeInventory,
    loadInventoryFromCli,
  } satisfies OpenCodeRuntimeShape;
});

export class OpenCodeRuntime extends Context.Service<OpenCodeRuntime, OpenCodeRuntimeShape>()(
  "t3/provider/opencodeRuntime",
) {}

export const OpenCodeRuntimeLive = Layer.effect(OpenCodeRuntime, makeOpenCodeRuntime).pipe(
  Layer.provide(NetService.layer),
  // Satisfies the runtime's HttpClient requirement internally so consumers
  // only need to provide filesystem services (NodeServices in tests/prod).
  Layer.provide(FetchHttpClient.layer),
);
