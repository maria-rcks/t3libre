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

function isClassComposer(node: Extract<ESTree.Node, { type: "CallExpression" }>) {
  const name = getPropertyName(
    node.callee.type === "MemberExpression" ? node.callee.property : node.callee,
  );
  return Option.isSome(name) && CLASS_COMPOSERS.has(name.value);
}

function isClassWrapper(node: ESTree.Node | null) {
  return (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSNonNullExpression" ||
    node?.type === "ParenthesizedExpression"
  );
}

/** Collect only fragments that a composition always includes, leaving conditional variants apart. */
function staticClassText(node: ESTree.Node): string {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return staticClassText(node.left) + staticClassText(node.right);
  }
  if (node.type === "TemplateLiteral") {
    return node.quasis
      .map(
        (part, index) =>
          (part.value.cooked ?? part.value.raw) +
          (node.expressions[index] ? staticClassText(node.expressions[index]) : ""),
      )
      .join("");
  }
  if (node.type === "ArrayExpression") {
    return node.elements.map((element) => (element ? staticClassText(element) : "")).join(" ");
  }
  if (node.type === "CallExpression" && isClassComposer(node)) {
    return node.arguments.map(staticClassText).join(" ");
  }
  if (isClassWrapper(node)) return staticClassText(node.expression);
  return "__t3_dynamic_class__";
}

/** Check joined strings at their outer boundary, so partial tokens are never separate classes. */
function isJoinedClassFragment(node: ESTree.Node) {
  let parent = node.parent;
  while (isClassWrapper(parent)) parent = parent.parent;
  return (
    parent?.type === "TemplateLiteral" ||
    (parent?.type === "BinaryExpression" && parent.operator === "+")
  );
}

function companionClassText(node: ESTree.Node) {
  const fragments: string[] = [];
  let current = node.parent;
  while (current !== null) {
    if (current.type === "CallExpression") {
      if (!isClassComposer(current)) break;
      fragments.push(staticClassText(current));
    } else if (
      current.type === "ArrayExpression" ||
      current.type === "TemplateLiteral" ||
      (current.type === "BinaryExpression" && current.operator === "+")
    ) {
      fragments.push(staticClassText(current));
    } else if (!CLASS_EXPRESSION_TYPES.has(current.type)) {
      break;
    }
    current = current.parent;
  }
  return fragments.join(" ");
}

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
      return isClassComposer(parent);
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
  const variants: string[] = [];
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (character === "[" || character === "(") depth++;
    else if (character === "]" || character === ")") depth--;
    else if (character === ":" && depth === 0) {
      variants.push(token.slice(start, index));
      start = index + 1;
    }
  }
  const variant = token.slice(0, start);
  return {
    variant,
    variants,
    utility: token.slice(start).replace(/^!|!$/gu, ""),
    target: elementTarget(variants),
    state: isStateVariant(variant),
  };
}

function elementTarget(variants: string[]) {
  return variants
    .filter(
      (variant) =>
        (variant.startsWith("[") && !/^\[&(?::[\w-]+|\[[^\]]+\])+\]$/u.test(variant)) ||
        /^(?:before|after|first-letter|first-line|marker|selection|file|placeholder|backdrop|details-content|\*{1,2})$/u.test(
          variant,
        ),
    )
    .join(":");
}

/** Conditions may be added, but an inset must still address the same element or pseudo-element. */
function variantCovers(
  inset: ReturnType<typeof classUtility>,
  target: ReturnType<typeof classUtility>,
) {
  return (
    inset.target === target.target &&
    inset.variants.every((variant) => target.variants.includes(variant))
  );
}

/** Tailwind outline widths and offsets use pixels; arbitrary dynamic lengths are unknown. */
function pixelLength(value: string) {
  const normalized = value.replace(/^\[|\]$/gu, "").replace(/^length:/u, "");
  return /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/u.test(normalized)
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
  return /^[[(](?:length:|percentage:|(?:\d+(?:\.\d+)?|\.\d+)(?:[a-z]+|%)|(?:calc|min|max|clamp|round|mod|rem|abs|hypot)\()/u.test(
    value,
  );
}

function isRingWidth(utility: string) {
  return isWidthUtility(utility, "ring") && pixelLength(utility.slice("ring-".length)) !== 0;
}

function outlineWidth(utility: string) {
  return utility === "outline" ? 1 : pixelLength(utility.slice("outline-".length));
}

function isColorUtility(utility: string, prefix: "ring" | "outline") {
  if (!utility.startsWith(`${prefix}-`) || isWidthUtility(utility, prefix)) return false;
  return prefix === "ring"
    ? !/^ring-(?:inset$|outset$|offset(?:-|$))/u.test(utility)
    : !/^outline-(?:none$|hidden$|solid$|dashed$|dotted$|double$|offset(?:-|$))/u.test(utility);
}

/** Inspect JSX style objects, leaving similarly named application data alone. */
function isInlineStyleProperty(node: Extract<ESTree.Node, { type: "Property" }>) {
  let expression: ESTree.Node = node.parent;
  if (expression.type !== "ObjectExpression") return false;
  while (isClassWrapper(expression.parent) && expression.parent.type !== "TSNonNullExpression") {
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

function outsetOverrides(text: string, companions: string) {
  const ownClasses = text.split(/\s+/u).map(classUtility);
  const classes = [...ownClasses, ...companions.split(/\s+/u).map(classUtility)];
  const hasBaseRing = classes.some(
    (candidate) => candidate.variant === "" && isRingWidth(candidate.utility),
  );
  const insets = classes.filter((candidate) => candidate.utility === "ring-inset");
  const hasInset = (target: ReturnType<typeof classUtility>) =>
    insets.some((inset) => variantCovers(inset, target));
  const baseStateColors = (prefix: "ring" | "outline") =>
    classes.filter(
      (candidate) =>
        candidate.state && candidate.target === "" && isColorUtility(candidate.utility, prefix),
    );
  const baseRingStateColors = baseStateColors("ring");
  const baseOutlineStateColors = baseStateColors("outline");
  const outlineWidths = classes.filter((candidate) => isWidthUtility(candidate.utility, "outline"));
  const baseOutlineWidth = Math.max(
    2,
    ...outlineWidths
      .filter((candidate) => candidate.variant === "")
      .map((candidate) => outlineWidth(candidate.utility) ?? Infinity),
  );
  const hasInwardOutlineOffset = (
    target: ReturnType<typeof classUtility>,
    width: number | undefined,
  ) =>
    classes.some((candidate) => {
      if (!variantCovers(candidate, target)) return false;
      if (!candidate.utility.startsWith("-outline-offset-")) return false;
      const offset = pixelLength(candidate.utility.slice("-outline-offset-".length));
      return width !== undefined && offset !== undefined && offset >= width;
    });
  const hasStateRing = (target: ReturnType<typeof classUtility>) =>
    classes.some(
      (candidate) =>
        candidate.state &&
        candidate.target === target.target &&
        (isRingWidth(candidate.utility) ||
          candidate.utility === "ring-inset" ||
          (hasBaseRing && candidate.target === "" && isColorUtility(candidate.utility, "ring"))),
    );
  const offenders: string[] = [];
  for (const token of ownClasses) {
    const { utility, variant, state, target } = token;
    if (
      (state &&
        (isRingWidth(utility) ||
          (target === "" && hasBaseRing && isColorUtility(utility, "ring"))) &&
        !hasInset(token)) ||
      (variant === "" &&
        isRingWidth(utility) &&
        baseRingStateColors.some((color) => !hasInset(color)))
    ) {
      offenders.push(`${variant}${utility}`);
      continue;
    }
    if (
      (utility === "ring-outset" && (state || hasStateRing(token))) ||
      (utility.startsWith("[--tw-ring-inset:") && utility !== "[--tw-ring-inset:inset]")
    ) {
      offenders.push(utility);
      continue;
    }

    const isOutlineWidth = isWidthUtility(utility, "outline");
    const outline = isOutlineWidth ? outlineWidth(utility) : target === "" ? baseOutlineWidth : 2;
    if (
      (outline === undefined || outline > 2) &&
      ((state &&
        (isOutlineWidth || isColorUtility(utility, "outline")) &&
        !hasInwardOutlineOffset(token, outline)) ||
        (variant === "" &&
          isOutlineWidth &&
          baseOutlineStateColors.some((color) => !hasInwardOutlineOffset(color, outline))))
    ) {
      offenders.push(`${variant}${utility}`);
    }

    // Arbitrary declarations bypass the shared inward offset entirely.
    if (utility.startsWith("[outline-offset:")) {
      offenders.push(utility);
      continue;
    }

    const offset = /^(-?)outline-offset-(.+)$/u.exec(utility);
    if (!offset) continue;
    const amount = pixelLength(offset[2] ?? "");
    const widths = outlineWidths.filter((candidate) => variantCovers(candidate, token));
    // Without a guaranteed width in this composition, the shared focus outline defaults to 2px.
    const width = widths.length
      ? Math.max(...widths.map((candidate) => outlineWidth(candidate.utility) ?? Infinity))
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
      `${utility} can paint a focus or selection indicator outside its element, where an ancestor may clip it. Pair state ring widths with ring-inset under the same variant. For state colors using a base ring width, add ring-inset to that base. Remove outline offset overrides to use the shared inward default, or use a negative offset at least as large as its outline width.`;
    const checkClasses = (node: ESTree.Node) => {
      if (isJoinedClassFragment(node) || !isClassString(node)) return;
      for (const utility of outsetOverrides(staticClassText(node), companionClassText(node))) {
        context.report({ node, message: message(utility) });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") checkClasses(node);
      },
      TemplateLiteral: checkClasses,
      BinaryExpression(node) {
        if (node.operator === "+") checkClasses(node);
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
