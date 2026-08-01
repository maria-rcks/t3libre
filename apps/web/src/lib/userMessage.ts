export const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

const ULTRATHINK_PREFIX = "Ultrathink:\n";

export function resolveUserMessageDisplayText(text: string, hasAttachments: boolean): string {
  if (!hasAttachments) {
    return text;
  }

  const trimmed = text.trim();
  if (
    trimmed === IMAGE_ONLY_BOOTSTRAP_PROMPT ||
    trimmed === `${ULTRATHINK_PREFIX}${IMAGE_ONLY_BOOTSTRAP_PROMPT}`
  ) {
    return "";
  }

  return text;
}
