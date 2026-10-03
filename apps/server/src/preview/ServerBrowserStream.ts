/**
 * `/api/preview-stream/ws`: one server preview tab over a WebSocket.
 *
 * Frames go out as binary JPEG messages, viewport changes as JSON text, and
 * viewer input comes back as JSON text. Each frame is acknowledged to Chromium
 * only after the socket write drains, so a slow link (phone over T3 Connect)
 * gets fewer frames instead of a growing buffer. Authentication matches the
 * device hub proxy; the socket drives the page, so it needs operate scope.
 */
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";

import { authenticateMediaRequest } from "../auth/http.ts";
import * as ServerBrowser from "./ServerBrowser.ts";

export const PREVIEW_STREAM_ROUTE_PREFIX = "/api/preview-stream";
/** Matches `PREVIEW_STREAM_TAB_GONE_CODE` in the client. */
const TAB_GONE_CODE = 4404;

const DEFAULT_QUALITY = 70;
const textDecoder = new TextDecoder();

const intParam = (params: URLSearchParams, name: string, fallback: number, max: number) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), max) : fallback;
};

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
    if (
      url.value.pathname !== `${PREVIEW_STREAM_ROUTE_PREFIX}/ws` ||
      request.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    yield* authenticateMediaRequest(AuthOrchestrationOperateScope);
    const params = url.value.searchParams;
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
            maxWidth: intParam(params, "maxWidth", 1280, 7680),
            maxHeight: intParam(params, "maxHeight", 800, 4320),
            quality: intParam(params, "quality", DEFAULT_QUALITY, 100),
          })
          .pipe(
            Effect.map(Option.some),
            Effect.catchTag("ServerBrowserTabNotFoundError", () => Effect.succeedNone),
          );
        const socket = yield* request.upgrade;
        const writer = yield* socket.writer;
        // A refused upgrade reads as an auth failure to ticket clients, so a
        // missing tab is a close code they stop on.
        const gone = writer.write(new Socket.CloseEvent(TAB_GONE_CODE, "tab closed"));
        if (Option.isNone(attached)) {
          yield* gone;
          return HttpServerResponse.empty();
        }
        const viewer = attached.value;
        const reader = yield* socket.reader;
        const sendOutput = Queue.take(viewer.output).pipe(
          Effect.flatMap((output) => {
            switch (output._tag) {
              case "frame":
                return writer.write(output.data).pipe(Effect.ensuring(output.ack));
              case "viewport":
                return writer.write(
                  JSON.stringify({ type: "viewport", width: output.width, height: output.height }),
                );
              case "probe":
                return writer.write(
                  JSON.stringify({
                    type: "probe",
                    x: output.x,
                    y: output.y,
                    editable: output.editable,
                  }),
                );
              case "gone":
                return gone.pipe(Effect.andThen(Effect.interrupt));
            }
          }),
        );
        const receiveInput = reader.pull.pipe(
          Effect.flatMap((chunks) =>
            Effect.forEach(chunks, (chunk) => viewer.input(parseMessage(chunk)), { discard: true }),
          ),
        );
        // Whichever side ends first closes the other through scope teardown.
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

// Route handlers only see request-scoped services, so the browser is captured
// when the route is registered.
export const routeLayer = HttpRouter.use((router) =>
  Effect.flatMap(ServerBrowser.ServerBrowser, (browser) =>
    router.add("GET", `${PREVIEW_STREAM_ROUTE_PREFIX}/*`, makeHandler(browser)),
  ),
);
