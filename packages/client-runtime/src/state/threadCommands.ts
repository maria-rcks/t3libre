import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";
import { WS_METHODS } from "@t3tools/contracts";

import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
} from "./runtime.ts";
import {
  archiveThread,
  createThread,
  deleteThread,
  interruptThreadTurn,
  respondToThreadApproval,
  respondToThreadUserInput,
  revertThreadCheckpoint,
  setThreadInteractionMode,
  setThreadRuntimeMode,
  pinThread,
  reorderPinnedThread,
  settleThread,
  snoozeThread,
  startThreadTurn,
  stopThreadSession,
  unarchiveThread,
  unpinThread,
  unsettleThread,
  unsnoozeThread,
  updateThreadMetadata,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export type {
  ArchiveThreadInput,
  CreateThreadInput,
  DeleteThreadInput,
  InterruptThreadTurnInput,
  RespondToThreadApprovalInput,
  RespondToThreadUserInputInput,
  RevertThreadCheckpointInput,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  PinThreadInput,
  ReorderPinnedThreadInput,
  SettleThreadInput,
  SnoozeThreadInput,
  StartThreadTurnInput,
  StopThreadSessionInput,
  UnarchiveThreadInput,
  UnpinThreadInput,
  UnsettleThreadInput,
  UnsnoozeThreadInput,
  UpdateThreadMetadataInput,
} from "../operations/commands.ts";

export function createThreadEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };
  const command = <Input extends { readonly threadId: string }>(
    label: string,
    execute: (input: Input) => ReturnType<typeof createThread>,
  ) =>
    createEnvironmentCommand(runtime, {
      label: `environment-data:commands:thread:${label}`,
      execute,
      scheduler,
      concurrency,
    });
  return {
    create: command("create", createThread),
    delete: command("delete", deleteThread),
    archive: command("archive", archiveThread),
    unarchive: command("unarchive", unarchiveThread),
    settle: command("settle", settleThread),
    unsettle: command("unsettle", unsettleThread),
    snooze: command("snooze", snoozeThread),
    unsnooze: command("unsnooze", unsnoozeThread),
    pin: command("pin", pinThread),
    unpin: command("unpin", unpinThread),
    reorderPin: command("reorder-pin", reorderPinnedThread),
    updateMetadata: command("update-metadata", updateThreadMetadata),
    setRuntimeMode: command("set-runtime-mode", setThreadRuntimeMode),
    setInteractionMode: command("set-interaction-mode", setThreadInteractionMode),
    startTurn: command("start-turn", startThreadTurn),
    interruptTurn: command("interrupt-turn", interruptThreadTurn),
    respondToApproval: command("respond-to-approval", respondToThreadApproval),
    respondToUserInput: command("respond-to-user-input", respondToThreadUserInput),
    revertCheckpoint: command("revert-checkpoint", revertThreadCheckpoint),
    stopSession: command("stop-session", stopThreadSession),
    uploadFeedback: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:thread:upload-feedback",
      tag: WS_METHODS.providerUploadFeedback,
      scheduler,
      concurrency,
    }),
  };
}
