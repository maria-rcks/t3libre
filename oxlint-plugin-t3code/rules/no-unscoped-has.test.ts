/* oxlint-disable t3code/no-unscoped-has -- the fixtures are invalid on purpose */
import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-unscoped-has", {
  filename: "fixture.tsx",
});

describe("t3code/no-unscoped-has", () => {
  rule.valid(
    "allows :has() on the element itself",
    `const className = "[&:has([data-slot=icon])]:ps-2";`,
  );

  rule.valid(
    "allows :has() anchored to an attribute",
    `const className = "[&+[data-chat-composer-form]:has(>[data-slot=banner])]:mt-0";`,
  );

  rule.valid(
    "allows :has() inside :not() on the element itself",
    `const className = "[&:not(:has(+[data-slot=footer]))]:rounded-b-2xl";`,
  );

  rule.valid(
    "allows built-in has-* variants",
    `const className = "has-[>[data-slot=icon]]:ps-2 group-has-[:checked]:opacity-100";`,
  );

  rule.valid(
    "allows a sibling selector without :has()",
    `const className = "[&+*_[data-chat-composer-form]>[data-slot=attachment]]:before:rounded-none";`,
  );

  rule.valid("ignores prose mentioning :has()", `const note = "uses :has( for styling";`);

  rule.valid(
    "ignores :has() inside an arbitrary value",
    `const className = "before:content-[':has(foo)']";`,
  );

  rule.valid(
    "allows a negated :has() on the element itself",
    `const className = "[&:not(.collapsed):not(:has(>[data-slot=icon]))]:ps-2";`,
  );

  rule.valid(
    "allows :has() on a group or peer element",
    `const className = "group-[:has(input)]:p-2 peer-[:has(input)]:p-2 group-[&:has(input)]/row:p-2";`,
  );

  rule.valid(
    "allows a selector list whose own branch is anchored",
    `const className = "[:is(.a,.b):has(x)_&]:p-2 [&:not(.a,:has(x))]:p-2";`,
  );

  rule.valid(
    "ignores :has() text in quoted attribute values",
    `const className = "data-[foo='_:has(x)']:p-2 [&_[data-query='_:has(foo)']]:p-2";`,
  );

  rule.valid(
    "allows a selector without & on the element itself",
    `const className = "[:has(>input)]:p-2 not-[:has(>[data-slot=icon])]:ps-2";`,
  );

  rule.invalid(
    "reports a sibling :has() with nothing anchoring it",
    `const className = "[&+:has([data-chat-composer-form])_[data-chat-composer-form]]:before:rounded-none";`,
    (output) => {
      assert.match(output, /Anchor the :has\(\)/);
    },
  );

  rule.invalid(
    "reports a descendant :has() with nothing anchoring it",
    `const className = cn("p-2", "[&_:has(>input)]:gap-1");`,
  );

  rule.invalid(
    "reports a universal :has() ancestor",
    "const className = `flex [*:has([data-open])_&]:hidden`;",
  );

  rule.invalid(
    "reports :has() whose only anchor is negated",
    `const className = "[*:not(.safe):has([data-open])_&]:hidden";`,
  );

  rule.invalid("reports uppercase :HAS()", `const className = "[*:HAS([data-open])_&]:hidden";`);

  rule.invalid(
    "reports a selector-list branch borrowing another branch's anchor",
    `const className = "[.safe,:has(input)_&]:p-2";`,
  );

  rule.invalid(
    "reports an unanchored branch inside :is()",
    `const className = "[&_:is(.safe,:has(input))]:p-2";`,
  );

  rule.invalid(
    "reports an unanchored :has() inside a named group variant",
    `const className = "group-[&_:has(x)]/row:p-2";`,
  );

  rule.invalid(
    "reports a :has() on an ancestor of a selector without &",
    `const className = "[:has(x)_.foo]:p-2";`,
  );

  rule.invalid(
    "reports a :has() on an ancestor of a group",
    `const className = "group-[:has(x)_.y]:p-2";`,
  );

  rule.invalid("reports an in-* ancestor :has()", `const className = "in-[:has(x)]:p-2";`);

  rule.invalid(
    "reports :has() anchored to the document root",
    `const className = "[body:has([data-dialog-open])_&]:overflow-hidden";`,
  );
});

const indicators = createOxlintRuleHarness("t3code/no-outset-state-indicators", {
  filename: "fixture.tsx",
});

describe("t3code/no-outset-state-indicators", () => {
  indicators.valid(
    "allows inward state rings alongside decorative ring widths",
    `const el = <button className="focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-offset-1 ring-1 ring-border" />;`,
  );

  indicators.valid(
    "allows wider outlines with matching inward offsets",
    `const el = <button className="focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ring" />;`,
  );

  indicators.valid(
    "allows explicit inward paint without suppressing focus",
    `const el = <button className="ring-inset [--tw-ring-inset:inset] focus-visible:outline-2 focus-visible:-outline-offset-2" />;`,
  );

  indicators.valid(
    "allows an offset matching a narrow outline",
    `const el = <button className="focus-visible:outline-1 focus-visible:-outline-offset-1" />;`,
  );

  indicators.valid(
    "allows inward ring inline styles",
    `const el = <button style={{ "--tw-ring-inset": "inset" }} />;`,
  );

  indicators.valid(
    "does not mistake prose or content for utilities",
    `const note = "the focus outline must stay visible"; const el = <span className="before:content-['ring-outset']" />;`,
  );

  indicators.invalid(
    "reports an outward focus ring with a remedy",
    `const el = <button className="focus-visible:ring-2 focus-visible:ring-outset" />;`,
    (output) => {
      assert.match(output, /ancestor may clip it/);
      assert.match(output, /Pair state ring widths with ring-inset under the same variant/);
    },
  );

  indicators.invalid(
    "reports outward selected rings inside arbitrary variants",
    `const el = <button className="[&[aria-selected=true]]:ring-outset!" />;`,
  );

  indicators.invalid(
    "reports an outward ring in template fragments",
    "const className = `flex ${active ? 'bg-accent' : ''} has-[:focus-visible]:ring-outset`;",
  );

  indicators.invalid(
    "reports ring inset resets",
    `const el = <button className="focus-visible:[--tw-ring-inset:initial]" />;`,
  );

  indicators.invalid(
    "reports inline ring inset resets",
    `const el = <button style={{ "--tw-ring-inset": "unset" }} />;`,
  );

  indicators.invalid(
    "reports positive outline offsets",
    `const el = <button className="focus-visible:outline-2 focus-visible:outline-offset-2" />;`,
  );

  indicators.invalid(
    "reports zero offsets that leave the outline outside the element",
    `const el = <button className="data-selected:outline-2 data-selected:outline-offset-0" />;`,
  );

  indicators.invalid(
    "reports negative offsets narrower than the outline",
    `const el = <button className="focus-within:outline-2 focus-within:-outline-offset-1" />;`,
  );

  indicators.invalid(
    "checks the base outline width when the offset has a variant",
    `const el = <button className="outline-3 focus-visible:-outline-offset-2" />;`,
  );

  indicators.invalid(
    "does not let a narrow duplicate width conceal a wider important outline",
    `const el = <button className="focus-visible:outline-1 focus-visible:outline-3! focus-visible:-outline-offset-1" />;`,
  );

  indicators.invalid(
    "reports arbitrary offset declarations that bypass the inward default",
    `const el = <button className="focus-visible:[outline-offset:2px]" />;`,
  );

  indicators.invalid(
    "requires an inset companion for state ring widths",
    `const el = <button className="focus-visible:ring-2 focus-visible:ring-ring" />;`,
  );

  indicators.invalid(
    "does not borrow an inset from another state or the decorative base",
    `const el = <button className="ring-inset focus:ring-inset focus-visible:ring-2" />;`,
  );

  indicators.valid(
    "allows zero-width state rings and ring colors without changing geometry",
    `const el = <button className="focus:ring-0 data-selected:ring-primary data-checked:ring-offset-2" />;`,
  );

  indicators.valid(
    "matches descendant focus and selected checked pressed state variants",
    `const el = <button className="has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset [&[aria-selected=true]]:ring-1 [&[aria-selected=true]]:ring-inset data-checked:ring-2 data-checked:ring-inset data-pressed:ring data-pressed:ring-inset" />;`,
  );

  indicators.invalid(
    "requires the inset on the same pseudo-element variant",
    `const el = <button className="focus-visible:before:ring-2 focus-visible:ring-inset" />;`,
  );

  indicators.invalid(
    "reports arbitrary state ring widths",
    `const el = <button className="focus-visible:ring-[3px]" />;`,
  );

  indicators.valid(
    "allows decorative avatar outlines in template fragments",
    "const className = `rounded-full ${size} ring-2 ring-background ring-outset`;",
  );

  indicators.invalid(
    "requires an explicit inward offset for outlines wider than the shared default",
    `const el = <button className="focus-visible:outline-3 focus-visible:outline-ring" />;`,
  );

  indicators.valid(
    "allows a base offset matching a wider state outline",
    `const el = <button className="-outline-offset-4 focus-visible:outline-4 focus-visible:outline-ring" />;`,
  );

  indicators.invalid(
    "reports decorative important outset overrides that defeat a state inset",
    `const el = <button className="ring-1 ring-outset! focus-visible:ring-2 focus-visible:ring-inset" />;`,
  );

  indicators.invalid(
    "reports an outset override when the state inset uses a base ring width",
    `const el = <button className="ring-1 ring-outset! focus-visible:ring-inset focus-visible:ring-ring" />;`,
  );
});
