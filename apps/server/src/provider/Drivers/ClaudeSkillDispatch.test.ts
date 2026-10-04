import { describe, expect, it } from "vite-plus/test";

import { planClaudeSkillDispatch } from "./ClaudeSkillDispatch.ts";

const SKILLS = new Set([
  "2spec",
  "implement",
  "review",
  "re-release-version",
  "native-proof:dot.alias_Upper",
]);

describe("planClaudeSkillDispatch", () => {
  it("leaves a prompt without a known skill untouched", () => {
    expect(planClaudeSkillDispatch("fix the build", SKILLS)).toBeUndefined();
    // Not a discovered skill, so it stays prose rather than becoming a command.
    expect(planClaudeSkillDispatch("echo $HOME then $unknown", SKILLS)).toBeUndefined();
    expect(planClaudeSkillDispatch("$native-proof:unknown.dot use this", SKILLS)).toBeUndefined();
    expect(
      planClaudeSkillDispatch(
        "$native-proof:space alias_Upper use this",
        new Set(["native-proof:space alias_Upper"]),
      ),
    ).toBeUndefined();
  });

  it("moves a mid-prompt mention into a trailing slash command", () => {
    expect(planClaudeSkillDispatch("ok, now $implement all the tickets", SKILLS)).toEqual({
      leadingText: "ok, now",
      commandText: "/implement all the tickets",
      skillName: "implement",
    });
  });

  it("keeps a mention that opens the prompt as a single command block", () => {
    expect(planClaudeSkillDispatch("$review\nfocus on auth", SKILLS)).toEqual({
      leadingText: undefined,
      commandText: "/review\nfocus on auth",
      skillName: "review",
    });
  });

  it.each(["2spec", "native-proof:dot.alias_Upper"])(
    "dispatches the exact known skill %s with arguments intact",
    (name) => {
      expect(planClaudeSkillDispatch(`use $${name} for this\nand that`, SKILLS)).toEqual({
        leadingText: "use",
        commandText: `/${name} for this\nand that`,
        skillName: name,
      });
    },
  );

  it("dispatches the last mention and rewrites earlier ones inline", () => {
    expect(planClaudeSkillDispatch("$review the diff, then $implement the fixes", SKILLS)).toEqual({
      leadingText: "/review the diff, then",
      commandText: "/implement the fixes",
      skillName: "implement",
    });
    expect(
      planClaudeSkillDispatch(
        "$native-proof:dot.space alias_Upper argument one\nnext",
        new Set(["native-proof:dot.space", "native-proof:dot.space alias_Upper"]),
      ),
    ).toEqual({
      leadingText: undefined,
      commandText: "/native-proof:dot.space alias_Upper argument one\nnext",
      skillName: "native-proof:dot.space",
    });
  });

  it("dispatches currency-prefixed mentions and preserves their source boundaries", () => {
    for (const symbol of ["€", "£", "¥", "₹", "₩", "₿", "𑿝"]) {
      expect(
        planClaudeSkillDispatch(
          `${symbol}review the diff, then ${symbol}implement the fixes`,
          SKILLS,
        ),
      ).toEqual({
        leadingText: "/review the diff, then",
        commandText: "/implement the fixes",
        skillName: "implement",
      });
      expect(planClaudeSkillDispatch(`${symbol}2spec for this`, SKILLS)).toEqual({
        leadingText: undefined,
        commandText: "/2spec for this",
        skillName: "2spec",
      });
      expect(planClaudeSkillDispatch(`5${symbol}review ${symbol}unknown`, SKILLS)).toBeUndefined();
    }
  });

  it("ignores a dollar token glued to other text", () => {
    expect(planClaudeSkillDispatch("cost is 5$implement", SKILLS)).toBeUndefined();
  });

  it("ignores currency amounts and compact monetary expressions", () => {
    const skillsWithCurrency = new Set([...SKILLS, "20", "20k", "100M", "1e6", "20.5k"]);
    for (const symbol of ["$", "€", "£", "¥", "₹", "₩", "₿", "𑿝"]) {
      expect(
        planClaudeSkillDispatch(
          `pay ${symbol}20 ${symbol}20k ${symbol}100M ${symbol}1e6 ${symbol}20.5k tomorrow`,
          skillsWithCurrency,
        ),
      ).toBeUndefined();
    }
  });
});
