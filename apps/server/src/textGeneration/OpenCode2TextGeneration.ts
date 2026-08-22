import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { TextGenerationError, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import { OpenCode2Runtime, type OpenCode2RuntimeError } from "../provider/openCode2Runtime.ts";
import type { OpenCode2ProviderSettings } from "../provider/Layers/OpenCode2Provider.ts";
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

const OPENCODE2_GENERATE_TIMEOUT = "3 minutes";
const isTextGenerationError = Schema.is(TextGenerationError);

const OpenCode2GenerateResponseSchema = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ data: Schema.Struct({ text: Schema.String }) }),
]);

type OpenCode2TextGenerationOperation =
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

function generatedText(response: typeof OpenCode2GenerateResponseSchema.Type): string {
  return "data" in response ? response.data.text : response.text;
}

function runtimeFailureDetail(cause: OpenCode2RuntimeError): string {
  return cause.kind === "unsupported-preview"
    ? `This OpenCode 2 preview is not supported for text generation. ${cause.detail}`
    : cause.detail;
}

export const makeOpenCode2TextGeneration = Effect.fn("makeOpenCode2TextGeneration")(function* (
  settings: Pick<OpenCode2ProviderSettings, "binaryPath">,
  environment?: NodeJS.ProcessEnv,
) {
  const runtime = yield* OpenCode2Runtime;

  const runOpenCode2Json = Effect.fn("runOpenCode2Json")(function* <S extends Schema.Top>(input: {
    readonly operation: OpenCode2TextGenerationOperation;
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
        schema: OpenCode2GenerateResponseSchema,
        query: { "location[directory]": input.cwd },
        body: { prompt: input.prompt, model },
      });
    }).pipe(
      Effect.timeoutOption(OPENCODE2_GENERATE_TIMEOUT),
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
              detail: runtimeFailureDetail(cause),
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
    Effect.fn("OpenCode2TextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runOpenCode2Json({
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
    Effect.fn("OpenCode2TextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runOpenCode2Json({
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
    Effect.fn("OpenCode2TextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runOpenCode2Json({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("OpenCode2TextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runOpenCode2Json({
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
