import { describe, expect, it } from "@effect/vitest";
import * as EffectAcpErrors from "effect-acp/errors";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";
import { applyDevinAcpModelSelection } from "./DevinAcpSupport.ts";
import {
  devinApprovalOptions,
  devinTokenUsage,
  selectDevinPermissionOptionId,
  normalizeDevinSessionUpdate,
  normalizeDevinToolCall,
} from "./DevinProtocol.ts";
import { parseSessionUpdateEvent } from "./AcpRuntimeModel.ts";
import { ProviderDriverKind } from "@t3tools/contracts";

import { acpPermissionOutcome, mapAcpToAdapterError } from "./AcpAdapterSupport.ts";

describe("AcpAdapterSupport", () => {
  it("maps ACP approval decisions to permission outcomes", () => {
    expect(acpPermissionOutcome("accept")).toBe("allow-once");
    expect(acpPermissionOutcome("acceptForSession")).toBe("allow-always");
    expect(acpPermissionOutcome("decline")).toBe("reject-once");
  });

  it("maps ACP request errors to provider adapter request errors", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("cursor"),
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: "Invalid params",
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Invalid params");
  });
});

describe("Devin ACP protocol", () => {
  it("grants thread approval only through Devin's session option", () => {
    const request = {
      sessionId: "session-1",
      toolCall: { toolCallId: "tool-1" },
      options: [
        { optionId: "allow_workspace", name: "Workspace", kind: "allow_always" },
        { optionId: "allow_global", name: "Global", kind: "allow_always" },
        { optionId: "allow_session", name: "Session", kind: "allow_always" },
      ],
    } satisfies EffectAcpSchema.RequestPermissionRequest;
    expect(selectDevinPermissionOptionId(request, "acceptForSession")).toBe("allow_session");
    const persistentOnly = { ...request, options: request.options.slice(0, 2) };
    expect(selectDevinPermissionOptionId(persistentOnly, "acceptForSession")).toBeUndefined();
    expect(devinApprovalOptions(persistentOnly)).toEqual([{ decision: "cancel", label: "Cancel" }]);
  });

  it("preserves one-time allow, deny, and cancellation choices", () => {
    const request = {
      sessionId: "session-1",
      toolCall: { toolCallId: "tool-1" },
      options: [
        { optionId: "allow_once", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    } satisfies EffectAcpSchema.RequestPermissionRequest;
    expect(selectDevinPermissionOptionId(request, "accept")).toBe("allow_once");
    expect(selectDevinPermissionOptionId(request, "decline")).toBe("deny");
    expect(selectDevinPermissionOptionId(request, "cancel")).toBeUndefined();
    expect(devinApprovalOptions(request)).toEqual([
      { decision: "accept", label: "Allow once" },
      { decision: "decline", label: "Deny" },
      { decision: "cancel", label: "Cancel" },
    ]);
  });

  it("carries shell output and native exit metadata into rendered tool items", () => {
    const notification = normalizeDevinSessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run command",
        kind: "execute",
        status: "completed",
        rawInput: { command: "printf hello" },
        content: [{ type: "content", content: { type: "text", text: "hello" } }],
        _meta: {
          "cognition.ai/cwd": "/workspace",
          "cognition.ai/inferenceToolName": "exec",
          terminal_exit: { exit_code: 7 },
        },
      },
    });
    const event = parseSessionUpdateEvent(notification).events.find(
      (entry) => entry._tag === "ToolCallUpdated",
    );
    expect(event?._tag).toBe("ToolCallUpdated");
    if (event?._tag !== "ToolCallUpdated") throw new Error("Missing tool event");
    const toolCall = normalizeDevinToolCall(event.toolCall);
    expect(toolCall.status).toBe("failed");
    expect(toolCall.data).toMatchObject({
      toolName: "exec",
      cwd: "/workspace",
      item: { aggregatedOutput: "hello", exitCode: 7, cwd: "/workspace" },
    });
  });

  it("reports root context occupancy and the last inference without inventing cumulative totals", () => {
    const parsed = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "usage_update",
        used: 14_145,
        size: 200_000,
        _meta: {
          "cognition.ai/inputTokens": 14_118,
          "cognition.ai/cachedReadTokens": 14_080,
          "cognition.ai/outputTokens": 27,
        },
      },
    });
    expect(parsed.events).toHaveLength(1);
    const event = parsed.events[0];
    expect(event?._tag).toBe("UsageUpdated");
    if (event?._tag !== "UsageUpdated") throw new Error("Missing usage event");
    expect(devinTokenUsage(event.usage)).toEqual({
      usedTokens: 14_145,
      maxTokens: 200_000,
      lastUsedTokens: 14_145,
      lastInputTokens: 14_118,
      lastCachedInputTokens: 14_080,
      lastOutputTokens: 27,
    });
  });

  it.each(["root", "child-agent"])(
    "ignores usage marked with subagent context %s",
    (parentAgentId) => {
      expect(
        devinTokenUsage({
          used: 14_145,
          size: 200_000,
          _meta: { "cognition.ai/subagent_context": { parentAgentId } },
        }),
      ).toBeUndefined();
    },
  );

  it("keeps context occupancy when the provider omits inference metadata or a context limit", () => {
    expect(devinTokenUsage({ used: 42, size: 0 })).toEqual({
      usedTokens: 42,
      lastUsedTokens: 42,
    });
  });

  it.each([
    { used: -1, size: 200_000 },
    { used: Number.NaN, size: 200_000 },
    { used: 42.5, size: 200_000 },
    { used: 42, size: Number.POSITIVE_INFINITY },
    { used: 42, size: 200_000, _meta: { "cognition.ai/outputTokens": "27" } },
    { used: 42, size: 200_000, _meta: { "cognition.ai/cachedReadTokens": -1 } },
  ])("rejects invalid usage values: %j", (usage) => {
    expect(devinTokenUsage(usage)).toBeUndefined();
  });

  it.effect("reapplies a saved native model after a cold resume", () =>
    Effect.gen(function* () {
      const selections: string[] = [];
      const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "current-model",
          options: [
            { value: "current-model", name: "Current" },
            { value: "saved-model", name: "Saved" },
          ],
        },
      ];
      const model = yield* applyDevinAcpModelSelection({
        runtime: {
          getConfigOptions: Effect.succeed(configOptions),
          setModel: (value) =>
            Effect.sync(() => {
              selections.push(value);
            }),
        },
        model: "saved-model",
        mapError: (cause) => cause,
      });
      expect(model).toBe("saved-model");
      expect(selections).toEqual(["saved-model"]);
    }),
  );

  it.effect("rejects an unavailable model without changing the session model", () =>
    Effect.gen(function* () {
      const selections: string[] = [];
      const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "current-model",
          options: [{ value: "current-model", name: "Current" }],
        },
      ];
      const error = yield* applyDevinAcpModelSelection({
        runtime: {
          getConfigOptions: Effect.succeed(configOptions),
          setModel: (value) =>
            Effect.sync(() => {
              selections.push(value);
            }),
        },
        model: "missing-model",
        mapError: (cause) => cause,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({
        code: -32602,
        errorMessage: expect.stringContaining("'missing-model' is unavailable"),
      });
      expect(selections).toEqual([]);
    }),
  );
});
