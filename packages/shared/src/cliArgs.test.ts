import { describe, expect, it } from "vite-plus/test";

import { parseCliArgs, tokenizeCliArgs } from "./cliArgs.ts";

describe("tokenizeCliArgs", () => {
  it("preserves quoted values and escaped spaces", () => {
    expect(
      tokenizeCliArgs(
        String.raw`--config model="gpt 5" --enable foo\ bar --config=profile='work profile'`,
      ),
    ).toEqual(["--config", "model=gpt 5", "--enable", "foo bar", "--config=profile=work profile"]);
  });

  it("preserves literal backslashes in path values", () => {
    expect(
      tokenizeCliArgs(String.raw`--config cacheDir=C:\Users\me --config "quoted=C:\Users\me"`),
    ).toEqual([
      "--config",
      String.raw`cacheDir=C:\Users\me`,
      "--config",
      String.raw`quoted=C:\Users\me`,
    ]);
  });
});

describe("parseCliArgs", () => {
  it.each([{ input: "" }, { input: "   " }, { input: [] }, { input: "--" }])(
    "returns an empty result for $input",
    ({ input }) => {
      expect(parseCliArgs(input)).toEqual({ flags: {}, positionals: [] });
    },
  );

  it.each([
    ["--chrome", { chrome: null }],
    ["--chrome --verbose", { chrome: null, verbose: null }],
    ["--effort high", { effort: "high" }],
    ["--chrome --effort high --debug", { chrome: null, effort: "high", debug: null }],
    ["--model claude-sonnet-4-6", { model: "claude-sonnet-4-6" }],
    [
      "--append-system-prompt always-think-step-by-step --chrome",
      { "append-system-prompt": "always-think-step-by-step", chrome: null },
    ],
    [
      '--append-system-prompt "always think step by step" --chrome',
      { "append-system-prompt": "always think step by step", chrome: null },
    ],
    ["--chrome --max-budget-usd 5.00", { chrome: null, "max-budget-usd": "5.00" }],
    ["--effort=high", { effort: "high" }],
    [
      "--chrome --model=claude-sonnet-4-6 --debug",
      { chrome: null, model: "claude-sonnet-4-6", debug: null },
    ],
    ["  --chrome   --verbose  ", { chrome: null, verbose: null }],
  ])("parses flags from %s", (input, flags) => {
    expect(parseCliArgs(input)).toEqual({ flags, positionals: [] });
  });

  it("collects positional arguments", () => {
    expect(parseCliArgs("1.2.3")).toEqual({
      flags: {},
      positionals: ["1.2.3"],
    });
  });

  it("collects positionals mixed with flags (argv array)", () => {
    expect(parseCliArgs(["1.2.3", "--root", "/path", "--github-output"])).toEqual({
      flags: { root: "/path", "github-output": null },
      positionals: ["1.2.3"],
    });
  });

  it("boolean flag does not consume next token as value", () => {
    expect(parseCliArgs(["--github-output", "1.2.3"], { booleanFlags: ["github-output"] })).toEqual(
      {
        flags: { "github-output": null },
        positionals: ["1.2.3"],
      },
    );
  });

  it("non-boolean flag still consumes next token", () => {
    expect(parseCliArgs(["--root", "/path", "1.2.3"], { booleanFlags: ["github-output"] })).toEqual(
      {
        flags: { root: "/path" },
        positionals: ["1.2.3"],
      },
    );
  });

  it("mixes boolean and value flags with positionals", () => {
    expect(
      parseCliArgs(["--github-output", "--root", "/path", "1.2.3"], {
        booleanFlags: ["github-output"],
      }),
    ).toEqual({
      flags: { "github-output": null, root: "/path" },
      positionals: ["1.2.3"],
    });
  });
});
