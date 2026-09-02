/** Proxies the public T3 Connect dev origin to Vite while preserving T3 routes. */
import { isDevProxiedPath } from "@t3tools/shared/devProxy";
import { isLoopbackHost } from "@t3tools/shared/preview";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import {
  Headers,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Socket from "effect/unstable/socket/Socket";

import * as ServerConfig from "../config.ts";

const BASE_HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const DEV_SHARE_PUBLIC_FILES = new Set([
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon.ico",
  "/manifest.webmanifest",
]);
let trustedManagedOrigin: { readonly url: URL } | undefined;

function registerConnectDevShareManagedOrigin(origin: URL): () => void {
  const registered = { url: new URL(origin.origin) };
  trustedManagedOrigin = registered;
  return () => {
    if (trustedManagedOrigin === registered) trustedManagedOrigin = undefined;
  };
}

/** Trust one managed Connect origin for the current scope. */
export const trustConnectDevShareManagedOrigin = (origin: URL) =>
  Effect.acquireRelease(
    Effect.sync(() => registerConnectDevShareManagedOrigin(origin)),
    (release) => Effect.sync(release),
  ).pipe(Effect.asVoid);

function normalizedDevShareBasePath(devUrl: URL): string | undefined {
  const pathname = devUrl.pathname;
  if (pathname === "/") return undefined;
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function connectionHeaderNames(headers: Readonly<Record<string, string>>): Set<string> {
  const names = new Set(BASE_HOP_BY_HOP_HEADERS);
  for (const value of Object.entries(headers)) {
    if (value[0].toLowerCase() !== "connection") continue;
    for (const name of value[1].split(",")) {
      const normalized = name.trim().toLowerCase();
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

export function filterDevShareRequestHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const excluded = connectionHeaderNames(headers);
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      excluded.has(normalized) ||
      normalized === "host" ||
      normalized === "content-length" ||
      normalized === "accept-encoding" ||
      normalized === "authorization" ||
      normalized === "cookie" ||
      normalized === "dpop"
    ) {
      continue;
    }
    forwarded[normalized] = value;
  }
  return forwarded;
}

function responseConnectionHeaderNames(
  headers: Readonly<Record<string, string | ReadonlyArray<string>>>,
): Set<string> {
  const names = new Set(BASE_HOP_BY_HOP_HEADERS);
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "connection") continue;
    const combined = typeof value === "string" ? value : value.join(",");
    for (const token of combined.split(",")) {
      const normalized = token.trim().toLowerCase();
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

export function resolveDevShareTargetUrl(
  devUrl: URL,
  requestUrl: URL,
  protocol: "http" | "ws",
): string {
  const target = new URL(devUrl);
  target.pathname = requestUrl.pathname === "/" ? devUrl.pathname : requestUrl.pathname;
  target.search = requestUrl.search;
  if (protocol === "ws") target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
}

export function rewriteDevShareLocation(
  location: string,
  upstreamRequestUrl: URL,
  devUrl: URL,
  managedOrigin: URL,
): string {
  let resolved: URL;
  try {
    resolved = new URL(location, upstreamRequestUrl);
  } catch {
    return location;
  }
  if (resolved.origin !== devUrl.origin) return location;
  const rewritten = new URL(managedOrigin.origin);
  rewritten.pathname = resolved.pathname;
  rewritten.search = resolved.search;
  rewritten.hash = resolved.hash;
  return rewritten.toString();
}

function isTrustedManagedOrigin(requestUrl: URL, managedOrigin: URL | undefined): boolean {
  return (
    managedOrigin !== undefined &&
    requestUrl.host.toLowerCase() === managedOrigin.host.toLowerCase()
  );
}

function isPublicDevSharePath(requestUrl: URL, devUrl: URL): boolean {
  const basePath = normalizedDevShareBasePath(devUrl);
  if (basePath === undefined) return false;
  if (
    requestUrl.pathname === "/" ||
    requestUrl.pathname === basePath ||
    requestUrl.pathname === `${basePath}/`
  ) {
    return true;
  }
  const suffix = requestUrl.pathname.slice(basePath.length);
  return (
    requestUrl.pathname.startsWith(`${basePath}/`) &&
    (suffix.startsWith("/assets/") || DEV_SHARE_PUBLIC_FILES.has(suffix))
  );
}

function isDevShareWebSocketPath(requestUrl: URL, devUrl: URL): boolean {
  const basePath = normalizedDevShareBasePath(devUrl);
  return (
    basePath !== undefined &&
    (requestUrl.pathname === basePath || requestUrl.pathname === `${basePath}/`)
  );
}

function hasViteHmrProtocol(protocolHeader: string | undefined): boolean {
  return protocolHeader?.split(",").some((protocol) => protocol.trim() === "vite-hmr") === true;
}

export function shouldProxyConnectDevRequest(input: {
  readonly enabled: boolean;
  readonly devUrl: URL | undefined;
  readonly requestUrl: URL;
  readonly managedOrigin: URL | undefined;
  readonly hasCloudflareRay: boolean;
  readonly listenerIsLoopback: boolean;
}): input is {
  readonly enabled: true;
  readonly devUrl: URL;
  readonly requestUrl: URL;
  readonly managedOrigin: URL;
  readonly hasCloudflareRay: true;
  readonly listenerIsLoopback: true;
} {
  return (
    input.enabled &&
    input.devUrl !== undefined &&
    input.hasCloudflareRay &&
    input.listenerIsLoopback &&
    isTrustedManagedOrigin(input.requestUrl, input.managedOrigin) &&
    isPublicDevSharePath(input.requestUrl, input.devUrl) &&
    !isDevProxiedPath(input.requestUrl.pathname)
  );
}

const proxyHttpRequest = (
  devUrl: URL,
  managedOrigin: URL,
  request: HttpServerRequest.HttpServerRequest,
  requestUrl: URL,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const headers = filterDevShareRequestHeaders(request.headers);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstreamRequestUrl = new URL(resolveDevShareTargetUrl(devUrl, requestUrl, "http"));
    const upstreamRequest = HttpClientRequest.make(request.method)(upstreamRequestUrl, {
      headers,
    }).pipe(hasBody ? HttpClientRequest.bodyStream(request.stream) : (self) => self);
    const response = yield* httpClient
      .execute(upstreamRequest)
      .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));
    const excluded = responseConnectionHeaderNames(response.headers);
    const responseHeaders: Record<string, string | ReadonlyArray<string>> = {};
    for (const [name, value] of Object.entries(response.headers)) {
      const normalized = name.toLowerCase();
      if (
        excluded.has(normalized) ||
        normalized === "content-encoding" ||
        normalized === "content-length" ||
        normalized === "set-cookie"
      ) {
        continue;
      }
      responseHeaders[normalized] =
        normalized === "location" && typeof value === "string"
          ? rewriteDevShareLocation(value, upstreamRequestUrl, devUrl, managedOrigin)
          : value;
    }
    const proxiedHeaders = Headers.fromInput({
      ...responseHeaders,
      // Cloudflare otherwise assigns cacheable Vite assets a four-hour edge
      // TTL. That can pin a prior dev process's fixed /assets/index.js across
      // restarts and makes a browser render code that is no longer on disk.
      "cache-control": "no-store",
      "cloudflare-cdn-cache-control": "no-store",
      "x-t3-connect-dev-share": "vite",
    });
    if (response.status === 204 || response.status === 304) {
      return HttpServerResponse.empty({
        status: response.status,
        headers: proxiedHeaders,
      });
    }
    return HttpServerResponse.stream(response.stream, {
      status: response.status,
      headers: proxiedHeaders,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug("T3 Connect dev-share HTTP proxy failed", { cause }).pipe(
        Effect.as(HttpServerResponse.text("The Vite dev server is unreachable.", { status: 502 })),
      ),
    ),
  );

const globalWebSocketConstructor: (typeof Socket.WebSocketConstructor)["Service"] = (
  url,
  protocols,
) => new globalThis.WebSocket(url, protocols);

const proxyWebSocketUpgrade = (
  devUrl: URL,
  request: HttpServerRequest.HttpServerRequest,
  requestUrl: URL,
) =>
  Effect.gen(function* () {
    const protocolHeader = request.headers["sec-websocket-protocol"];
    const protocols = protocolHeader
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const upstreamSocket = yield* Socket.makeWebSocket(
      resolveDevShareTargetUrl(devUrl, requestUrl, "ws"),
      {
        ...(protocols && protocols.length > 0 ? { protocols } : {}),
        openTimeout: "5 seconds",
      },
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const upstreamOpened = yield* Deferred.make<void>();
        const clientWriter =
          yield* Deferred.make<
            (
              chunk: Uint8Array | string | Socket.CloseEvent,
            ) => Effect.Effect<void, Socket.SocketError>
          >();
        const writeToUpstream = yield* upstreamSocket.writer;
        const upstreamFiber = yield* upstreamSocket
          .runRaw(
            (data) => Deferred.await(clientWriter).pipe(Effect.flatMap((write) => write(data))),
            {
              onOpen: Deferred.succeed(upstreamOpened, undefined).pipe(Effect.asVoid),
            },
          )
          .pipe(Effect.forkScoped);
        yield* Effect.raceFirst(
          Deferred.await(upstreamOpened),
          Fiber.join(upstreamFiber).pipe(
            Effect.andThen(Effect.die(new Error("Vite WebSocket closed before opening"))),
          ),
        );
        const clientSocket = yield* request.upgrade;
        const writeToClient = yield* clientSocket.writer;
        yield* Deferred.succeed(clientWriter, writeToClient);
        yield* Effect.raceFirst(
          clientSocket.runRaw((data) => writeToUpstream(data)),
          Fiber.join(upstreamFiber),
        ).pipe(Effect.catchTags({ SocketError: () => Effect.void }));
      }),
    );
    return HttpServerResponse.empty();
  }).pipe(
    Effect.provideService(Socket.WebSocketConstructor, globalWebSocketConstructor),
    Effect.catchCause((cause) =>
      Effect.logDebug("T3 Connect dev-share WebSocket proxy failed", { cause }).pipe(
        Effect.as(
          HttpServerResponse.text("The Vite dev server WebSocket is unreachable.", { status: 502 }),
        ),
      ),
    ),
  );

export const connectDevShareProxyLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestUrl = HttpServerRequest.toURL(request);
      if (Option.isNone(requestUrl)) return yield* httpEffect;
      const config = yield* ServerConfig.ServerConfig;
      const selection = {
        enabled: config.connectDevShare === true,
        devUrl: config.devUrl,
        requestUrl: requestUrl.value,
        managedOrigin: trustedManagedOrigin?.url,
        // The tunnel reaches this listener over loopback. Refusing wildcard
        // listeners keeps a LAN caller from spoofing Cloudflare headers to
        // reach the otherwise loopback-only Vite process.
        listenerIsLoopback: isLoopbackHost(config.host ?? "127.0.0.1"),
        // Managed T3 Connect traffic always passes Cloudflare. Its request id
        // must accompany the exact origin registered by the link lifecycle.
        hasCloudflareRay: typeof request.headers["cf-ray"] === "string",
      };
      if (!shouldProxyConnectDevRequest(selection)) return yield* httpEffect;
      const isWebSocket = request.headers.upgrade?.toLowerCase() === "websocket";
      if (
        isWebSocket &&
        (!isDevShareWebSocketPath(selection.requestUrl, selection.devUrl) ||
          !hasViteHmrProtocol(request.headers["sec-websocket-protocol"]))
      ) {
        return yield* httpEffect;
      }
      return yield* isWebSocket
        ? proxyWebSocketUpgrade(selection.devUrl, request, selection.requestUrl)
        : proxyHttpRequest(
            selection.devUrl,
            selection.managedOrigin,
            request,
            selection.requestUrl,
          );
    }),
  { global: true },
);
