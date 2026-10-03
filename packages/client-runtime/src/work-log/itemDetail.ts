import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

const MAX_TEXT_BLOCK_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wire projection replaces a large dynamic input with `{ summary, truncated: true }`. */
function isSummarizedValue(value: unknown): boolean {
  return isRecord(value) && value.truncated === true && typeof value.summary === "string";
}

function textFromBlocks(value: unknown, depth: number): string | null {
  if (depth > MAX_TEXT_BLOCK_DEPTH) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((block) => textFromBlocks(block, depth + 1));
    return parts.every((part) => part !== null) ? parts.join("\n") : null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "text" && typeof value.text === "string") return value.text;
  if (value.type === "image") return "[image]";
  if (value.type === "resource_link" && typeof value.uri === "string") return value.uri;
  if (value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return resource.uri;
  }
  const keys = Object.keys(value).filter((key) => key !== "isError" && key !== "is_error");
  // MCP results and provider tool results wrap their text in `content`.
  if (keys.length === 1 && keys[0] === "content") return textFromBlocks(value.content, depth + 1);
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * MCP tools often return JSON as minified text, sometimes once per content
 * block with identical copies. Indent each document and drop the repeats.
 */
function prettyJsonText(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  const whole = parseJson(trimmed);
  if (whole !== undefined) return JSON.stringify(whole, null, 2);
  const lines = trimmed.split("\n").filter((line) => line.trim());
  const documents = lines.map((line) => parseJson(line.trim()));
  if (documents.some((document) => document === undefined)) return text;
  return [...new Set(documents.map((document) => JSON.stringify(document, null, 2)))].join("\n\n");
}

/** Formats a tool input or output for display: text blocks as text, the rest as JSON. */
export function formatToolValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = textFromBlocks(value, 0);
  if (text !== null) return text.trim() ? prettyJsonText(text) : null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
  if (json === undefined || json === "{}" || json === "[]") return null;
  return json;
}

/** True when the timeline item withholds content that `getTurnItem` returns. */
export function turnItemNeedsDetailFetch(item: OrchestrationV2TurnItem): boolean {
  switch (item.type) {
    case "command_execution":
      return item.outputOmitted === true;
    case "dynamic_tool":
      return item.outputOmitted === true || isSummarizedValue(item.input);
    default:
      return false;
  }
}

/** The tool output carried by a fetched item, formatted for display. */
export function turnItemOutputText(item: OrchestrationV2TurnItem): string | null {
  switch (item.type) {
    case "command_execution":
      return item.output?.trim() ? item.output : null;
    case "dynamic_tool":
      return item.outputOmitted === true ? null : formatToolValue(item.output);
    default:
      return null;
  }
}

/**
 * Whether expanding the item shows anything. Rows without content must not
 * offer a disclosure, otherwise they open to an empty panel.
 */
export function turnItemHasDetail(item: OrchestrationV2TurnItem): boolean {
  switch (item.type) {
    case "reasoning":
      return item.text.trim().length > 0;
    case "command_execution":
      return (
        item.input.trim().length > 0 ||
        item.outputOmitted === true ||
        Boolean(item.output?.trim()) ||
        item.exitCode !== undefined
      );
    case "file_change":
    case "checkpoint":
    case "fork":
    case "handoff":
      return true;
    case "file_search":
      return (item.results?.length ?? 0) > 0 || Boolean(item.pattern?.trim());
    case "web_search":
      return (item.results?.length ?? 0) > 0 || (item.patterns?.length ?? 0) > 0;
    case "dynamic_tool":
      return item.outputOmitted === true || formatToolValue(item.input) !== null;
    case "approval_request":
      return Boolean(item.prompt?.trim());
    case "user_input_request":
      return item.questions.length > 0;
    case "notification":
      return Boolean(item.detail?.trim());
    case "system_notice":
      return item.message.trim().length > 0;
    case "error":
      return item.failure.message.trim().length > 0;
    case "proposed_plan":
      return item.markdown.trim().length > 0;
    case "todo_list":
      return item.steps.length > 0;
    case "subagent":
      return item.childThreadId !== null;
    default:
      return false;
  }
}
