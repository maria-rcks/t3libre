import {
  ThreadTokenUsageSnapshot,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { AcpToolCallState } from "./AcpRuntimeModel.ts";

const decodeUsage = Schema.decodeUnknownOption(ThreadTokenUsageSnapshot);

/** Devin reports context occupancy and the last inference, not cumulative token totals. */
export function devinTokenUsage(
  update: EffectAcpSchema.UsageUpdate,
): ThreadTokenUsageSnapshot | undefined {
  const meta = update._meta;
  // Native updates repeat the root snapshot with this marker and also report children.
  if (meta?.["cognition.ai/subagent_context"] !== undefined) return undefined;
  const inputTokens = meta?.["cognition.ai/inputTokens"];
  const cachedInputTokens = meta?.["cognition.ai/cachedReadTokens"];
  const outputTokens = meta?.["cognition.ai/outputTokens"];
  return Option.getOrUndefined(
    decodeUsage({
      usedTokens: update.used,
      ...(update.size > 0 ? { maxTokens: update.size } : {}),
      lastUsedTokens: update.used,
      ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
      ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
      ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    }),
  );
}

/** Devin distinguishes session grants from persistent workspace and global grants. */
export function selectDevinPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined {
  if (decision === "cancel" || decision === "acceptAlways") return undefined;
  const option =
    decision === "acceptForSession"
      ? request.options.find(
          (entry) => entry.optionId === "allow_session" && entry.kind === "allow_always",
        )
      : request.options.find(
          (entry) => entry.kind === (decision === "accept" ? "allow_once" : "reject_once"),
        );
  return option?.optionId.trim() ? option.optionId : undefined;
}

export function devinApprovalOptions(
  request: EffectAcpSchema.RequestPermissionRequest,
): ReadonlyArray<ProviderApprovalOption> {
  const options: ProviderApprovalOption[] = [];
  for (const [decision, label] of [
    ["accept", "Allow once"],
    ["acceptForSession", "Allow for this thread"],
    ["decline", "Deny"],
  ] as const) {
    if (selectDevinPermissionOptionId(request, decision)) options.push({ decision, label });
  }
  options.push({ decision: "cancel", label: "Cancel" });
  return options;
}

/** Preserve native terminal metadata through the shared ACP tool-state parser. */
export function normalizeDevinSessionUpdate(
  notification: EffectAcpSchema.SessionNotification,
): EffectAcpSchema.SessionNotification {
  const update = notification.update;
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return notification;
  }
  const meta = update._meta;
  if (!Predicate.isObject(meta)) return notification;
  const terminal = meta.terminal_exit;
  const cwd = meta["cognition.ai/cwd"];
  const toolName = meta["cognition.ai/inferenceToolName"];
  // A final status-only update must retain the preceding terminal exit result.
  if (typeof cwd !== "string" && !Predicate.isObject(terminal)) return notification;
  return {
    ...notification,
    update: {
      ...update,
      rawOutput: {
        ...(Predicate.isObject(update.rawOutput) ? update.rawOutput : {}),
        ...(typeof cwd === "string" ? { cwd } : {}),
        ...(typeof toolName === "string" ? { toolName } : {}),
        ...(Predicate.isObject(terminal) && typeof terminal.exit_code === "number"
          ? { exitCode: terminal.exit_code }
          : {}),
      },
    },
  };
}

export function normalizeDevinToolCall(toolCall: AcpToolCallState): AcpToolCallState {
  const output = Predicate.isObject(toolCall.data.rawOutput) ? toolCall.data.rawOutput : {};
  const previousItem = Predicate.isObject(toolCall.data.item) ? toolCall.data.item : {};
  const data = { ...toolCall.data };
  let status = toolCall.status;
  if (typeof output.toolName === "string") data.toolName = output.toolName;
  if (toolCall.kind === "execute") {
    const content = Array.isArray(data.content) ? data.content : [];
    const text = content
      .flatMap((entry: unknown) =>
        Predicate.isObject(entry) &&
        entry.type === "content" &&
        Predicate.isObject(entry.content) &&
        entry.content.type === "text" &&
        typeof entry.content.text === "string"
          ? [entry.content.text]
          : [],
      )
      .join("\n");
    data.item = {
      ...previousItem,
      ...(toolCall.command ? { command: toolCall.command } : {}),
      ...(typeof output.cwd === "string" ? { cwd: output.cwd } : {}),
      ...(typeof output.exitCode === "number" ? { exitCode: output.exitCode } : {}),
      ...(text ? { aggregatedOutput: text } : {}),
    };
    if (typeof output.cwd === "string") data.cwd = output.cwd;
    if (
      typeof output.exitCode === "number" &&
      Number.isFinite(output.exitCode) &&
      output.exitCode !== 0
    ) {
      status = "failed";
    }
  }
  if (toolCall.kind === "edit") {
    const input = Predicate.isObject(data.rawInput) ? data.rawInput : {};
    const content = Array.isArray(data.content) ? data.content : [];
    const paths = new Set([
      ...(typeof input.file_path === "string" && input.file_path.trim() ? [input.file_path] : []),
      ...content.flatMap((entry: unknown) =>
        Predicate.isObject(entry) &&
        entry.type === "diff" &&
        typeof entry.path === "string" &&
        entry.path.trim()
          ? [entry.path]
          : [],
      ),
    ]);
    if (paths.size > 0) {
      data.item = { ...previousItem, changes: [...paths].map((path) => ({ path })) };
    }
  }
  return { ...toolCall, ...(status ? { status } : {}), data };
}
