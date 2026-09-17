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
