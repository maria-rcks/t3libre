/** A localized plain-text edit, with the caret expressed in the resulting prompt. */
export interface ComposerMarkdownEdit {
  start: number;
  end: number;
  text: string;
  cursor: number;
}

export function getComposerMarkdownNewline(
  value: string,
  cursor: number,
): ComposerMarkdownEdit | null {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > value.length ||
    (cursor < value.length && value[cursor] !== "\n")
  ) {
    return null;
  }

  const lineStart = cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
  const line = value.slice(lineStart, cursor);
  const insert = (text: string, caretOffset = text.length): ComposerMarkdownEdit => ({
    start: cursor,
    end: cursor,
    text,
    cursor: cursor + caretOffset,
  });
  let openFence: string | null = null;
  for (const previousLine of value.slice(0, lineStart).split("\n")) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(previousLine);
    if (!fence) continue;
    const marker = fence[1]!;
    const suffix = fence[2]!;
    if (openFence) {
      if (marker[0] === openFence[0] && marker.length >= openFence.length && suffix.trim() === "") {
        openFence = null;
      }
    } else if (marker[0] !== "`" || !suffix.includes("`")) {
      openFence = marker;
    }
  }

  const fence = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
  if (openFence) {
    if (
      fence &&
      fence[2]![0] === openFence[0] &&
      fence[2]!.length >= openFence.length &&
      fence[3]!.trim() === ""
    ) {
      return null;
    }
    const indent = /^[ \t]*/.exec(line)![0];
    return indent ? insert(`\n${indent}`) : null;
  }

  if (fence && (fence[2]![0] !== "`" || !fence[3]!.includes("`"))) {
    const indent = fence[1]!;
    const marker = fence[2]!;
    const hasClosingFence = value
      .slice(cursor)
      .split("\n")
      .some((followingLine) => {
        const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(followingLine);
        return closing && closing[1]![0] === marker[0] && closing[1]!.length >= marker.length;
      });
    const newline = `\n${indent}`;
    return insert(hasClosingFence ? newline : `${newline}\n${indent}${marker}`, newline.length);
  }

  const list = /^([ \t]*)(?:(\d{1,9})([.)])|([-+*]))([ \t]+|$)(.*)$/.exec(line);
  if (list) {
    const indent = list[1]!;
    const content = list[6]!;
    const task = /^\[[ xX]\](?:[ \t]+|$)(.*)$/.exec(content);
    // A bare "1." is useful as a starting shorthand; an empty continued "2. " exits.
    const bareNumber = list[2] !== undefined && list[5] === "";
    if (!bareNumber && (task ? task[1]! : content).trim() === "") {
      return { start: lineStart, end: cursor, text: indent, cursor: lineStart + indent.length };
    }
    const marker = list[2] !== undefined ? `${Number(list[2]) + 1}${list[3]}` : list[4]!;
    return insert(`\n${indent}${marker} ${task ? "[ ] " : ""}`);
  }

  const quote = /^([ \t]*)((?:>[ \t]*)+)(.*)$/.exec(line);
  if (quote) {
    const indent = quote[1]!;
    if (quote[3]!.trim() === "") {
      return { start: lineStart, end: cursor, text: indent, cursor: lineStart + indent.length };
    }
    return insert(`\n${indent}${quote[2]!.trimEnd()} `);
  }

  return null;
}
