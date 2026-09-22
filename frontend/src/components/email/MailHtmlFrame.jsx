import { useMemo } from "react";

/**
 * The policy the formatted body runs under. Nothing may be fetched — no remote
 * image, tracking pixel, font or frame — so opening a message tells its sender
 * nothing. Only inline styles and `data:` images render.
 */
const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";

// `template` because a declarative shadow root is one: the frame's parser
// attaches it, and no selector here looks inside it.
const STRIPPED =
  "script, meta, base, link, iframe, frame, frameset, object, embed, form, template";

const FRAME_STYLE =
  "body{margin:0;padding:16px;font:14px/1.6 system-ui,sans-serif;color:#334155;overflow-wrap:anywhere}img{max-width:100%;height:auto}";

/**
 * An inert pass over the mail's HTML before it reaches the frame.
 *
 * A DOMParser document runs no script and loads nothing, so parsing here is
 * safe. The pass removes what the sandbox and the CSP would not stop on their
 * own — a `<meta refresh>` or `<base>` navigating the frame away, embedded
 * frames and forms — and points every link at a new tab, which the sandbox then
 * refuses. It is not the security boundary; the sandbox is.
 */
function inertMarkup(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(STRIPPED).forEach((node) => node.remove());
  // `a` by name as well: `[href]` misses an SVG link's `xlink:href`.
  doc
    .querySelectorAll("a, area, [href]")
    .forEach((node) => node.setAttribute("target", "_blank"));

  const styles = [...doc.head.querySelectorAll("style")]
    .map((node) => node.outerHTML)
    .join("");
  return styles + doc.body.innerHTML;
}

/**
 * A mail's HTML body, in a frame that can do nothing.
 *
 * `sandbox=""` grants no permission at all: no script, no forms, no popups, no
 * navigation of this page, and an opaque origin that cannot read the app's
 * cookies or DOM. Never add `allow-same-origin` — with it the frame would be
 * the app. The height is fixed because the page cannot measure an opaque frame.
 */
export function MailHtmlFrame({ html }) {
  const srcDoc = useMemo(
    () =>
      "<!doctype html><html><head>" +
      '<meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
      '<meta name="referrer" content="no-referrer">' +
      `<style>${FRAME_STYLE}</style>` +
      `</head><body>${inertMarkup(html)}</body></html>`,
    [html],
  );

  return (
    <iframe
      title="Formatted message body"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="h-[60vh] min-h-72 w-full rounded-2xl border border-slate-200 bg-white"
    />
  );
}
