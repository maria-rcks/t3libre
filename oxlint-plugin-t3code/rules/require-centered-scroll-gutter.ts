import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { unwrapExpression } from "../utils.ts";

const SCROLLS_VERTICALLY = /(?:^|:)overflow-(?:y-)?auto$/u;
// Either utility keeps the content box the same width whether or not the scrollbar shows.
const RESERVES_GUTTER = /(?:^|:)(?:scrollbar-gutter-(?:stable|both)|\[scrollbar-gutter:[^\]]+\])$/u;
const HIDES_SCROLLBAR = /(?:^|:)\[scrollbar-width:none\]$/u;
const CENTERED_BY_MARGIN = /(?:^|:)mx?-auto$/u;
const COLUMN = /(?:^|:)flex-col$/u;
const CENTERS_COLUMN_ITEMS = /(?:^|:)(?:items-center(?:-safe)?|place-items-center)$/u;
const CENTERS_ROW_ITEMS =
  /(?:^|:)(?:justify-center(?:-safe)?|\[justify-content:safe_center\]|place-items-center|place-content-center)$/u;

/**
 * The class names a className value can produce: string literals, template text, and the
 * branches and arguments of conditionals and cn()-style calls. Conditions themselves are skipped.
 */
function collectClassNames(node: unknown, classNames: Set<string>) {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return;
  const value = expression.value;

  const addAll = (text: string | null) => {
    for (const className of text?.split(/\s+/u) ?? []) {
      if (className) classNames.add(className);
    }
  };

  switch (value.type) {
    case "Literal":
      if (typeof value.value === "string") addAll(value.value);
      return;
    case "TemplateLiteral":
      for (const quasi of value.quasis) addAll(quasi.value.cooked);
      for (const nested of value.expressions) collectClassNames(nested, classNames);
      return;
    case "JSXExpressionContainer":
      collectClassNames(value.expression, classNames);
      return;
    case "ConditionalExpression":
      collectClassNames(value.consequent, classNames);
      collectClassNames(value.alternate, classNames);
      return;
    case "LogicalExpression":
      collectClassNames(value.left, classNames);
      collectClassNames(value.right, classNames);
      return;
    case "ArrayExpression":
      for (const element of value.elements) collectClassNames(element, classNames);
      return;
    case "CallExpression":
      for (const argument of value.arguments) collectClassNames(argument, classNames);
      return;
  }
}

function classNamesOf(element: ESTree.JSXElement): ReadonlySet<string> {
  const classNames = new Set<string>();
  for (const attribute of element.openingElement.attributes) {
    if (
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === "className"
    ) {
      collectClassNames(attribute.value, classNames);
    }
  }
  return classNames;
}

const hasClass = (classNames: ReadonlySet<string>, pattern: RegExp) =>
  [...classNames].some((className) => pattern.test(className));

/**
 * Reports a native vertical scroller that centers its content without reserving the scrollbar
 * lane. A classic scrollbar narrows the scroller when it appears, so centered content jumps by
 * half its width whenever the content grows past the fold.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require scrollbar-gutter-both on overflow-auto scrollers that center their content, so it does not shift when the scrollbar appears.",
    },
  },
  create(context) {
    const reported = new Set<ESTree.JSXElement>();

    const report = (scroller: ESTree.JSXElement, classNames: ReadonlySet<string>) => {
      if (reported.has(scroller)) return;
      if (hasClass(classNames, RESERVES_GUTTER) || hasClass(classNames, HIDES_SCROLLBAR)) return;
      reported.add(scroller);
      context.report({
        node: scroller.openingElement,
        message:
          "This scroller centers its content, which shifts sideways when the scrollbar appears. Add scrollbar-gutter-both.",
      });
    };

    return {
      JSXElement(node) {
        const classNames = classNamesOf(node);
        if (classNames.size === 0) return;

        if (hasClass(classNames, SCROLLS_VERTICALLY)) {
          const centersItems = hasClass(classNames, COLUMN)
            ? hasClass(classNames, CENTERS_COLUMN_ITEMS)
            : hasClass(classNames, CENTERS_ROW_ITEMS);
          if (centersItems) report(node, classNames);
        }

        if (!hasClass(classNames, CENTERED_BY_MARGIN)) return;
        // The nearest enclosing scroller is the one whose scrollbar moves this element.
        for (let ancestor: ESTree.Node | null = node.parent; ancestor; ancestor = ancestor.parent) {
          // An element passed as a prop renders wherever that component puts it.
          if (ancestor.type === "JSXAttribute") return;
          if (ancestor.type !== "JSXElement") continue;
          const ancestorClassNames = classNamesOf(ancestor);
          if (!hasClass(ancestorClassNames, SCROLLS_VERTICALLY)) continue;
          report(ancestor, ancestorClassNames);
          return;
        }
      },
    };
  },
});
