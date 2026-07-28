/**
 * The marketing site embeds the demo with an optional `?stage=` query param so
 * visitors can preview the per-channel builds (Latest / Nightly / Dev). The
 * stage only changes the version string the mock server reports — the real
 * branding + sidebar stage art logic reacts to it exactly like production.
 */
export type DemoStage = "latest" | "nightly" | "dev";

export function resolveDemoStage(): DemoStage {
  if (typeof window === "undefined") return "latest";
  const stage = new URLSearchParams(window.location.search).get("stage");
  return stage === "nightly" || stage === "dev" ? stage : "latest";
}

export function demoServerVersion(baseVersion: string): string {
  const stage = resolveDemoStage();
  if (stage === "nightly") return `${baseVersion}-nightly.20260701.1`;
  if (stage === "dev") return `${baseVersion}-dev.1`;
  return baseVersion;
}
