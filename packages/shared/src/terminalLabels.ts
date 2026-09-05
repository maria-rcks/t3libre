import type { TerminalSummary } from "@t3tools/contracts";

/** Human-readable label for a terminal tab; matches mobile and web sidebars. */
export function getTerminalLabel(terminalId: string): string {
  const numericSuffix = /^term(?:inal)?-(\d+)$/i.exec(terminalId)?.[1];
  return numericSuffix ? `Terminal ${numericSuffix}` : terminalId;
}

/** Prefer server summary label when present; otherwise fall back to `getTerminalLabel`. */
export function resolveTerminalSessionLabel(
  terminalId: string,
  summary: Pick<TerminalSummary, "label"> | null | undefined,
): string {
  return summary?.label?.trim() || getTerminalLabel(terminalId);
}

/**
 * Allocate the lowest unused `term-N` id, starting at `term-1`.
 * Clients send the id explicitly on `terminal.open` / `terminal.attach`.
 */
export function nextTerminalId(existingTerminalIds: ReadonlyArray<string>): string {
  const usedIds = new Set(existingTerminalIds);
  let nextIndex = 1;
  while (usedIds.has(`term-${nextIndex}`)) {
    nextIndex += 1;
  }

  return `term-${nextIndex}`;
}
