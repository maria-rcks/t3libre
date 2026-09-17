import { createModelCapabilities } from "@t3tools/shared/model";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const ModelRouting = Schema.Struct({
  modelId: Schema.String,
  providerId: Schema.String,
  profileId: Schema.NullOr(Schema.String),
});
export const MuseModelCatalog = Schema.Struct({
  source: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      ...ModelRouting.fields,
      displayLabel: Schema.String,
      isDefault: Schema.Boolean,
    }),
  ),
});
export const MUSE_ROUTED_MODEL_PREFIX = "muse-route:";

/** Muse's model catalog omits reasoning options; the installed CLI advertises them. */
export function museReasoningCapabilities(help: string) {
  const section = help.split(/--reasoning-effort\s+<[^>]+>/)[1]?.split(/\n\s*--/)[0];
  const advertised = section?.match(/Meta reasoning effort:\s*([a-z]+(?:\s*\|\s*[a-z]+)+)/i)?.[1];
  const values = [...new Set(advertised?.split("|").map((value) => value.trim()) ?? [])];
  const defaultValue = section?.match(/\(default:\s*([a-z]+)\)/i)?.[1];
  return createModelCapabilities({
    optionDescriptors:
      values.length === 0
        ? []
        : [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              options: values.map((value) => ({
                id: value,
                label: value.charAt(0).toUpperCase() + value.slice(1),
                ...(value === defaultValue ? { isDefault: true } : {}),
              })),
              ...(defaultValue && values.includes(defaultValue)
                ? { currentValue: defaultValue }
                : {}),
            },
          ],
  });
}

/** Native Muse catalogs currently use model slugs as their display labels. */
export function formatMuseModelLabel(label: string): string {
  if (!/^muse(?:-[a-z0-9.]+)+$/.test(label)) return label;
  return label
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Preserve native routing when different profiles expose the same model id. */
export function encodeMuseModelSelection(model: typeof ModelRouting.Type): string {
  const { modelId, providerId, profileId } = model;
  return `${MUSE_ROUTED_MODEL_PREFIX}${Buffer.from(
    JSON.stringify({ modelId, providerId, profileId }),
  ).toString("base64url")}`;
}

const decodeRouting = Schema.decodeUnknownOption(Schema.fromJsonString(ModelRouting));
export function decodeMuseModelSelection(selection: string) {
  if (!selection.startsWith(MUSE_ROUTED_MODEL_PREFIX)) return undefined;
  return Option.getOrUndefined(
    decodeRouting(
      Buffer.from(selection.slice(MUSE_ROUTED_MODEL_PREFIX.length), "base64url").toString(),
    ),
  );
}
