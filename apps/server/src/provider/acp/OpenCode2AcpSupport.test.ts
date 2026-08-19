import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyOpenCode2AcpModelSelection,
  buildOpenCode2AcpSpawnInput,
  isOpenCode2ActivePromptError,
  promptOpenCode2Acp,
} from "./OpenCode2AcpSupport.ts";

describe("OpenCode2AcpSupport", () => {
  it("spawns the configured binary in ACP mode", () => {
    expect(
      buildOpenCode2AcpSpawnInput({ binaryPath: "/opt/opencode2" }, "/workspace", {
        OPENCODE_CONFIG: "/tmp/config",
      }),
    ).toEqual({
      command: "/opt/opencode2",
      args: ["acp"],
      cwd: "/workspace",
      env: { OPENCODE_CONFIG: "/tmp/config" },
    });
  });

  it.effect("applies the model, effort, and agent mode", () => {
    const calls: Array<readonly [string, string | boolean]> = [];
    return applyOpenCode2AcpModelSelection({
      runtime: {
        getConfigOptions: Effect.succeed([
          {
            id: "effort",
            name: "Effort",
            category: "thought_level",
            type: "select",
            currentValue: "low",
            options: [
              { value: "low", name: "Low" },
              { value: "high", name: "High" },
            ],
          },
          {
            id: "mode",
            name: "Session Mode",
            category: "mode",
            type: "select",
            currentValue: "build",
            options: [
              { value: "build", name: "Build" },
              { value: "plan", name: "Plan" },
            ],
          },
        ]),
        setModel: (model) =>
          Effect.sync(() => {
            calls.push(["model", model]);
          }),
        setConfigOption: (id, value) =>
          Effect.sync(() => {
            calls.push([id, value]);
            return { configOptions: [] };
          }),
      },
      model: "opencode-go/glm-5.3",
      selections: [
        { id: "effort", value: "High" },
        { id: "agent", value: "Plan" },
      ],
      interactionMode: undefined,
      mapError: (cause) => cause,
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(calls).toEqual([
            ["model", "opencode-go/glm-5.3"],
            ["effort", "high"],
            ["mode", "plan"],
          ]);
        }),
      ),
    );
  });

  it.effect("reloads OpenCode2 after an active-prompt rejection", () =>
    Effect.gen(function* () {
      let attempts = 0;
      let reloads = 0;
      const activePromptError = new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error: Session already has an active ACP prompt: test-session",
        method: "session/prompt",
      });
      expect(isOpenCode2ActivePromptError(activePromptError)).toBe(true);

      const result = yield* promptOpenCode2Acp(
        {
          reload: Effect.sync(() => {
            reloads += 1;
          }),
          prompt: () =>
            Effect.suspend(() => {
              attempts += 1;
              return attempts === 1
                ? Effect.fail(activePromptError)
                : Effect.succeed({ stopReason: "end_turn" as const });
            }),
        },
        { prompt: [{ type: "text", text: "follow up" }] },
      );

      expect(result).toEqual({ stopReason: "end_turn" });
      expect(attempts).toBe(2);
      expect(reloads).toBe(1);
    }),
  );

  it.effect("does not reload for defects", () =>
    Effect.gen(function* () {
      let reloads = 0;
      const defect = new Error("boom");
      const exit = yield* Effect.exit(
        promptOpenCode2Acp(
          {
            reload: Effect.sync(() => {
              reloads += 1;
            }),
            prompt: () => Effect.die(defect),
          },
          { prompt: [{ type: "text", text: "follow up" }] },
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(reloads).toBe(0);
    }),
  );
});
