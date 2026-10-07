import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName } from "../utils.ts";

const CLASS_COMPOSERS = new Set(["cn", "clsx", "classNames", "cva", "twMerge"]);
const CLASS_EXPRESSION_TYPES = new Set([
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "SpreadElement",
  "ConditionalExpression",
  "LogicalExpression",
  "BinaryExpression",
  "TemplateLiteral",
  "JSXExpressionContainer",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "ParenthesizedExpression",
]);

const isClassName = (name: string) =>
  /^(?:class|className|classNames)$|(?:Class|ClassNames?|Classes)$|(?:^|_)CLASS(?:_?NAMES?|ES)?$/u.test(
    name,
  );

/** Follow class expressions to their owner, without following variables or unrelated calls. */
function isClassString(node: ESTree.Node): boolean {
  let current = node;
  while (current.parent !== null) {
    const parent = current.parent;
    if (parent.type === "JSXAttribute") {
      return parent.name.type === "JSXIdentifier" && isClassName(parent.name.name);
    }
    if (parent.type === "VariableDeclarator") {
      return parent.id.type === "Identifier" && isClassName(parent.id.name);
    }
    if (parent.type === "ReturnStatement") {
      let owner: ESTree.Node | null = parent.parent;
      while (owner !== null) {
        if (owner.type === "FunctionDeclaration" || owner.type === "FunctionExpression") {
          return owner.id ? isClassName(owner.id.name) : isClassString(owner);
        }
        if (owner.type === "ArrowFunctionExpression") return isClassString(owner);
        owner = owner.parent;
      }
      return false;
    }
    if (parent.type === "ArrowFunctionExpression" && parent.body === current) {
      return isClassString(parent);
    }
    if (parent.type === "Property") {
      const name = getPropertyName(parent.key);
      if (parent.value === current && Option.isSome(name) && isClassName(name.value)) return true;
    }
    if (parent.type === "CallExpression") {
      const name = getPropertyName(
        parent.callee.type === "MemberExpression" ? parent.callee.property : parent.callee,
      );
      return Option.isSome(name) && CLASS_COMPOSERS.has(name.value);
    }
    if (parent.type === "ConditionalExpression" && parent.test === current) return false;
    if (!CLASS_EXPRESSION_TYPES.has(parent.type)) return false;
    current = parent;
  }
  return false;
}

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

/** Recognize widths without treating arbitrary theme colors as lengths. */
function isWidthUtility(utility: string, prefix: "ring" | "outline") {
  if (utility === prefix) return true;
  if (!utility.startsWith(`${prefix}-`)) return false;
  const value = utility.slice(prefix.length + 1);
  if (pixelLength(value) !== undefined) return true;
  return /^[[(](?:length:|(?:\d+(?:\.\d+)?|\.\d+)(?:[a-z]+|%)|(?:calc|min|max|clamp)\()/u.test(
    value,
  );
}

function isRingWidth(utility: string) {
  return isWidthUtility(utility, "ring") && pixelLength(utility.slice("ring-".length)) !== 0;
}

/** Inspect JSX style objects, leaving similarly named application data alone. */
function isInlineStyleProperty(node: Extract<ESTree.Node, { type: "Property" }>) {
  let expression: ESTree.Node = node.parent;
  if (expression.type !== "ObjectExpression") return false;
  while (
    expression.parent?.type === "TSAsExpression" ||
    expression.parent?.type === "TSSatisfiesExpression" ||
    expression.parent?.type === "ParenthesizedExpression"
  ) {
    expression = expression.parent;
  }
  const container = expression.parent;
  return (
    container?.type === "JSXExpressionContainer" &&
    container.parent.type === "JSXAttribute" &&
    container.parent.name.type === "JSXIdentifier" &&
    container.parent.name.name === "style"
  );
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

    if (state && isWidthUtility(utility, "outline")) {
      const width = utility === "outline" ? 1 : pixelLength(utility.slice("outline-".length));
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
        isWidthUtility(candidate.utility, "outline"),
    );
    // Without a width in this literal, the shared focus outline defaults to 2px.
    const width = widths.length
      ? Math.max(
          ...widths.map((candidate) =>
            candidate.utility === "outline"
              ? 1
              : (pixelLength(candidate.utility.slice("outline-".length)) ?? Infinity),
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
        if (typeof node.value !== "string" || !isClassString(node)) return;
        for (const utility of outsetOverrides(node.value)) {
          context.report({ node, message: message(utility) });
        }
      },
      TemplateLiteral(node) {
        if (!isClassString(node)) return;
        const text = node.quasis.map((part) => part.value.cooked ?? part.value.raw).join(" ");
        for (const utility of outsetOverrides(text)) {
          context.report({ node, message: message(utility) });
        }
      },
      Property(node) {
        const name = getPropertyName(node.key);
        if (Option.isNone(name)) return;
        if (name.value === "outlineOffset") {
          if (isInlineStyleProperty(node)) {
            context.report({
              node,
              message:
                "Inline outlineOffset overrides bypass the checked outline width. Use the shared inward default or a checked outline-offset class instead.",
            });
          }
          return;
        }
        if (name.value !== "--tw-ring-inset") return;
        if (node.value.type === "Literal" && node.value.value === "inset") return;
        context.report({ node, message: message("--tw-ring-inset override") });
      },
    };
  },
});
