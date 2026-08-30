import { useCallback, useMemo } from "react";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

const CHAT_WARNING_DISMISSALS_STORAGE_KEY = "t3code:chat-warning-dismissals:v1";
const CHAT_WARNING_SERVER_RUN_DISMISSALS_STORAGE_KEY =
  "t3code:chat-warning-server-run-dismissals:v1";
const MAX_DISMISSED_SERVER_RUNS = 20;
const EMPTY_DISMISSALS = { keys: [] as string[] };
const EMPTY_SERVER_RUN_DISMISSALS = {
  runs: [] as Array<{ serverRunId: string; keys: string[] }>,
};
const ChatWarningDismissalsSchema = Schema.Struct({
  keys: Schema.Array(Schema.String),
});
const ChatWarningServerRunDismissalsSchema = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      serverRunId: Schema.String,
      keys: Schema.Array(Schema.String),
    }),
  ),
});

export interface ChatWarningServerRunDismissal {
  readonly serverRunId: string;
  readonly keys: ReadonlyArray<string>;
}

export function mergeDismissedChatWarningKeys(
  currentKeys: ReadonlyArray<string>,
  addedKeys: ReadonlyArray<string>,
): string[] {
  return [...new Set([...currentKeys, ...addedKeys.filter((key) => key.length > 0)])];
}

export function mergeServerRunChatWarningDismissals(
  currentRuns: ReadonlyArray<ChatWarningServerRunDismissal>,
  serverRunId: string,
  addedKeys: ReadonlyArray<string>,
): ChatWarningServerRunDismissal[] {
  const currentKeys =
    currentRuns.find((candidate) => candidate.serverRunId === serverRunId)?.keys ?? [];
  const next = {
    serverRunId,
    keys: mergeDismissedChatWarningKeys(currentKeys, addedKeys),
  };
  return [...currentRuns.filter((candidate) => candidate.serverRunId !== serverRunId), next].slice(
    -MAX_DISMISSED_SERVER_RUNS,
  );
}

export function dismissedChatWarningKeysForServerRun(
  runs: ReadonlyArray<ChatWarningServerRunDismissal>,
  serverRunId: string | null,
): ReadonlyArray<string> {
  if (serverRunId === null) return [];
  return runs.find((candidate) => candidate.serverRunId === serverRunId)?.keys ?? [];
}

export function useChatWarningDismissals(serverRunId: string | null) {
  const [dismissals, setDismissals] = useLocalStorage(
    CHAT_WARNING_DISMISSALS_STORAGE_KEY,
    EMPTY_DISMISSALS,
    ChatWarningDismissalsSchema,
  );
  const [serverRunDismissals, setServerRunDismissals] = useLocalStorage(
    CHAT_WARNING_SERVER_RUN_DISMISSALS_STORAGE_KEY,
    EMPTY_SERVER_RUN_DISMISSALS,
    ChatWarningServerRunDismissalsSchema,
  );
  const dismissedWarningKeys = useMemo(() => new Set(dismissals.keys), [dismissals.keys]);
  const dismissedWarningKeysForServerRun = useMemo(
    () => new Set(dismissedChatWarningKeysForServerRun(serverRunDismissals.runs, serverRunId)),
    [serverRunDismissals.runs, serverRunId],
  );
  const dismissWarningKeys = useCallback(
    (keys: ReadonlyArray<string>) => {
      setDismissals((current) => ({
        keys: mergeDismissedChatWarningKeys(current.keys, keys),
      }));
    },
    [setDismissals],
  );
  const dismissWarningKeysForServerRun = useCallback(
    (keys: ReadonlyArray<string>) => {
      if (serverRunId === null) return;
      setServerRunDismissals((current) => ({
        runs: mergeServerRunChatWarningDismissals(current.runs, serverRunId, keys),
      }));
    },
    [serverRunId, setServerRunDismissals],
  );

  return {
    dismissedWarningKeys,
    dismissedWarningKeysForServerRun,
    dismissWarningKeys,
    dismissWarningKeysForServerRun,
  };
}

export function usePermanentlyDismissedChatWarnings() {
  const [dismissals, setDismissals] = useLocalStorage(
    CHAT_WARNING_DISMISSALS_STORAGE_KEY,
    EMPTY_DISMISSALS,
    ChatWarningDismissalsSchema,
  );
  const restoreAllWarnings = useCallback(() => setDismissals(EMPTY_DISMISSALS), [setDismissals]);

  return {
    permanentlyDismissedWarningCount: dismissals.keys.length,
    restoreAllWarnings,
  };
}
