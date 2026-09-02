/** Proxies the public T3 Connect dev origin to Vite while preserving T3 routes. */
import { isDevProxiedPath } from "@t3tools/shared/devProxy";
import { isLoopbackHost } from "@t3tools/shared/preview";
import * as Effect from "effect/Effect";
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
const DEV_SHARE_CACHE_KEY = String(process.pid);
const REACT_REFRESH_GUARD = `<script>
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
</script>`;

export function prepareDevShareHtml(html: string, cacheKey: string): string {
  const cacheIsolated = html.replace(
    /(\bsrc=)(["'])(\/(?!\/)[^"']+)\2/gu,
    (_match, prefix: string, quote: string, value: string) => {
      return `${prefix}${quote}/__t3-connect-dev-share/${encodeURIComponent(cacheKey)}${value}${quote}`;
    },
  );
  // Vite's experimental bundled-dev output can evaluate split React modules
  // before the entry initializes Fast Refresh. Its generated modules require
  // these globals during dependency evaluation; the entry replaces them with
  // the real runtime immediately afterward.
  if (cacheIsolated.includes("window.$RefreshReg$")) return cacheIsolated;
  return cacheIsolated.replace(/<head(?:\s[^>]*)?>/u, (head) => `${head}\n${REACT_REFRESH_GUARD}`);
}

export function stripDevShareAssetPrefix(pathname: string, cacheKey: string): string {
  const prefix = `/__t3-connect-dev-share/${encodeURIComponent(cacheKey)}`;
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
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
  const pathname = stripDevShareAssetPrefix(requestUrl.pathname, DEV_SHARE_CACHE_KEY);
  const target = new URL(devUrl);
  target.pathname = pathname;
  target.search = requestUrl.search;
  if (protocol === "ws") target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
}

export function shouldProxyConnectDevRequest(input: {
  readonly enabled: boolean;
  readonly devUrl: URL | undefined;
  readonly requestUrl: URL;
  readonly hasCloudflareRay: boolean;
  readonly listenerIsLoopback: boolean;
}): input is {
  readonly enabled: true;
  readonly devUrl: URL;
  readonly requestUrl: URL;
  readonly hasCloudflareRay: true;
  readonly listenerIsLoopback: true;
} {
  return (
    input.enabled &&
    input.devUrl !== undefined &&
    input.hasCloudflareRay &&
    input.listenerIsLoopback &&
    !isLoopbackHost(input.requestUrl.hostname) &&
    !isDevProxiedPath(input.requestUrl.pathname)
  );
}

const proxyHttpRequest = (
  devUrl: URL,
  request: HttpServerRequest.HttpServerRequest,
  requestUrl: URL,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const headers = filterDevShareRequestHeaders(request.headers);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstreamRequest = HttpClientRequest.make(request.method)(
      resolveDevShareTargetUrl(devUrl, requestUrl, "http"),
      { headers },
    ).pipe(hasBody ? HttpClientRequest.bodyStream(request.stream) : (self) => self);
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
        normalized === "content-length"
      ) {
        continue;
      }
      responseHeaders[normalized] = value;
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
    if (
      request.method === "GET" &&
      response.headers["content-type"]?.toLowerCase().startsWith("text/html")
    ) {
      return HttpServerResponse.text(
        prepareDevShareHtml(yield* response.text, DEV_SHARE_CACHE_KEY),
        {
          status: response.status,
          headers: proxiedHeaders,
        },
      );
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
    const clientSocket = yield* request.upgrade;
    const upstreamSocket = yield* Socket.makeWebSocket(
      resolveDevShareTargetUrl(devUrl, requestUrl, "ws"),
      {
        ...(protocols && protocols.length > 0 ? { protocols } : {}),
        openTimeout: "5 seconds",
      },
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const writeToClient = yield* clientSocket.writer;
        const writeToUpstream = yield* upstreamSocket.writer;
        yield* Effect.raceFirst(
          clientSocket.runRaw((data) => writeToUpstream(data)),
          upstreamSocket.runRaw((data) => writeToClient(data)),
        );
      }),
    ).pipe(Effect.catchTags({ SocketError: () => Effect.void }));
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
        // The tunnel reaches this listener over loopback. Refusing wildcard
        // listeners keeps a LAN caller from spoofing Cloudflare headers to
        // reach the otherwise loopback-only Vite process.
        listenerIsLoopback: isLoopbackHost(config.host ?? "127.0.0.1"),
        // Managed T3 Connect traffic always passes Cloudflare. Requiring its
        // injected request id prevents a DNS-rebinding hostname from turning
        // this loopback server into a general Vite proxy.
        hasCloudflareRay: typeof request.headers["cf-ray"] === "string",
      };
      if (!shouldProxyConnectDevRequest(selection)) return yield* httpEffect;
      const isWebSocket = request.headers.upgrade?.toLowerCase() === "websocket";
      return yield* isWebSocket
        ? proxyWebSocketUpgrade(selection.devUrl, request, selection.requestUrl)
        : proxyHttpRequest(selection.devUrl, request, selection.requestUrl);
    }),
  { global: true },
);
