import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { TextGenerationError, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import * as OpenCodeRuntime from "../provider/opencodeRuntime.ts";
import type { OpenCodeProviderSettings } from "../provider/Layers/OpenCodeProvider.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const OPENCODE_GENERATE_TIMEOUT = "3 minutes";
const isTextGenerationError = Schema.is(TextGenerationError);

const OpenCodeGenerateResponseSchema = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ data: Schema.Struct({ text: Schema.String }) }),
]);

type OpenCodeTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

function parseModelSelection(modelSelection: ModelSelection): {
  readonly providerID: string;
  readonly id: string;
  readonly variant?: string;
} | null {
  const separator = modelSelection.model.indexOf("/");
  if (separator <= 0 || separator === modelSelection.model.length - 1) return null;
  const providerID = modelSelection.model.slice(0, separator).trim();
  const id = modelSelection.model.slice(separator + 1).trim();
  if (!providerID || !id) return null;
  const variant = getModelSelectionStringOptionValue(modelSelection, "variant");
  return {
    providerID,
    id,
    ...(variant ? { variant } : {}),
  };
}

function generatedText(response: typeof OpenCodeGenerateResponseSchema.Type): string {
  return "data" in response ? response.data.text : response.text;
}

export const makeOpenCodeTextGeneration = Effect.fn("makeOpenCodeTextGeneration")(function* (
  settings: Pick<OpenCodeProviderSettings, "binaryPath">,
  environment?: NodeJS.ProcessEnv,
) {
  const runtime = yield* OpenCodeRuntime.OpenCodeRuntime;

  const runOpenCodeJson = Effect.fn("runOpenCodeJson")(function* <S extends Schema.Top>(input: {
    readonly operation: OpenCodeTextGenerationOperation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const model = parseModelSelection(input.modelSelection);
    if (model === null) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenCode 2 model selection must use the `provider/model` format.",
      });
    }

    const response = yield* Effect.gen(function* () {
      const connection = yield* runtime.attach({
        binaryPath: settings.binaryPath || "opencode2",
        ...(environment ? { environment } : {}),
      });
      return yield* connection.request("POST", "/api/generate", {
        operation: "generate.text",
        schema: OpenCodeGenerateResponseSchema,
        query: { "location[directory]": input.cwd },
        body: { prompt: input.prompt, model },
      });
    }).pipe(
      Effect.timeoutOption(OPENCODE_GENERATE_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: "OpenCode 2 text generation timed out.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: OpenCodeRuntime.isOpenCodeUnsupportedPreviewError(cause)
                ? "This OpenCode 2 preview is not supported for text generation."
                : "OpenCode 2 text generation request failed.",
              cause,
            }),
      ),
    );

    const text = generatedText(response).trim();
    if (!text) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenCode 2 returned empty text generation output.",
      });
    }

    const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchema));
    return yield* decodeOutput(extractJsonObject(text)).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "OpenCode 2 returned invalid structured text generation output.",
            cause,
          }),
      ),
    );
  });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("OpenCodeTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("OpenCodeTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("OpenCodeTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("OpenCodeTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
