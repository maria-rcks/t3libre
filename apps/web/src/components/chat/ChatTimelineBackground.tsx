import { cn } from "../../lib/utils";
import { useClientSettings } from "../../hooks/useSettings";

export const CHAT_BACKGROUND_TEXT_SHADOW_CLASSES =
  "[text-shadow:0_1px_2px_color-mix(in_oklab,var(--background)_65%,transparent)] [&_:is(button,[role=button],code,.chat-markdown-codeblock,.chat-markdown-file-link,.chat-markdown-artifact-template)]:[text-shadow:none]";

export function TimelineBackgroundImage({
  image,
  opacity,
  blur,
  className,
}: {
  image: string;
  opacity: number;
  blur: number;
  className?: string | undefined;
}) {
  if (!image) return null;

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <img
        src={image}
        alt=""
        draggable={false}
        className="absolute inset-0 size-full object-cover"
        style={{
          opacity: opacity / 100,
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
        }}
      />
    </div>
  );
}

export function ChatTimelineBackground({ className }: { className?: string | undefined }) {
  const image = useClientSettings((settings) => settings.timelineBackgroundImage);
  const opacity = useClientSettings((settings) => settings.timelineBackgroundOpacity);
  const blur = useClientSettings((settings) => settings.timelineBackgroundBlur);
  return (
    <TimelineBackgroundImage image={image} opacity={opacity} blur={blur} className={className} />
  );
}

/** Timeline cards only pay for backdrop blur when there is a wallpaper to show through. */
export function useHasTimelineBackground() {
  return useClientSettings((settings) => Boolean(settings.timelineBackgroundImage));
}
