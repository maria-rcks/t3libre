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
  describe.each(
    Object.entries({
      "allows inward state rings alongside decorative ring widths": `const el = <button className="focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-offset-1 ring-1 ring-border" />;`,
      "allows wider outlines with matching inward offsets": `const el = <button className="focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ring" />;`,
      "allows explicit inward paint without suppressing focus": `const el = <button className="ring-inset [--tw-ring-inset:inset] focus-visible:outline-2 focus-visible:-outline-offset-2" />;`,
      "allows an offset matching a narrow outline": `const el = <button className="focus-visible:outline-1 focus-visible:-outline-offset-1" />;`,
      "allows inward ring inline styles": `const el = <button style={{ "--tw-ring-inset": "inset" }} />;`,
      "does not mistake prose or content for utilities": `const note = "the focus outline must stay visible"; const el = <span className="before:content-['ring-outset']" />;`,
      "allows an unconditional inset for state ring widths": `const el = <button className="ring-inset focus-visible:ring-2" />;`,
      "allows an unconditional inset for an arbitrary attribute state on the same element": `const el = <button className="ring-inset [&[aria-selected=true]]:ring-2" />;`,
      "allows checked inset geometry with an added dark color condition": `const el = <button className="ring-1 ring-black/5 data-checked:ring-2 data-checked:ring-inset data-checked:ring-primary dark:data-checked:ring-primary" />;`,
      "allows an inset with fewer matching bracketed state conditions": `const value = cn("has-[:focus-visible]:ring-inset", "dark:has-[:focus-visible]:ring-2");`,
      "allows zero-width state rings and ring colors without changing geometry": `const el = <button className="focus:ring-0 data-selected:ring-primary data-checked:ring-offset-2" />;`,
      "matches descendant focus and selected checked pressed state variants": `const el = <button className="has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset [&[aria-selected=true]]:ring-1 [&[aria-selected=true]]:ring-inset data-checked:ring-2 data-checked:ring-inset data-pressed:ring data-pressed:ring-inset" />;`,
      "allows decorative avatar outlines in template fragments":
        "const className = `rounded-full ${size} ring-2 ring-background ring-outset`;",
      "allows a base offset matching a wider state outline": `const el = <button className="-outline-offset-4 focus-visible:outline-4 focus-visible:outline-ring" />;`,
      "allows a parent decorative outset ring alongside a safe descendant state ring": `const el = <div className="ring-1 ring-border ring-outset [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-inset" />;`,
      "allows typed variable and font-relative ring widths when inset": `const el = <button className="focus-visible:ring-(length:--focus-width) focus-visible:ring-inset data-selected:ring-[2ch] data-selected:ring-inset" />;`,
      "preserves arbitrary ring and outline colors": `const el = <button className="focus-visible:ring-(color:--focus-color) focus-visible:ring-[color:var(--focus-color)] focus-visible:outline-(color:--focus-color) focus-visible:outline-[color:var(--focus-color)]" />;`,
      "ignores outlineOffset in unrelated data objects": `const defaults = { outlineOffset: 2 }; const options = <Editor options={{ outlineOffset: 2 }} />;`,
      "matches ring widths and inset companions across template layout expressions":
        "const className = `focus-visible:ring-2 ${layout} focus-visible:ring-inset`;",
      "matches outline widths and inward offsets across template layout expressions":
        "const className = `focus-visible:outline-3 ${layout} focus-visible:-outline-offset-3`;",
      "matches guaranteed companions across string concatenation": `const el = <button className={"focus-visible:ring-2 " + "ring-inset"} />;`,
      "matches guaranteed companions across literal template interpolations":
        "const className = `${'focus-visible:ring-2 '}ring-inset`;",
      "evaluates inset tokens split across literal concatenation": `const className = "focus-visible:ring-2 ring-in" + "set";`,
      "preserves complete tokens around unknown concatenated layout fragments": `const className = "focus-visible:ring-2 " + layout + " ring-inset";`,
      "does not check partial tokens inside nested literal concatenation": `const className = ("focus-visible:ring-" + "2") + "-unknown";`,
      "matches guaranteed ring companions across composition arguments": `const value = cn("focus-visible:ring-2", "focus-visible:ring-inset");`,
      "allows base ring geometry with a guaranteed base inset": `const value = cn("ring-1 ring-inset", "focus:ring-ring");`,
      "allows base ring geometry with an inset under its color state": `const el = <button className="ring-1 focus:ring-ring focus:ring-inset" />;`,
      "allows pseudo-element base rings with a guaranteed inset": `const value = cn("before:ring-1 before:ring-inset", "focus-visible:before:ring-ring");`,
      "preserves decorative base rings without a focus or selection state": `const el = <button className="ring-1 ring-border hover:ring-primary" />;`,
      "does not reuse a parent decorative ring for a descendant focus color": `const el = <div className="ring-1 ring-border [&_button]:focus-visible:ring-ring" />;`,
      "does not reuse a parent decorative outline for a descendant focus color": `const el = <div className="outline-3 [&_button]:focus-visible:outline-ring" />;`,
      "allows a weaker outline offset condition on the same pseudo-element": `const el = <button className="focus-visible:before:-outline-offset-3 dark:focus-visible:before:outline-3" />;`,
      "does not reuse a parent outline width for a descendant offset": `const el = <div className="outline-4 [&_button]:focus-visible:-outline-offset-2" />;`,
      "allows the bare base outline using the shared inward default": `const el = <button className="outline focus:outline-ring" />;`,
      "allows a wider base outline with its matching inward offset": `const value = cn("outline-3", "focus:outline-ring focus:-outline-offset-3");`,
      "allows pseudo-element base outlines with matching inward offsets": `const value = cn("before:outline-3", "focus-visible:before:outline-ring focus-visible:before:-outline-offset-3");`,
      "allows state outline colors using the shared inward default": `const el = <button className="outline-2 focus:outline-ring" />;`,
      "matches guaranteed companions across nested arrays and composition calls": `const value = twMerge(clsx(["focus-visible:ring-2", ["rounded"]]), "focus-visible:ring-inset");`,
      "matches a conditional width with an unconditional inset companion": `const value = cn(active && "focus-visible:ring-2", "focus-visible:ring-inset");`,
      "matches guaranteed outline geometry across composition arguments": `const value = classNames("focus-visible:outline-3", "focus-visible:-outline-offset-3");`,
      "recognizes fractional and typed pixel outline widths": `const el = <button className="focus-visible:outline-[.5px] focus-visible:-outline-offset-[.5px] data-selected:outline-[length:3px] data-selected:-outline-offset-3" />;`,
      "preserves untyped variable and functional colors": `const el = <button className="focus-visible:ring-[var(--focus-color)] focus-visible:outline-[oklch(0.7_0.2_200)] focus-visible:ring-[color-mix(in_oklab,red,blue)]" />;`,
      "ignores utility names in prose": `const message = "Avoid outline-offset-2 on focus indicators";`,
      "ignores utility names in titles and accessible labels": `const el = <button title="outline-offset-2" aria-label="focus-visible:ring-2" />;`,
      "ignores utility names in test expectations and descriptions": `it("focus-visible:ring-2", () => { expect(message).toBe("outline-offset-2"); });`,
      "ignores utility names in prose templates":
        "const message = `Avoid outline-offset-2 for ${control}`;",
      "ignores local prose inside named class helpers": `function rowToneClass() { const message = "Avoid outline-offset-2"; return "rounded"; }`,
    }),
  )("valid: %s", (name, source) => {
    indicators.valid(name, source);
  });

  describe.each(
    Object.entries({
      "reports outward selected rings inside arbitrary variants": `const el = <button className="[&[aria-selected=true]]:ring-outset!" />;`,
      "reports an outward ring in template fragments":
        "const className = `flex ${active ? 'bg-accent' : ''} has-[:focus-visible]:ring-outset`;",
      "reports ring inset resets": `const el = <button className="focus-visible:[--tw-ring-inset:initial]" />;`,
      "reports inline ring inset resets": `const el = <button style={{ "--tw-ring-inset": "unset" }} />;`,
      "reports positive outline offsets": `const el = <button className="focus-visible:outline-2 focus-visible:outline-offset-2" />;`,
      "reports zero offsets that leave the outline outside the element": `const el = <button className="data-selected:outline-2 data-selected:outline-offset-0" />;`,
      "reports negative offsets narrower than the outline": `const el = <button className="focus-within:outline-2 focus-within:-outline-offset-1" />;`,
      "checks the base outline width when the offset has a variant": `const el = <button className="outline-3 focus-visible:-outline-offset-2" />;`,
      "does not let a narrow duplicate width conceal a wider important outline": `const el = <button className="focus-visible:outline-1 focus-visible:outline-3! focus-visible:-outline-offset-1" />;`,
      "reports arbitrary offset declarations that bypass the inward default": `const el = <button className="focus-visible:[outline-offset:2px]" />;`,
      "requires an inset companion for state ring widths": `const el = <button className="focus-visible:ring-2 focus-visible:ring-ring" />;`,
      "does not borrow an inset from another state": `const el = <button className="focus:ring-inset focus-visible:ring-2" />;`,
      "does not borrow an unconditional inset for a descendant target": `const el = <button className="ring-inset [&_button]:focus-visible:ring-2" />;`,
      "does not borrow an inset that only applies in dark mode": `const el = <button className="ring-1 data-checked:ring-primary dark:data-checked:ring-inset" />;`,
      "does not borrow a conditional covering inset": `const value = cn("dark:data-checked:ring-2", active && "data-checked:ring-inset");`,
      "preserves explicit outset diagnostics alongside covering insets": `const el = <button className="data-checked:ring-inset dark:data-checked:ring-2 dark:data-checked:ring-outset" />;`,
      "does not borrow an inset from another arbitrary descendant target": `const el = <button className="[&_span]:focus-visible:ring-inset dark:[&_button]:focus-visible:ring-2" />;`,
      "requires the inset on the same pseudo-element variant": `const el = <button className="focus-visible:before:ring-2 focus-visible:ring-inset" />;`,
      "reports arbitrary state ring widths": `const el = <button className="focus-visible:ring-[3px]" />;`,
      "requires an explicit inward offset for outlines wider than the shared default": `const el = <button className="focus-visible:outline-3 focus-visible:outline-ring" />;`,
      "reports decorative important outset overrides that defeat a state inset": `const el = <button className="ring-1 ring-outset! focus-visible:ring-2 focus-visible:ring-inset" />;`,
      "reports pseudo-element outset overrides that defeat a state inset": `const el = <button className="before:ring-outset! focus-visible:before:ring-2 focus-visible:before:ring-inset" />;`,
      "reports pseudo-element outset overrides under another condition": `const el = <button className="dark:before:ring-outset! focus-visible:before:ring-2 focus-visible:before:ring-inset" />;`,
      "reports an outset override when the state inset uses a base ring width": `const el = <button className="ring-1 ring-outset! focus-visible:ring-inset focus-visible:ring-ring" />;`,
      "requires an inset companion for explicitly typed variable ring widths": `const el = <button className="focus-visible:ring-(length:--focus-width)" />;`,
      "requires an inset companion for font-relative arbitrary ring widths": `const el = <button className="focus-visible:ring-[2ch]" />;`,
      "rejects dynamic outline widths that the default offset cannot cover": `const el = <button className="focus-visible:outline-(length:--focus-width) focus-visible:-outline-offset-2" />;`,
      "rejects font-relative outline widths that the default offset cannot cover": `const el = <button className="focus-visible:outline-[2ch]" />;`,
      "reports inline offsets that override inward classes": `const el = <button className="focus-visible:outline-2 focus-visible:-outline-offset-2" style={{ outlineOffset: 2 }} />;`,
      "reports inline negative offsets smaller than the default outline width": `const el = <button style={{ outlineOffset: -1 }} />;`,
      "reports unknown inline offsets": `const el = <button style={{ outlineOffset: offset }} />;`,
      "rejects inline offsets that can override a wider outline": `const el = <button className="focus-visible:outline-3 focus-visible:-outline-offset-3" style={{ outlineOffset: -2 }} />;`,
      "checks ring widths split across literal concatenation": `const className = "focus-visible:ring-" + "2";`,
      "checks ring widths split across literal template interpolation":
        "const className = `focus-visible:ring-${'2'}`;",
      "does not treat an unknown interpolation inside an inset token as a companion":
        "const className = `focus-visible:ring-2 ring-in${value}set`;",
      "does not treat an unknown interpolation after an inset token as a companion":
        "const className = `focus-visible:ring-2 ring-inset${value}`;",
      "does not treat an unknown concatenated suffix as a guaranteed inset boundary": `const className = "focus-visible:ring-2 " + "ring-inset" + value;`,
      "does not borrow a conditional concatenated inset companion": `const className = "focus-visible:ring-2 " + (active ? "ring-inset" : "");`,
      "does not borrow a conditional interpolated inset companion":
        "const className = `focus-visible:ring-2 ${active && 'ring-inset'}`;",
      "checks a base ring width used by a focus color": `const el = <button className="ring-1 ring-ring/50 focus:ring-ring" />;`,
      "checks a base ring width used by a selected color across composer arguments": `const value = cn("ring-1", "data-selected:ring-primary");`,
      "checks a pseudo-element base ring width used by a focus color": `const el = <button className="before:ring-1 focus-visible:before:ring-ring" />;`,
      "checks a conditional pseudo-element base ring width used by a focus color": `const value = cn(active && "before:ring-1", "focus-visible:before:ring-ring");`,
      "reports an outset override when a pseudo-element state color uses a base ring": `const el = <button className="before:ring-1 before:ring-outset! focus-visible:before:ring-ring focus-visible:before:ring-inset" />;`,
      "does not borrow a conditional base inset for a state ring color": `const value = cn("ring-1 focus:ring-ring", active && "ring-inset");`,
      "checks a conditional base ring width with a guaranteed state color": `const value = cn(active && "ring-1", "focus:ring-ring");`,
      "does not borrow a parent outline offset for a pseudo-element": `const el = <button className="-outline-offset-3 focus-visible:before:outline-3" />;`,
      "does not borrow a parent outline offset for a descendant": `const el = <div className="-outline-offset-3 [&_button]:focus-visible:outline-3" />;`,
      "checks a wider base outline used by a focus color": `const el = <button className="outline-3 focus:outline-ring" />;`,
      "checks a pseudo-element base outline width used by a focus color": `const el = <button className="before:outline-3 focus-visible:before:outline-ring" />;`,
      "checks a conditional pseudo-element base outline width used by a focus color": `const value = cn(active && "before:outline-3", "focus-visible:before:outline-ring");`,
      "rejects unknown base outline widths used by a focus color": `const el = <button className="outline-(length:--focus-width) focus:outline-ring" />;`,
      "rejects conditional unknown base outline widths used by a focus color": `const value = cn(active && "outline-(length:--focus-width)", "focus:outline-ring");`,
      "checks a conditional wider base outline with a guaranteed state color": `const value = cn(active && "outline-3", "focus:outline-ring");`,
      "does not borrow a conditional inset companion": `const value = cn("focus-visible:ring-2", active && "focus-visible:ring-inset");`,
      "does not borrow an inset companion from another conditional branch": `const value = cn(active ? "focus-visible:ring-2" : "focus-visible:ring-inset");`,
      "does not borrow an inset companion from a conditional class map": `const value = cn("focus-visible:ring-2", { "focus-visible:ring-inset": active });`,
      "does not combine separate cva variants": `const value = cva("rounded", { variants: { tone: { active: "focus-visible:ring-2", inactive: "focus-visible:ring-inset" } } });`,
      "does not borrow a conditional inward outline offset": `const value = cn("focus-visible:outline-3", active && "focus-visible:-outline-offset-3");`,
      "checks wider outline geometry across composition arguments": `const value = cn("focus-visible:outline-4", "focus-visible:-outline-offset-2");`,
      "checks an outset override across composition arguments": `const value = cn("ring-outset!", "focus-visible:ring-2 focus-visible:ring-inset");`,
      "rejects percentage outline widths that the default offset cannot cover": `const el = <button className="focus-visible:outline-[10%]" />;`,
      "rejects math outline widths that the default offset cannot cover": `const el = <button className="focus-visible:outline-[calc(2px+1em)]" />;`,
      "rejects stepped math outline widths that the default offset cannot cover": `const el = <button className="data-selected:outline-[round(up,3px,2px)]" />;`,
      "checks nested arrays in class composition calls": `const value = cn([active && "focus-visible:ring-2"]);`,
      "checks nested variant options in cva calls": `const recipe = cva("rounded", { variants: { tone: { selected: "data-selected:ring-2" } } });`,
      "checks conditional class props": `const el = <button className={active ? "focus-visible:ring-2" : "rounded"} />;`,
      "checks class maps and alternate class attributes": `const el = <Widget classNames={{ trigger: "focus-visible:ring-2" }} />;`,
      "checks uppercase class constants": `const BUTTON_CLASS_NAME = "focus-visible:ring-2";`,
      "checks camelcase class properties": `const options = { buttonClass: "focus-visible:ring-2" };`,
      "checks named class maps": `const defaultClassNames = { trigger: "focus-visible:ring-2" };`,
      "checks strings returned by named class helpers": `function rowToneClass(active) { if (active) return "focus-visible:ring-2"; return "rounded"; }`,
    }),
  )("invalid: %s", (name, source) => {
    indicators.invalid(name, source);
  });

  indicators.invalid(
    "reports an outward focus ring with a remedy",
    `const el = <button className="focus-visible:ring-2 focus-visible:ring-outset" />;`,
    (output) => {
      assert.match(output, /ancestor may clip it/);
      assert.match(output, /Pair state ring widths with ring-inset under the same variant/);
    },
  );
});
