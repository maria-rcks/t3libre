import { sha256 } from "@noble/hashes/sha2";

/** Resolves a chat's isolated directory consistently on every client and server. */
export function chatThreadWorkspacePath(chatRoot: string, threadId: string): string {
  const separator = chatRoot.includes("\\") ? "\\" : "/";
  // Preserve UUIDs and safe names. Other ids need bounded, case-sensitive names;
  // JSON encoding keeps lone surrogates distinct before TextEncoder replaces them.
  const safe =
    /^[a-z0-9_-]{1,200}$/.test(threadId) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(threadId);
  const directory = safe
    ? threadId
    : "~" +
      Array.from(sha256(new TextEncoder().encode(JSON.stringify(threadId))), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
  return `${chatRoot.replace(/[\\/]+$/, "")}${separator}${directory}`;
}
