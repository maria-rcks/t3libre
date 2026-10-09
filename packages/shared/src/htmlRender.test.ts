import { describe, expect, it } from "vite-plus/test";

import {
  HTML_RENDER_MAX_HEIGHT,
  htmlRenderFrameHeight,
  htmlRenderReferencesEqual,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  injectHtmlRenderBootstrap,
  injectHtmlRenderFocusStyles,
  htmlRenderThemeMessage,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
  readHtmlRenderReference,
} from "./htmlRender.ts";
import { T3_CODE_DARK_THEME_COLORS, T3_CODE_LIGHT_THEME_COLORS } from "./themePalettes.ts";
import { htmlRenderFromToolItem } from "./toolOutput.ts";

const reference = { attachmentId: "thread-abc-123.html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="t3-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
    expect(injected).toContain('name="viewport"');
  });

  it("wraps fragments without a head and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it.each(["textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"])(
    "keeps the bootstrap outside %s content",
    (tag) => {
      const fragment = `<${tag}><head><meta name="viewport"></head></${tag}>`;
      const injected = injectHtmlRenderBootstrap(fragment);
      expect(injected.startsWith("<!doctype html><head>")).toBe(true);
      expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf(`<${tag}>`));
      expect(injected).toContain('<meta name="viewport" content="width=device-width');
      expect(injected.endsWith(fragment)).toBe(true);
    },
  );

  it.each([
    '<template><head><meta name="viewport"></head></template>',
    '<template><template>inner</template><head><meta name="viewport"></head></template>',
  ])("keeps the bootstrap outside inert template content: %s", (fragment) => {
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf("<template>"));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it("ignores tags written inside comments and scripts", () => {
    const html =
      '<!-- copy <head> and <meta name="viewport"> here --><html><head>' +
      "<script>const tag = '<meta name=\"viewport\">';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="t3-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
  });
});

describe("injectHtmlRenderFocusStyles", () => {
  const theme = '<style id="t3-theme">:root{--ring:red}</style>';

  it("adds inward focus styles immediately before the real theme without changing it", () => {
    const injected = injectHtmlRenderFocusStyles(theme);
    expect(injected).toMatch(/^<style id="t3-focus">/);
    expect(injected).toContain("outline-width:2px!important;outline-offset:-2px!important");
    expect(injected?.endsWith(theme)).toBe(true);
  });

  it.each([
    `<![CDATA[> <style id="t3-theme">]]>`,
    `<svg><![CDATA[> <style id="t3-theme">]]></svg>`,
    `<div data-example="<style id='t3-theme'>"></div>`,
    `<div data-example='<style id="t3-theme">'></div>`,
    `<div data-example="> <style id='t3-theme'>"></div>`,
    `<my-theme_card data-example="<style id='t3-theme'>"></my-theme_card>`,
    `<my-theme.card data-example="<style id='t3-theme'>"></my-theme.card>`,
    `<style data-example="<style id='t3-theme'>">body{color:red}</style>`,
    `<style data-example="id='t3-theme'">body{color:red}</style>`,
    `<style data-id="t3-theme">body{color:red}</style>`,
    `<style id="other" id="t3-theme">body{color:red}</style>`,
    `<style id="T3-THEME">body{color:red}</style>`,
  ])("ignores quoted theme decoys and preserves their bytes: %s", (decoy) => {
    expect(injectHtmlRenderFocusStyles(decoy)).toBeUndefined();
    expect(injectHtmlRenderFocusStyles(decoy + theme)).toBe(
      decoy + injectHtmlRenderFocusStyles(theme),
    );
  });

  it.each([
    `<![CDATA[> <style id="t3-focus">]]>`,
    `<svg><![CDATA[> <style id="t3-focus">]]></svg>`,
    `<div data-example="<style id='t3-focus'>"></div>`,
    `<div data-example='<style id="t3-focus">'></div>`,
    `<my-theme_card data-example="<style id='t3-focus'>"></my-theme_card>`,
    `<my-theme.card data-example="<style id='t3-focus'>"></my-theme.card>`,
    `<style data-example="<style id='t3-focus'>">body{color:red}</style>`,
    `<style data-example="id='t3-focus'">body{color:red}</style>`,
    `<style id="T3-FOCUS">body{color:red}</style>`,
  ])("does not let quoted focus decoys suppress injection: %s", (decoy) => {
    expect(injectHtmlRenderFocusStyles(decoy + theme)).toBe(
      decoy + injectHtmlRenderFocusStyles(theme),
    );
  });

  it.each([
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "noscript",
  ])("ignores marker text inside %s raw content", (tag) => {
    const decoy = `<${tag}><style id="t3-theme"><style id="t3-focus"></${tag}>`;
    expect(injectHtmlRenderFocusStyles(decoy)).toBeUndefined();
    expect(injectHtmlRenderFocusStyles(decoy + theme)).toBe(
      decoy + injectHtmlRenderFocusStyles(theme),
    );
  });

  it.each([
    '<!-- <style id="t3-theme"><style id="t3-focus"> -->',
    '<template><template><style id="t3-theme"></style><style id="t3-focus"></style></template></template>',
    '<template data-example="</template>"><style id="t3-theme"></style></template>',
  ])("ignores markers in comments and nested templates: %s", (decoy) => {
    expect(injectHtmlRenderFocusStyles(decoy)).toBeUndefined();
    expect(injectHtmlRenderFocusStyles(decoy + theme)).toBe(
      decoy + injectHtmlRenderFocusStyles(theme),
    );
  });

  it.each(["</style/>", '</style data-example=">">'])(
    "recognizes marker tags after a raw-text closing tag with attributes or slash: %s",
    (closing) => {
      const prefix = `<style>body{color:red}${closing}`;
      expect(injectHtmlRenderFocusStyles(prefix + theme)).toBe(
        prefix + injectHtmlRenderFocusStyles(theme),
      );
    },
  );

  it.each([
    `<style data-example="> <style id='t3-focus'>" id='t3-theme'>body{color:red}</style>`,
    `<style data-example='> <style id="t3-focus">' id=t3-theme>body{color:red}</style>`,
  ])("recognizes real marker attributes after quoted decoys and embedded >: %s", (realTheme) => {
    expect(injectHtmlRenderFocusStyles(realTheme)).toBe(
      injectHtmlRenderFocusStyles(theme)?.slice(0, -theme.length) + realTheme,
    );
  });

  it("keeps an existing real focus policy without injecting a duplicate", () => {
    const html = theme + '<style id="t3-focus">:focus-visible{outline-offset:-2px}</style>';
    expect(injectHtmlRenderFocusStyles(html)).toBe(html);
  });

  it.each(["<![CDATA[", "<svg><![CDATA["])(
    "keeps generated head protection before authored declarations: %s",
    (opening) => {
      const page = `<html><head>${theme}</head><body>${opening}> <style id="t3-focus">]]></svg></body></html>`;
      const injected = injectHtmlRenderFocusStyles(page);
      expect(injected).toBe(page.replace(theme, injectHtmlRenderFocusStyles(theme)!));
      expect(injectHtmlRenderFocusStyles(injected!)).toBe(injected);
    },
  );

  it("ignores markers after plaintext and inside unclosed quoted attributes", () => {
    expect(injectHtmlRenderFocusStyles("<plaintext>" + theme)).toBeUndefined();
    expect(injectHtmlRenderFocusStyles(`<div data-example="<style id='t3-theme'>`)).toBeUndefined();
  });
});

describe("readHtmlRenderLinkRequest", () => {
  it("accepts only http(s) URLs in an MCP Apps ui/open-link request", () => {
    const link = (url: unknown) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url },
    });
    expect(readHtmlRenderLinkRequest(link("https://example.com/a"))).toEqual({
      id: 1,
      url: "https://example.com/a",
    });
    expect(readHtmlRenderLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readHtmlRenderLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://example.com" },
      }),
    ).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({ type: "t3-html-render-link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

describe("readHtmlRenderContentHeight", () => {
  it("reads only the height of an MCP Apps size-changed notification", () => {
    const notification = (params: unknown) => ({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params,
    });
    expect(readHtmlRenderContentHeight(notification({ height: 412 }))).toBe(412);
    expect(readHtmlRenderContentHeight(notification({ height: "412" }))).toBe(undefined);
    expect(readHtmlRenderContentHeight(notification({ height: 0 }))).toBe(undefined);
    expect(readHtmlRenderContentHeight({ ...notification({ height: 412 }), method: "x" })).toBe(
      undefined,
    );
  });
});

describe("htmlRenderThemeMessage", () => {
  it("is an MCP Apps host-context-changed notification carrying the theme variables", () => {
    const theme = htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark");
    expect(htmlRenderThemeMessage(theme)).toEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark", styles: { variables: theme.variables } },
    });
  });
});

describe("htmlRenderTheme", () => {
  it("exposes the brand accent as --accent and keeps the fragment decodable", () => {
    const theme = htmlRenderTheme(T3_CODE_LIGHT_THEME_COLORS, "light");
    expect(theme.variables["--accent"]).toBe(T3_CODE_LIGHT_THEME_COLORS.accent);
    expect(theme.variables["--chart-1"]).toBe(T3_CODE_LIGHT_THEME_COLORS.accent);
    expect(theme.variables["--chart-6"]).toBeDefined();
    const fragment = htmlRenderThemeFragment(theme);
    expect(JSON.parse(decodeURIComponent(fragment.slice("#t3-theme=".length)))).toEqual(theme);
    expect(fragment).not.toContain("&");
    expect(htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark").variables["--background"]).toBe(
      T3_CODE_DARK_THEME_COLORS.canvas,
    );
  });
});

describe("readHtmlRenderReference", () => {
  it("clamps height and rejects malformed references", () => {
    expect(readHtmlRenderReference({ ...reference, height: 99_999 })?.height).toBe(2000);
    expect(readHtmlRenderReference({ ...reference, title: "  " })?.title).toBe("HTML");
    expect(readHtmlRenderReference({ ...reference, attachmentId: 4 })).toBeUndefined();
    expect(readHtmlRenderReference({ ...reference, height: Number.NaN })).toBeUndefined();
  });
});

describe("htmlRenderFromToolItem", () => {
  const result = { htmlRender: reference, message: "Rendered above your reply." };

  it("reads the reference from each provider's result envelope", () => {
    for (const [toolName, output] of [
      ["mcp__t3-code__html_render", [{ type: "text", text: JSON.stringify(result) }]],
      ["t3-code.html_render", { structuredContent: result, content: [] }],
      ["t3-code-thread_1_html_render", JSON.stringify(result)],
      ["html_render", result],
    ] as const) {
      expect(htmlRenderFromToolItem({ toolName, output })).toEqual(reference);
    }
  });

  it("ignores other tools and failed calls", () => {
    expect(htmlRenderFromToolItem({ toolName: "mcp__t3-code__html_preview", output: result })).toBe(
      undefined,
    );
    expect(htmlRenderFromToolItem({ toolName: "mcp__other__html_render", output: result })).toBe(
      undefined,
    );
    expect(
      htmlRenderFromToolItem({ toolName: "html_render", output: { ...result, isError: true } }),
    ).toBeUndefined();
  });
});

describe("htmlRenderFrameHeight", () => {
  const measured = readHtmlRenderReference({
    ...reference,
    height: 1500,
    heights: [
      [728, 1403],
      [390, 1290],
      [1000, 1660],
    ],
  })!;

  it("takes the taller neighbor between measured widths and holds the ends", () => {
    expect(measured.heights?.map(([width]) => width)).toEqual([390, 728, 1000]);
    expect(htmlRenderFrameHeight(measured, 728)).toBe(1403);
    expect(htmlRenderFrameHeight(measured, 559)).toBe(1403);
    expect(htmlRenderFrameHeight(measured, 320)).toBe(1290);
  });

  it("takes the taller layout when a breakpoint falls between measured widths", () => {
    // 900px tall below a 600px media query, 450px above it.
    const responsive = readHtmlRenderReference({
      ...reference,
      height: 2000,
      heights: [
        [520, 900],
        [640, 450],
      ],
    })!;
    expect(htmlRenderFrameHeight(responsive, 590)).toBe(900);
    expect(htmlRenderFrameHeight(responsive, 640)).toBe(450);
  });

  it("fits a page the client lays out taller than the server measured", () => {
    // The agent passed contentHeight at the column width, so the page should never scroll.
    const fitted = { ...measured, height: 1403 };
    expect(htmlRenderFrameHeight(fitted, 728, 1415)).toBe(1415);
    expect(htmlRenderFrameHeight(fitted, 1400)).toBe(1660);
    expect(htmlRenderFrameHeight(fitted, 728, 5000)).toBe(HTML_RENDER_MAX_HEIGHT);
  });

  it("keeps the agent's height when it asked for a scrolling frame or the page is unmeasured", () => {
    const scrolling = { ...measured, height: 600 };
    expect(htmlRenderFrameHeight(scrolling, 728, 1415)).toBe(600);
    expect(htmlRenderFrameHeight(scrolling, 1400)).toBe(600);
    expect(htmlRenderFrameHeight(reference, 728)).toBe(reference.height);
    expect(htmlRenderFrameHeight(reference, 728, 900)).toBe(reference.height);
    expect(htmlRenderFrameHeight(reference, 728, 300)).toBe(300);
  });

  it("drops a malformed table and compares tables by value", () => {
    expect(readHtmlRenderReference({ ...reference, heights: [[728, "x"]] })?.heights).toBe(
      undefined,
    );
    const copy = readHtmlRenderReference(JSON.parse(JSON.stringify(measured)))!;
    expect(htmlRenderReferencesEqual(measured, copy)).toBe(true);
    expect(htmlRenderReferencesEqual(measured, { ...copy, heights: [[390, 1290]] })).toBe(false);
  });
});
