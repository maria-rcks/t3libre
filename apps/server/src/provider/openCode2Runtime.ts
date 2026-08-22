import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { collectStreamAsString } from "./providerSnapshot.ts";

export type OpenCode2HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface OpenCode2Protocol {
  readonly promptShape: "flat" | "nested";
  readonly eventNamespace: "session" | "session.next";
}

export interface OpenCode2Event {
  readonly id: string;
  readonly type: string;
  readonly data: unknown;
  readonly durable?: {
    readonly aggregateID: string;
    readonly seq: number;
    readonly version: number;
  };
  readonly location?: {
    readonly directory: string;
    readonly workspaceID?: string;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OpenCode2RequestInput<S extends Schema.Top> {
  readonly operation: string;
  readonly schema: S;
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
}

export interface OpenCode2Connection {
  readonly url: string;
  readonly protocol: OpenCode2Protocol;
  readonly request: <S extends Schema.Top>(
    method: OpenCode2HttpMethod,
    path: string,
    input: OpenCode2RequestInput<S>,
  ) => Effect.Effect<S["Type"], OpenCode2RuntimeError, S["DecodingServices"]>;
  readonly globalEvents: Stream.Stream<OpenCode2Event, OpenCode2RuntimeError>;
}

export type OpenCode2RuntimeErrorKind =
  | "command"
  | "connection"
  | "request"
  | "unsupported-preview";

export class OpenCode2RuntimeError extends Data.TaggedError("OpenCode2RuntimeError")<{
  readonly operation: string;
  readonly kind: OpenCode2RuntimeErrorKind;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export interface OpenCode2RuntimeShape {
  readonly attach: (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<OpenCode2Connection, OpenCode2RuntimeError>;
}

export class OpenCode2Runtime extends Context.Service<OpenCode2Runtime, OpenCode2RuntimeShape>()(
  "t3/provider/openCode2Runtime",
) {}

export interface OpenCode2CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface OpenCode2CommandInput {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
}

export type OpenCode2CommandRunner = (
  input: OpenCode2CommandInput,
) => Effect.Effect<OpenCode2CommandResult, OpenCode2RuntimeError>;

const OpenCode2EventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.Unknown,
  durable: Schema.optionalKey(
    Schema.Struct({
      aggregateID: Schema.String,
      seq: Schema.Number,
      version: Schema.Number,
    }),
  ),
  location: Schema.optionalKey(
    Schema.Struct({
      directory: Schema.String,
      workspaceID: Schema.optionalKey(Schema.String),
    }),
  ),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const decodeOpenCode2SseEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OpenCode2EventSchema),
);

function environmentKey(environment: NodeJS.ProcessEnv): string {
  return JSON.stringify(
    Object.entries(environment)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function attachKey(input: {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
}): string {
  return `${input.binaryPath}\n${environmentKey(input.environment)}`;
}

function parseServiceUrl(stdout: string): string | null {
  for (const line of stdout.trim().split(/\r?\n/u).toReversed()) {
    const candidate = line.trim();
    if (!URL.canParse(candidate)) continue;
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  }
  return null;
}

function commandFailureDetail(input: {
  readonly args: ReadonlyArray<string>;
  readonly result: OpenCode2CommandResult;
}): string {
  const stderr = input.result.stderr.trim();
  if (stderr.length > 0) return stderr;
  return `OpenCode 2 command \`${input.args.join(" ")}\` exited with code ${input.result.code}.`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function localRef(document: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let value = document;
  for (const rawSegment of ref.slice(2).split("/")) {
    if (!isRecord(value)) return undefined;
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    value = value[segment];
  }
  return value;
}

function schemaPropertyNames(
  document: unknown,
  schema: unknown,
  visited = new Set<unknown>(),
): ReadonlySet<string> {
  if (!isRecord(schema) || visited.has(schema)) return new Set();
  visited.add(schema);

  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const nestedSchemas: Array<unknown> = [schema.allOf, schema.anyOf, schema.oneOf]
    .filter(Array.isArray)
    .flat();
  if (typeof schema.$ref === "string") nestedSchemas.push(localRef(document, schema.$ref));

  const result = new Set(properties);
  for (const nested of nestedSchemas) {
    for (const name of schemaPropertyNames(document, nested, visited)) result.add(name);
  }
  return result;
}

function findOperation(value: unknown, operationId: string, visited = new Set<unknown>()): unknown {
  if (!isRecord(value) && !Array.isArray(value)) return undefined;
  if (visited.has(value)) return undefined;
  visited.add(value);

  if (isRecord(value) && value.operationId === operationId) return value;
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    const found = findOperation(nested, operationId, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findPromptOperation(document: unknown): unknown {
  for (const operationId of ["v2.session.prompt", "session.prompt"]) {
    const operation = findOperation(document, operationId);
    if (operation !== undefined) return operation;
  }

  if (!isRecord(document)) return undefined;
  const paths = document.paths;
  if (!isRecord(paths)) return undefined;
  for (const [path, methods] of Object.entries(paths)) {
    if (!/^\/api\/session\/(?:\{[^}]+\}|:[^/]+)\/prompt$/u.test(path)) continue;
    if (isRecord(methods) && isRecord(methods.post)) return methods.post;
  }
  return undefined;
}

function containsString(value: unknown, expected: string, visited = new Set<unknown>()): boolean {
  if (value === expected) return true;
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (visited.has(value)) return false;
  visited.add(value);
  return (Array.isArray(value) ? value : Object.values(value)).some((nested) =>
    containsString(nested, expected, visited),
  );
}

export function detectOpenCode2Protocol(document: unknown): OpenCode2Protocol | null {
  const operation = findPromptOperation(document);
  if (!isRecord(operation)) return null;
  const requestBody = operation.requestBody;
  const content = isRecord(requestBody) ? requestBody.content : undefined;
  const jsonContent = isRecord(content) ? content["application/json"] : undefined;
  const schema = isRecord(jsonContent) ? jsonContent.schema : undefined;
  const properties = schemaPropertyNames(document, schema);
  const promptShape = properties.has("text") ? "flat" : properties.has("prompt") ? "nested" : null;
  if (promptShape === null) return null;

  const eventNamespace = containsString(document, "session.next.text.delta")
    ? "session.next"
    : containsString(document, "session.text.delta")
      ? "session"
      : null;
  if (eventNamespace === null) return null;
  return { promptShape, eventNamespace };
}

function requestUrl(
  baseUrl: string,
  path: string,
  query: OpenCode2RequestInput<Schema.Top>["query"],
): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function withAuthentication(
  request: HttpClientRequest.HttpClientRequest,
  password: string,
): HttpClientRequest.HttpClientRequest {
  return request.pipe(
    HttpClientRequest.basicAuth("opencode", password),
    HttpClientRequest.acceptJson,
  );
}

function makeRequest(
  method: OpenCode2HttpMethod,
  url: string,
  body: unknown | undefined,
): HttpClientRequest.HttpClientRequest {
  const request = HttpClientRequest.make(method)(url);
  return body === undefined ? request : request.pipe(HttpClientRequest.bodyJsonUnsafe(body));
}

function runtimeError(input: {
  readonly operation: string;
  readonly kind: OpenCode2RuntimeErrorKind;
  readonly detail: string;
  readonly cause?: unknown;
}): OpenCode2RuntimeError {
  return new OpenCode2RuntimeError(input);
}

function makeConnection(input: {
  readonly baseUrl: string;
  readonly password: string;
  readonly httpClient: HttpClient.HttpClient;
  readonly protocol: OpenCode2Protocol;
}): OpenCode2Connection {
  const request: OpenCode2Connection["request"] = (method, path, requestInput) =>
    input.httpClient
      .execute(
        withAuthentication(
          makeRequest(
            method,
            requestUrl(input.baseUrl, path, requestInput.query),
            requestInput.body,
          ),
          input.password,
        ),
      )
      .pipe(
        Effect.mapError((cause) =>
          runtimeError({
            operation: requestInput.operation,
            kind: "request",
            detail: `OpenCode 2 ${requestInput.operation} request failed.`,
            cause,
          }),
        ),
        Effect.flatMap((response) => {
          if (response.status < 200 || response.status >= 300) {
            return Effect.fail(
              runtimeError({
                operation: requestInput.operation,
                kind: "request",
                detail: `OpenCode 2 ${requestInput.operation} returned HTTP ${response.status}.`,
              }),
            );
          }
          const decodeEmptyResponse = Schema.decodeUnknownEffect(requestInput.schema);
          const decodeResponse =
            response.status === 204
              ? decodeEmptyResponse(undefined)
              : HttpClientResponse.schemaBodyJson(requestInput.schema)(response);
          return decodeResponse.pipe(
            Effect.mapError((cause) =>
              runtimeError({
                operation: requestInput.operation,
                kind: "unsupported-preview",
                detail: `This OpenCode 2 preview returned an unsupported ${requestInput.operation} response.`,
                cause,
              }),
            ),
          );
        }),
      );

  const globalEvents = Stream.unwrap(
    input.httpClient
      .execute(
        withAuthentication(
          HttpClientRequest.get(requestUrl(input.baseUrl, "/api/event", undefined)).pipe(
            HttpClientRequest.setHeader("accept", "text/event-stream"),
          ),
          input.password,
        ),
      )
      .pipe(
        Effect.mapError((cause) =>
          runtimeError({
            operation: "event.subscribe",
            kind: "request",
            detail: "OpenCode 2 event subscription failed.",
            cause,
          }),
        ),
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? Effect.succeed(response.stream)
            : Effect.fail(
                runtimeError({
                  operation: "event.subscribe",
                  kind: "request",
                  detail: `OpenCode 2 event subscription returned HTTP ${response.status}.`,
                }),
              ),
        ),
      ),
  ).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) => {
      if (!line.startsWith("data:")) return Result.failVoid;
      return Result.succeed(line.slice("data:".length).trimStart());
    }),
    Stream.mapEffect((line) =>
      decodeOpenCode2SseEvent(line).pipe(
        Effect.mapError((cause) =>
          runtimeError({
            operation: "event.decode",
            kind: "unsupported-preview",
            detail: "This OpenCode 2 preview returned an unsupported event payload.",
            cause,
          }),
        ),
      ),
    ),
    Stream.mapError((cause) =>
      cause instanceof OpenCode2RuntimeError
        ? cause
        : runtimeError({
            operation: "event.subscribe",
            kind: "request",
            detail: "OpenCode 2 event stream failed.",
            cause,
          }),
    ),
  );

  return {
    url: input.baseUrl,
    protocol: input.protocol,
    request,
    globalEvents,
  };
}

export const makeOpenCode2Runtime = Effect.fn("makeOpenCode2Runtime")(function* (input: {
  readonly runCommand: OpenCode2CommandRunner;
  readonly httpClient: HttpClient.HttpClient;
}) {
  const connections = new Map<string, OpenCode2Connection>();
  const attachLock = yield* Semaphore.make(1);
  const runCommand = (command: OpenCode2CommandInput) =>
    input.runCommand(command).pipe(
      Effect.timeoutOption("10 seconds"),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              runtimeError({
                operation: command.args.join("."),
                kind: "command",
                detail: `OpenCode 2 command \`${command.args.join(" ")}\` timed out.`,
              }),
            ),
          onSome: (result) => Effect.succeed(result),
        }),
      ),
    );

  const attach: OpenCode2RuntimeShape["attach"] = (attachInput) => {
    const environment = attachInput.environment ?? process.env;
    const key = attachKey({ binaryPath: attachInput.binaryPath, environment });
    return attachLock.withPermit(
      Effect.gen(function* () {
        const existing = connections.get(key);
        if (existing) return existing;

        const start = yield* runCommand({
          binaryPath: attachInput.binaryPath,
          args: ["service", "start"],
          environment,
        });
        if (start.code !== 0) {
          return yield* runtimeError({
            operation: "service.start",
            kind: "command",
            detail: commandFailureDetail({ args: ["service", "start"], result: start }),
          });
        }
        const baseUrl = parseServiceUrl(start.stdout);
        if (baseUrl === null) {
          return yield* runtimeError({
            operation: "service.start",
            kind: "unsupported-preview",
            detail: "OpenCode 2 `service start` did not return a supported HTTP URL.",
          });
        }

        const passwordResult = yield* runCommand({
          binaryPath: attachInput.binaryPath,
          args: ["service", "get", "password"],
          environment,
        });
        if (passwordResult.code !== 0) {
          return yield* runtimeError({
            operation: "service.get.password",
            kind: "command",
            detail: commandFailureDetail({
              args: ["service", "get", "password"],
              result: passwordResult,
            }),
          });
        }
        const password = passwordResult.stdout.trim();
        if (password.length === 0) {
          return yield* runtimeError({
            operation: "service.get.password",
            kind: "unsupported-preview",
            detail: "OpenCode 2 `service get password` returned an empty credential.",
          });
        }

        const provisional = makeConnection({
          baseUrl,
          password,
          httpClient: input.httpClient,
          protocol: { promptShape: "flat", eventNamespace: "session" },
        });
        const document = yield* provisional.request("GET", "/openapi.json", {
          operation: "openapi.get",
          schema: Schema.Unknown,
        });
        const protocol = detectOpenCode2Protocol(document);
        if (protocol === null) {
          return yield* runtimeError({
            operation: "openapi.detect",
            kind: "unsupported-preview",
            detail:
              "This OpenCode 2 preview exposes an unsupported prompt or event protocol in `/openapi.json`.",
          });
        }

        const connection = makeConnection({
          baseUrl,
          password,
          httpClient: input.httpClient,
          protocol,
        });
        connections.set(key, connection);
        return connection;
      }),
    );
  };

  return OpenCode2Runtime.of({ attach });
});

const makeLiveCommandRunner = Effect.fn("makeOpenCode2CommandRunner")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const runCommand: OpenCode2CommandRunner = (input) =>
    Effect.gen(function* () {
      const spawn = yield* resolveSpawnCommand(input.binaryPath, input.args, {
        env: input.environment,
      }).pipe(
        Effect.mapError((cause) =>
          runtimeError({
            operation: "command.resolve",
            kind: "command",
            detail: "Failed to resolve the OpenCode 2 command.",
            cause,
          }),
        ),
      );
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawn.command, spawn.args, {
            env: input.environment,
            shell: spawn.shell,
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            runtimeError({
              operation: "command.spawn",
              kind: "command",
              detail: `Failed to execute the OpenCode 2 CLI at \`${input.binaryPath}\`.`,
              cause,
            }),
          ),
        );
      const [stdout, stderr, code] = yield* Effect.all(
        [
          collectStreamAsString(child.stdout),
          collectStreamAsString(child.stderr),
          child.exitCode.pipe(Effect.map(Number)),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError((cause) =>
          runtimeError({
            operation: "command.collect",
            kind: "command",
            detail: "Failed to collect OpenCode 2 command output.",
            cause,
          }),
        ),
      );
      return { stdout, stderr, code };
    }).pipe(Effect.scoped);
  return runCommand;
});

export const OpenCode2RuntimeLive = Layer.effect(
  OpenCode2Runtime,
  Effect.gen(function* () {
    const runCommand = yield* makeLiveCommandRunner();
    const httpClient = yield* HttpClient.HttpClient;
    return yield* makeOpenCode2Runtime({ runCommand, httpClient });
  }),
);
