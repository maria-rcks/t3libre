import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import {
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";

import { authenticateMediaRequest } from "../auth/http.ts";
import { assetResponseHeaders } from "../http.ts";
import * as ServerBrowser from "./ServerBrowser.ts";

const PREVIEW_STREAM_ROUTE_PREFIX = "/api/preview-stream";
/** Matches `PREVIEW_STREAM_TAB_GONE_CODE` in the client. */
const TAB_GONE_CODE = 4404;

const DEFAULT_QUALITY = 70;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_UNACKNOWLEDGED_FRAMES = 64;
const textDecoder = new TextDecoder();

const intParam = (params: URLSearchParams, name: string, fallback: number, max: number) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), max) : fallback;
};

const isAck = (message: unknown) =>
  typeof message === "object" && message !== null && "type" in message && message.type === "ack";

const parseMessage = (chunk: Uint8Array | string): unknown => {
  try {
    return JSON.parse(typeof chunk === "string" ? chunk : textDecoder.decode(chunk));
  } catch {
    return null;
  }
};

const makeHandler = (browser: ServerBrowser.ServerBrowser["Service"]) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    if (url.value.pathname === `${PREVIEW_STREAM_ROUTE_PREFIX}/download`) {
      return yield* serveDownload(browser, url.value.searchParams);
    }
    if (
      url.value.pathname !== `${PREVIEW_STREAM_ROUTE_PREFIX}/ws` ||
      request.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const session = yield* authenticateMediaRequest(AuthOrchestrationReadScope);
    const params = url.value.searchParams;
    const canOperate =
      session.scopes.includes(AuthOrchestrationOperateScope) &&
      params.get("interactive") !== "false";
    const threadId = params.get("threadId") ?? "";
    const tabId = params.get("tabId") ?? "";
    if (!browser.enabled || threadId.length === 0 || tabId.length === 0) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const attached = yield* browser
          .attachViewer({
            threadId,
            tabId,
            canOperate,
            maxWidth: intParam(params, "maxWidth", 1280, 7680),
            maxHeight: intParam(params, "maxHeight", 800, 4320),
            quality: intParam(params, "quality", DEFAULT_QUALITY, 100),
          })
          .pipe(
            Effect.map(Option.some),
            Effect.catchTag("ServerBrowserTabNotFoundError", () => Effect.succeedNone),
          );
        const incoming = NodeHttpServerRequest.toIncomingMessage(request);
        // JPEGs are already compressed. Disabling deflate also keeps all
        // pending writes in the socket buffer we bound below, not a zlib queue.
        delete incoming.headers["sec-websocket-extensions"];
        const transport = incoming.socket;
        const socket = yield* request.upgrade;
        // The reader performs the upgrade; writes wait for it.
        const reader = yield* socket.reader;
        const writer = yield* socket.writer;
        // A refused upgrade reads as an auth failure to ticket clients, so a
        // missing tab is a close code they stop on.
        const gone = writer.write(new Socket.CloseEvent(TAB_GONE_CODE, "tab closed"));
        if (Option.isNone(attached)) {
          yield* gone;
          return HttpServerResponse.empty();
        }
        const viewer = attached.value;
        // `write` returns once the frame is queued, so Chromium's ack for each
        // frame waits for the viewer's `ack` message instead.
        const unacknowledged: Array<Effect.Effect<void>> = [];
        const disconnectSlowViewer = Effect.sync(() => transport.destroy()).pipe(
          Effect.andThen(Effect.interrupt),
        );
        const write = (data: Uint8Array | string) =>
          Effect.suspend(() => {
            const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
            // Include the WebSocket frame header in the budget.
            if (transport.writableLength + bytes + 14 > MAX_SOCKET_BUFFER_BYTES) {
              return disconnectSlowViewer;
            }
            return writer.write(data);
          });
        const sendOutput = Queue.take(viewer.output).pipe(
          Effect.flatMap((output) => {
            switch (output._tag) {
              case "frame":
                if (unacknowledged.length >= MAX_UNACKNOWLEDGED_FRAMES) {
                  return disconnectSlowViewer;
                }
                return write(output.data).pipe(
                  Effect.andThen(Effect.sync(() => unacknowledged.push(output.ack))),
                );
              case "viewport":
              case "control":
              case "clipboard":
              case "download":
              case "probe": {
                const { _tag: type, ...data } = output;
                return write(JSON.stringify({ type, ...data }));
              }
              case "gone":
                return gone.pipe(Effect.andThen(Effect.interrupt));
            }
          }),
        );
        const receive = (chunk: Uint8Array | string) => {
          const message = parseMessage(chunk);
          // Ownership serializes actions in the service. Keep reading so dialog
          // replies and takeover can unblock an action already waiting on the page.
          if (!isAck(message))
            return canOperate
              ? viewer.input(message).pipe(Effect.forkScoped, Effect.asVoid)
              : Effect.void;
          const ack = unacknowledged.shift();
          // Forked: Chromium acks are paced and must not hold up input.
          return ack ? Effect.forkScoped(ack).pipe(Effect.asVoid) : Effect.void;
        };
        const receiveInput = reader.pull.pipe(
          Effect.flatMap((chunks) => Effect.forEach(chunks, receive, { discard: true })),
        );
        return yield* Effect.raceFirst(Effect.forever(sendOutput), Effect.forever(receiveInput));
      }),
    ).pipe(
      Effect.catchTag("ServerBrowserLaunchError", (error) =>
        Effect.logWarning("server preview browser failed to start", { cause: error.cause }).pipe(
          Effect.as(HttpServerResponse.text("Service Unavailable", { status: 503 })),
        ),
      ),
      // A dropped socket is a normal end of viewing.
      Effect.catch(() => Effect.succeed(HttpServerResponse.empty())),
    );
  });

/** `GET /api/preview-stream/download?threadId&tabId&id`: a file a server tab downloaded. */
const serveDownload = (browser: ServerBrowser.ServerBrowser["Service"], params: URLSearchParams) =>
  Effect.gen(function* () {
    yield* authenticateMediaRequest(AuthOrchestrationReadScope);
    const download = yield* browser.openDownload({
      threadId: params.get("threadId") ?? "",
      tabId: params.get("tabId") ?? "",
      downloadId: params.get("id") ?? "",
    });
    if (Option.isNone(download)) return HttpServerResponse.text("Not Found", { status: 404 });
    return yield* HttpServerResponse.file(download.value.path, {
      headers: assetResponseHeaders(download.value.path, {
        download: true,
        fileName: download.value.fileName,
      }),
    });
  });

// Capture the browser because handlers only see request-scoped services.
export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const browser = yield* ServerBrowser.ServerBrowser;
    const platform = yield* Effect.context<HttpPlatform.HttpPlatform>();
    yield* router.add(
      "GET",
      `${PREVIEW_STREAM_ROUTE_PREFIX}/*`,
      makeHandler(browser).pipe(Effect.provideContext(platform)),
    );
  }),
);
