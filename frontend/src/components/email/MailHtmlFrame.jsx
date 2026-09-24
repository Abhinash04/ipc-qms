import { useMemo } from "react";

const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";

const STRIPPED =
  "script, meta, base, link, iframe, frame, frameset, object, embed, form, template";

const FRAME_STYLE =
  "body{margin:0;padding:16px;font:14px/1.6 system-ui,sans-serif;color:#334155;overflow-wrap:anywhere}img{max-width:100%;height:auto}";

function inertMarkup(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(STRIPPED).forEach((node) => node.remove());
  doc
    .querySelectorAll("a, area, [href]")
    .forEach((node) => node.setAttribute("target", "_blank"));

  const styles = [...doc.head.querySelectorAll("style")]
    .map((node) => node.outerHTML)
    .join("");
  return styles + doc.body.innerHTML;
}

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
