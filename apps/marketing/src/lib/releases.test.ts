import { describe, expect, it } from "vite-plus/test";
import { selectNightlyRelease, type Release } from "./releases";

function release(
  tag_name: string,
  options: Pick<Release, "draft" | "prerelease"> = {
    draft: false,
    prerelease: true,
  },
): Release {
  return {
    tag_name,
    html_url: `https://github.com/pingdotgg/t3code/releases/tag/${tag_name}`,
    assets: [],
    ...options,
  };
}

describe("selectNightlyRelease", () => {
  it("selects the first published nightly prerelease", () => {
    const nightly = release("v0.0.32-nightly.20260729.951");

    expect(
      selectNightlyRelease([
        release("v0.0.33-nightly.20260730.1", { draft: true, prerelease: true }),
        release("v0.0.32"),
        nightly,
        release("v0.0.32-nightly.20260728.912"),
      ]),
    ).toBe(nightly);
  });

  it("ignores prereleases that are not nightly builds", () => {
    expect(selectNightlyRelease([release("v0.0.33-beta.1")])).toBeNull();
  });
});
