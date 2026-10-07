import { defineRule } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName } from "../utils.ts";

/** Split variants without treating a colon inside an arbitrary selector as a separator. */
function classUtility(token: string) {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (character === "[" || character === "(") depth++;
    else if (character === "]" || character === ")") depth--;
    else if (character === ":" && depth === 0) start = index + 1;
  }
  return {
    variant: token.slice(0, start),
    utility: token.slice(start).replace(/^!|!$/gu, ""),
  };
}

/** Tailwind outline widths and offsets use pixels; arbitrary dynamic lengths are unknown. */
function pixelLength(value: string) {
  const normalized = value.replace(/^\[|\]$/gu, "");
  return /^\d+(?:\.\d+)?(?:px)?$/u.test(normalized)
    ? Number(normalized.replace(/px$/u, ""))
    : undefined;
}

/** State variants include has/group/peer selectors and arbitrary attribute selectors. */
function isStateVariant(variant: string) {
  return /(?:^|[^\w])(?:focus(?:-visible|-within)?|selected|checked|pressed)(?=$|[^\w])/u.test(
    variant,
  );
}

function isRingWidth(utility: string) {
  if (utility === "ring") return true;
  const width = /^ring-(.+)$/u.exec(utility)?.[1];
  if (width === undefined) return false;
  const pixels = pixelLength(width);
  if (pixels !== undefined) return pixels > 0;
  return /^\[(?:length:|\d+(?:\.\d+)?(?:rem|em|vw|vh|%)|calc\()/u.test(width);
}

function outsetOverrides(text: string) {
  const classes = text.split(/\s+/u).map(classUtility);
  const hasStateRing = classes.some(
    (candidate) =>
      isStateVariant(candidate.variant) &&
      (isRingWidth(candidate.utility) || candidate.utility === "ring-inset"),
  );
  const offenders: string[] = [];
  for (const { utility, variant } of classes) {
    const state = isStateVariant(variant);
    if (
      state &&
      isRingWidth(utility) &&
      !classes.some(
        (candidate) => candidate.variant === variant && candidate.utility === "ring-inset",
      )
    ) {
      offenders.push(`${variant}${utility}`);
      continue;
    }
    if (
      ((state || hasStateRing) && utility === "ring-outset") ||
      (utility.startsWith("[--tw-ring-inset:") && utility !== "[--tw-ring-inset:inset]")
    ) {
      offenders.push(utility);
      continue;
    }

    if (state && /^outline-(?:\d|\[)/u.test(utility)) {
      const width = pixelLength(utility.slice("outline-".length));
      if (
        (width === undefined || width > 2) &&
        !classes.some((candidate) => {
          if (candidate.variant !== variant && candidate.variant !== "") return false;
          if (!candidate.utility.startsWith("-outline-offset-")) return false;
          const offset = pixelLength(candidate.utility.slice("-outline-offset-".length));
          return width !== undefined && offset !== undefined && offset >= width;
        })
      ) {
        offenders.push(`${variant}${utility}`);
      }
    }

    // Arbitrary declarations bypass the shared inward offset entirely.
    if (utility.startsWith("[outline-offset:")) {
      offenders.push(utility);
      continue;
    }

    const offset = /^(-?)outline-offset-(.+)$/u.exec(utility);
    if (!offset) continue;
    const amount = pixelLength(offset[2] ?? "");
    const widths = classes.filter(
      (candidate) =>
        (candidate.variant === variant || candidate.variant === "") &&
        /^outline-(?:\d|\[)/u.test(candidate.utility),
    );
    // Without a width in this literal, the shared focus outline defaults to 2px.
    const width = widths.length
      ? Math.max(
          ...widths.map(
            (candidate) => pixelLength(candidate.utility.slice("outline-".length)) ?? Infinity,
          ),
        )
      : 2;
    if (offset[1] !== "-" || amount === undefined || amount < width) {
      offenders.push(utility);
    }
  }
  return offenders;
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep focus and selection indicators inside their element by preventing outward paint overrides.",
    },
  },
  create(context) {
    const message = (utility: string) =>
      `${utility} can paint a focus or selection indicator outside its element, where an ancestor may clip it. Pair state ring widths with ring-inset under the same variant. Remove outline offset overrides to use the shared inward default, or use a negative offset at least as large as its outline width.`;
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        for (const utility of outsetOverrides(node.value)) {
          context.report({ node, message: message(utility) });
        }
      },
      TemplateElement(node) {
        for (const utility of outsetOverrides(node.value.cooked ?? node.value.raw)) {
          context.report({ node, message: message(utility) });
        }
      },
      Property(node) {
        const name = getPropertyName(node.key);
        if (Option.isNone(name) || name.value !== "--tw-ring-inset") return;
        if (node.value.type === "Literal" && node.value.value === "inset") return;
        context.report({ node, message: message("--tw-ring-inset override") });
      },
    };
  },
});
