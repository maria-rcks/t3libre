import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

const STORAGE_KEY = "t3code:chat-warning-dismissals:v2";
const DismissedWarnings = Schema.Array(Schema.String);
const EMPTY_DISMISSALS: ReadonlyArray<string> = [];

export function useDismissedChatWarnings() {
  return useLocalStorage(STORAGE_KEY, EMPTY_DISMISSALS, DismissedWarnings);
}
