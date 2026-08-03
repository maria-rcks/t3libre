import { ProviderDriverKind } from "@t3tools/contracts";
import type { CSSProperties } from "react";
import { ClaudeAI, CursorIcon, GrokIcon, Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { PROVIDER_OPTIONS } from "../../session-logic";

export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
  [ProviderDriverKind.make("opencode")]: OpenCodeIcon,
  [ProviderDriverKind.make("cursor")]: CursorIcon,
  [ProviderDriverKind.make("grok")]: GrokIcon,
};

type ProviderIconAverageColor = {
  readonly light: string;
  readonly dark: string;
};

function averageHexColors(colors: ReadonlyArray<string>): string {
  const channels = colors.reduce<[number, number, number]>(
    (sum, color) => {
      const value = color.slice(1);
      return [
        sum[0] + Number.parseInt(value.slice(0, 2), 16),
        sum[1] + Number.parseInt(value.slice(2, 4), 16),
        sum[2] + Number.parseInt(value.slice(4, 6), 16),
      ];
    },
    [0, 0, 0],
  );
  return `#${channels
    .map((channel) =>
      Math.round(channel / colors.length)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Average of the fill colors used by each provider SVG in Icons.tsx. */
const PROVIDER_ICON_AVERAGE_COLOR_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, ProviderIconAverageColor>
> = {
  [ProviderDriverKind.make("codex")]: { light: "#000000", dark: "#ffffff" },
  [ProviderDriverKind.make("claudeAgent")]: { light: "#d97757", dark: "#d97757" },
  [ProviderDriverKind.make("cursor")]: { light: "#26251e", dark: "#edecec" },
  [ProviderDriverKind.make("grok")]: { light: "#0f0f0f", dark: "#f5f5f5" },
  [ProviderDriverKind.make("opencode")]: {
    light: averageHexColors(["#cfcecd", "#211e1e"]),
    dark: averageHexColors(["#4b4646", "#f1ecec"]),
  },
};

export function getProviderIconAverageColorStyle(
  driverKind: ProviderDriverKind,
): CSSProperties | undefined {
  const color = PROVIDER_ICON_AVERAGE_COLOR_BY_PROVIDER[driverKind];
  return color === undefined
    ? undefined
    : ({
        "--provider-icon-average-color-light": color.light,
        "--provider-icon-average-color-dark": color.dark,
      } as CSSProperties);
}

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderDriverKind;
  label: string;
  available: true;
  pickerSidebarBadge?: "new" | "soon";
} {
  return option.available;
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  isLegacy?: boolean | undefined;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) {
    return value;
  }

  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  const name = options?.preferShortName && model.shortName ? model.shortName : model.name;
  return stripLeadingQualifier(name, model.subProvider);
}

export function getTriggerDisplayModelName(model: ModelEsque): string {
  return getDisplayModelName(model, { preferShortName: true });
}

export function getTriggerDisplayModelLabel(model: ModelEsque): string {
  return getTriggerDisplayModelName(model);
}
