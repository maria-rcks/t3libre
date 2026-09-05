import { describe, expect, it } from "vite-plus/test";

import { parsePullRequestReference } from "./pullRequestReference";

describe("parsePullRequestReference", () => {
  it.each([
    "https://github.com/pingdotgg/t3code/pull/42",
    "https://dev.azure.com/acme/project/_git/t3code/pullrequest/42",
    "https://gitlab.com/group/project/-/merge_requests/42",
    "https://acme.visualstudio.com/project/_git/t3code/pullrequest/42",
  ])("accepts pull request URL %s", (url) => {
    expect(parsePullRequestReference(url)).toBe(url);
  });

  it.each([
    "42",
    "#42",
    "gh pr checkout 42",
    "gh pr checkout #42",
    "glab mr checkout 42",
    "az repos pr checkout --id 42",
    "az repos pr checkout --id=42",
    "az repos pr checkout --id 42 --remote-name origin",
  ])("extracts the pull request number from %s", (input) => {
    expect(parsePullRequestReference(input)).toBe("42");
  });

  it("accepts gh pr checkout commands with GitHub pull request URLs", () => {
    expect(
      parsePullRequestReference("gh pr checkout https://github.com/pingdotgg/t3code/pull/42"),
    ).toBe("https://github.com/pingdotgg/t3code/pull/42");
  });

  it("rejects non-pull-request input", () => {
    expect(parsePullRequestReference("feature/my-branch")).toBeNull();
  });
});
