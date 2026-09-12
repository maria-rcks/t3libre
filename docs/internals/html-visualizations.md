# HTML visualization isolation

Assistant `t3-html` fences are untrusted documents. The renderer in
[HtmlVisualization.tsx](../../apps/web/src/components/chat/HtmlVisualization.tsx)
combines sanitization with two sandboxed frames. Neither frame grants any sandbox
allowances, and no message bridge connects the document to application actions.

The outer document must remain entirely application-owned. Its CSP blocks the
inner frame's navigation; a single sandboxed frame can still navigate itself.
Both documents install their CSP before any generated content. Sanitizing the
content does not replace these browser-enforced boundaries.

DOMPurify removes resource hints, nested documents, and URL attributes before
embedding. DNS-prefetch and preconnect hints can bypass CSP, so permitting `link`
or another generated `srcdoc` would reopen an outbound channel. Preserve this
restriction when changing sanitizer configuration. Styles are deliberately kept;
their resource loads are denied by CSP.

Do not add `allow-scripts` to support richer interactions. CSP is insufficient to
disable every JavaScript network channel, including WebRTC, and iframe sandboxing
does not provide CPU isolation. Native HTML controls are the supported interaction
model. The source-size and frame-size limits bound ordinary rendering, but cannot
guarantee a CPU or GPU budget for hostile HTML/CSS.

The format travels as normal assistant text through shared provider instructions.
Only the assistant timeline opts into rendering. Other markdown surfaces and the
native mobile clients retain source; they must not reuse a more permissive file
preview as an inline visualization renderer.
