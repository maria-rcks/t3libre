import { spawnMspConnection } from "@muse-code/sdk";
import {
  TrimmedNonEmptyString,
  type MuseSettings,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";

import { spawnAndCollect } from "../providerSnapshot.ts";

class MuseSkillsProbeError extends Schema.TaggedError<MuseSkillsProbeError>()(
  "MuseSkillsProbeError",
  { exitCode: Schema.Number },
) {
  override get message(): string {
    return `Muse skill discovery exited with code ${this.exitCode}.`;
  }
}

const SkillFiles = Schema.Struct({
  skills: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      name: TrimmedNonEmptyString,
      path: TrimmedNonEmptyString,
      scope: TrimmedNonEmptyString,
      activation: Schema.String,
    }),
  ),
});
export const MuseSkillCatalog = Schema.Struct({
  skills: Schema.Array(
    Schema.Struct({
      selector: TrimmedNonEmptyString,
      description: Schema.String,
      displayName: Schema.String,
      source: TrimmedNonEmptyString,
      pluginId: Schema.optional(Schema.String),
    }),
  ),
});
const SessionResult = Schema.Struct({ session: Schema.Struct({ sessionId: Schema.String }) });
const decodeSkillFiles = Schema.decodeUnknownEffect(Schema.fromJsonString(SkillFiles));
const decodeSessionResult = Schema.decodeUnknownEffect(SessionResult);
const decodeSkillCatalog = Schema.decodeUnknownEffect(MuseSkillCatalog);

/** The native command catalog owns invocability; CLI metadata supplies source paths. */
export const discoverMuseSkills = Effect.fn("discoverMuseSkills")(function* (
  settings: Pick<MuseSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) {
  const path = yield* Path.Path;
  const command = settings.binaryPath || "muse";
  const args = [
    "skills",
    "list",
    "--enabled-only",
    "--workspace",
    cwd,
    "--trust-workspace",
    "--json",
  ];
  const result = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
    const output = yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd,
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
    if (output.code !== 0)
      return yield* new MuseSkillsProbeError({
        exitCode: output.code,
      });
    const files = yield* decodeSkillFiles(output.stdout);
    const handshake = yield* Effect.acquireRelease(
      Effect.try(() =>
        spawnMspConnection({
          command,
          args: ["serve", "--no-session-log", "--trust-workspace"],
          cwd,
          env: environment,
          shutdownTimeoutMs: 1_000,
        }),
      ),
      (host) => Effect.tryPromise(() => host.close()).pipe(Effect.ignore),
    );
    const host = yield* Effect.tryPromise(() =>
      handshake.initialize({ clientInfo: { name: "t3_code", version: "0.0.0" } }),
    );
    const session = yield* Effect.tryPromise(() =>
      host.connection.command("session/start", {
        workspaceRoot: cwd,
        approvalMode: "denyUnmatched",
      }),
    ).pipe(Effect.flatMap(decodeSessionResult));
    const catalog = yield* Effect.tryPromise(() =>
      host.connection.request("skill/list", { sessionId: session.session.sessionId }),
    ).pipe(Effect.flatMap(decodeSkillCatalog));
    const skills: ServerProviderSkill[] = [];
    for (const native of catalog.skills) {
      const bareName =
        native.pluginId && native.selector.startsWith(`${native.pluginId}:`)
          ? native.selector.slice(native.pluginId.length + 1)
          : native.selector;
      const id =
        native.source === "bundled"
          ? `bundled:${bareName}`
          : native.source === "plugin" && native.pluginId
            ? `plugin:${native.pluginId}:${bareName}`
            : native.selector;
      const file = files.skills.find(
        (entry) =>
          entry.scope === native.source && (entry.id === id || entry.name === native.selector),
      );
      if (!file) continue;
      const home = environment.HOME ?? environment.USERPROFILE;
      const sourcePath =
        file.path.startsWith("$HOME/") && home
          ? path.join(home, file.path.slice(6))
          : /^[a-z][a-z\d+.-]*:\/\//i.test(file.path) || path.isAbsolute(file.path)
            ? file.path
            : path.resolve(cwd, file.path);
      skills.push({
        name: native.selector,
        path: sourcePath,
        scope: native.source,
        enabled: true,
        userInvocable: true,
        ...(native.displayName.trim() ? { displayName: native.displayName.trim() } : {}),
        ...(native.description.trim() ? { description: native.description.trim() } : {}),
        ...(file.activation === "user-invocable-only" ? { userInvocationOnly: true } : {}),
      });
    }
    return skills;
  }).pipe(Effect.timeout("10 seconds"), Effect.scoped);
  return result;
});

export function museSkillMentions(prompt: string) {
  return collectComposerInlineTokens(`${prompt} `).filter((token) => token.type === "skill");
}

/** Convert existing composer chips only when the live session offers their exact selectors. */
export function museSkillInputParts(
  prompt: string,
  selectors: ReadonlySet<string>,
): Array<Record<string, unknown>> {
  const mentions = museSkillMentions(prompt);
  if (!mentions.some((token) => selectors.has(token.value)))
    return [{ type: "text", text: prompt }];
  const parts: Array<Record<string, unknown>> = [];
  let cursor = 0;
  for (const [index, mention] of mentions.entries()) {
    const leading = prompt.slice(cursor, mention.start);
    if (leading.trim()) parts.push({ type: "text", text: leading });
    const end = mentions[index + 1]?.start ?? prompt.length;
    if (!selectors.has(mention.value)) {
      parts.push({ type: "text", text: prompt.slice(mention.start, end) });
      cursor = end;
      continue;
    }
    const argumentsText = prompt.slice(mention.end, end).trim();
    parts.push({
      type: "skill",
      selector: mention.value,
      ...(argumentsText ? { arguments: argumentsText } : {}),
    });
    cursor = end;
  }
  return parts;
}
