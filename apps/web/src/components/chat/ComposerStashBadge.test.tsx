import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerStashBadge } from "./ComposerStashBadge";

describe("ComposerStashBadge", () => {
  it("renders as an attached composer tab instead of a floating pill", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge count={3} pulseKey={0} pulsing={false} onToggleMenu={() => {}} />,
    );

    expect(markup).toContain("chat-composer-stash-tab");
    expect(markup).toContain("rounded-t-xl");
    expect(markup).toContain("border-b-0");
    expect(markup).toContain("items-center");
    expect(markup).not.toContain("items-start");
    expect(markup).not.toContain("rounded-full");
    expect(markup).not.toContain("opacity-70");
  });
});
