/**
 * Why the shared headless browser cannot start on this host, in terms the
 * person running the server can act on. T3 never turns Chrome's sandbox off by
 * itself; a host that cannot give it one gets these steps instead, and only the
 * operator's explicit `T3CODE_SERVER_BROWSER_SANDBOX=0` launches without it.
 */
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const GUIDE =
  "https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#browser-host-setup";

/** What Chrome prints before aborting when it cannot sandbox itself. */
export const NO_SANDBOX_SIGNATURE = "No usable sandbox";

/** Whether an operator explicitly allowed Chrome to run without its sandbox. */
export const sandboxDisabled = (env: Readonly<Record<string, string | undefined>>) =>
  env.T3CODE_SERVER_BROWSER_SANDBOX === "0";

export class PreviewBrowserSandboxError extends Schema.TaggedError<PreviewBrowserSandboxError>()(
  "PreviewBrowserSandboxError",
  {},
) {
  override get message(): string {
    return [
      "T3's headless browser needs Chrome's sandbox, which this host blocks.",
      "On Ubuntu 23.10 and later, AppArmor stops unprivileged programs from creating the user namespace it uses.",
      `Allow it once with the AppArmor profile in ${GUIDE}, or set T3CODE_SERVER_BROWSER_SANDBOX=0 to run without the sandbox.`,
    ].join(" ");
  }
}

export class PreviewBrowserLibrariesError extends Schema.TaggedError<PreviewBrowserLibrariesError>()(
  "PreviewBrowserLibrariesError",
  { libraries: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return [
      `T3's headless browser cannot start because this host is missing ${this.libraries.join(", ")}.`,
      `Install Chrome's system libraries (on Debian or Ubuntu: ${DEBIAN_PACKAGES}), as described in ${GUIDE}.`,
    ].join(" ");
  }
}

export type PreviewBrowserHostError = PreviewBrowserSandboxError | PreviewBrowserLibrariesError;

/** Chrome's Debian dependencies that minimal images leave out, from the headless shell's deb.deps. */
const DEBIAN_PACKAGES =
  "sudo apt-get install libnss3 libglib2.0-0 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libdbus-1-3 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libxkbcommon0 libgbm1 libasound2 libexpat1";

const MISSING_LIBRARY = /^\s*(\S+) => not found$/gm;

/**
 * After a launch fails, names the host setup it is missing: the sandbox, from
 * Chrome's own abort message, or shared libraries, from `ldd`. Undefined when
 * neither explains it. Linux only; other hosts never need either.
 */
export const diagnoseLaunchFailure = Effect.fn("PreviewBrowserHost.diagnoseLaunchFailure")(
  function* (input: { readonly executable: string; readonly output: string }) {
    if (input.output.includes(NO_SANDBOX_SIGNATURE)) return new PreviewBrowserSandboxError();
    if ((yield* HostProcessPlatform) !== "linux") return undefined;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const report = yield* spawner
      .string(ChildProcess.make("ldd", [input.executable], { stdin: "ignore", stderr: "ignore" }))
      .pipe(
        Effect.timeout("5 seconds"),
        Effect.orElseSucceed(() => ""),
      );
    const libraries = [...report.matchAll(MISSING_LIBRARY)].map((match) => match[1]!);
    return libraries.length === 0 ? undefined : new PreviewBrowserLibrariesError({ libraries });
  },
);
