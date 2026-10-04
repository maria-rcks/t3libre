import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { HttpRouter, HttpServer } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerBrowser from "./ServerBrowser.ts";
import { routeLayer } from "./ServerBrowserStream.ts";

const makeAuth = (
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  error?: EnvironmentAuth.ServerAuthCredentialError,
) => {
  const requests: string[] = [];
  const layer = Layer.mock(EnvironmentAuth.EnvironmentAuth, {
    authenticateWebSocketUpgrade: (request) => {
      requests.push(request.originalUrl);
      return error
        ? Effect.fail(error)
        : Effect.succeed({
            sessionId: AuthSessionId.make("stream-test"),
            subject: "stream-test",
            method: "bearer-access-token",
            scopes,
          });
    },
  });
  return { layer, requests };
};

const mutations = [
  { type: "resize", width: 390, height: 844 },
  { type: "mouse", action: "down", x: 10, y: 10, button: "left", buttons: 1 },
  { type: "key", action: "down", key: "Enter" },
  { type: "text", text: "reader must not type" },
  { type: "wheel", deltaY: 100 },
  { type: "navigate", url: "https://example.com" },
  { type: "history", delta: -1 },
  { type: "reload" },
  { type: "probe", x: 10, y: 10 },
  { type: "takeControl" },
  { type: "releaseControl" },
  { type: "dialog", accept: true },
  { type: "viewport", setting: { _tag: "fill" } },
];

it.effect.each([
  { hasOperateScope: false, interactive: true },
  { hasOperateScope: true, interactive: true },
  { hasOperateScope: true, interactive: false },
])("streams frames and acks while gating page mutations (%s)", ({ hasOperateScope, interactive }) =>
  Effect.gen(function* () {
    const canOperate = hasOperateScope && interactive;
    const scopes = hasOperateScope
      ? [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]
      : [AuthOrchestrationReadScope];
    const auth = makeAuth(scopes);
    const inputs: unknown[] = [];
    const attachments: Parameters<ServerBrowser.ServerBrowser["Service"]["attachViewer"]>[0][] = [];
    const acked = Promise.withResolvers<void>();
    const frame = new Uint8Array([255, 216, 255, 217]);
    const output = yield* Queue.make<ServerBrowser.ServerBrowserViewerOutput>();
    yield* Queue.offer(output, { _tag: "viewport", width: 1280, height: 800 });
    yield* Queue.offer(output, {
      _tag: "frame",
      data: frame,
      ack: Effect.sync(() => acked.resolve()),
    });
    const browser = ServerBrowser.ServerBrowser.of({
      enabled: true,
      attachViewer: (input) =>
        Effect.sync(() => {
          attachments.push(input);
          return {
            output,
            input: (message) => Effect.sync(() => void inputs.push(message)),
          };
        }),
    });
    const services = yield* Layer.build(
      HttpRouter.serve(
        routeLayer.pipe(Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser))),
        { disableListenLog: true },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provide(auth.layer)),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
    const resource = `/api/preview-stream/ws?threadId=thread&tabId=tab&wsTicket=one-use-ticket${interactive ? "" : "&interactive=false"}`;
    const received = Promise.withResolvers<void>();
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(`${origin}${resource}`)),
      (socket) => Effect.sync(() => socket.close()),
    );
    socket.binaryType = "arraybuffer";
    const viewports: unknown[] = [];
    const frames: Uint8Array[] = [];
    socket.addEventListener("error", () => received.reject(new Error("stream failed")));
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        viewports.push(JSON.parse(event.data));
        return;
      }
      frames.push(new Uint8Array(event.data as ArrayBuffer));
      for (const message of mutations) socket.send(JSON.stringify(message));
      socket.send("malformed input");
      socket.send(JSON.stringify({ type: "ack" }));
      received.resolve();
    });
    yield* Effect.promise(() => received.promise);
    // The ack follows every mutation on the socket, so this is also a barrier
    // proving all preceding inputs were processed, without a timing sleep.
    yield* Effect.promise(() => acked.promise);
    expect(frames).toEqual([frame]);
    expect(viewports).toEqual([{ type: "viewport", width: 1280, height: 800 }]);
    expect(inputs).toEqual(canOperate ? [...mutations, null] : []);
    expect(attachments).toEqual([
      {
        threadId: "thread",
        tabId: "tab",
        maxWidth: 1280,
        maxHeight: 800,
        quality: 70,
        canOperate,
      },
    ]);
    // In particular, a one-use ticket must never be authenticated a second
    // time to discover whether this read session also has operate scope.
    expect(auth.requests).toEqual([resource]);
  }).pipe(Effect.scoped),
);

it.effect.each([
  { scopes: [], error: undefined, status: 403 },
  { scopes: [AuthOrchestrationOperateScope], error: undefined, status: 403 },
  { scopes: [], error: new EnvironmentAuth.ServerAuthMissingCredentialError({}), status: 401 },
])("rejects unauthorized stream connections before attaching a viewer (%s)", (testCase) =>
  Effect.gen(function* () {
    const auth = makeAuth(testCase.scopes, testCase.error);
    let attachments = 0;
    const browser = ServerBrowser.ServerBrowser.of({
      enabled: true,
      attachViewer: () => {
        attachments++;
        return Effect.die("unauthorized viewer must not attach");
      },
    });
    const handler = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          routeLayer.pipe(
            Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
            Layer.provideMerge(auth.layer),
          ),
          { disableLogger: true },
        ),
      ),
      ({ dispose }) => Effect.promise(dispose),
    );
    const response = yield* Effect.promise(() =>
      handler.handler(
        new Request("http://t3.test/api/preview-stream/ws?threadId=thread&tabId=tab", {
          headers: { upgrade: "websocket" },
        }),
      ),
    );
    expect(response.status).toBe(testCase.status);
    expect(attachments).toBe(0);
  }).pipe(Effect.scoped),
);
