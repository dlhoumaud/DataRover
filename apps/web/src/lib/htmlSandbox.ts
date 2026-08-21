/**
 * Builds the sandboxed document injected into the picker iframe's `srcDoc`
 * (see PreviewSelector). This is the security boundary described in
 * Specs.md §6: HTML fetched from a target site is never trusted to run its
 * own script inside our app.
 *
 * - Every `<script>` element, inline event-handler attribute (`onclick`,
 *   `onerror`, ...), `javascript:` URL, and `<meta http-equiv="refresh">` is
 *   stripped before the document is ever assigned to `srcDoc`.
 * - A `<base>` tag is (re)injected so relative URLs still resolve against
 *   the real page (used by anything this module doesn't proxy, e.g. plain
 *   links).
 * - Every `<img>` `src`/`srcset` is rewritten to go through the API's
 *   `/tools/preview-asset` proxy instead of loading directly from the
 *   target site — see rewriteImageSources's doc comment for why.
 * - Exactly one `<script>` is added back in: PICKER_SCRIPT below, which we
 *   author ourselves — never anything sourced from the fetched page.
 *
 * The iframe itself must be rendered with `sandbox="allow-scripts"` and
 * WITHOUT `allow-same-origin` (see PreviewSelector) so PICKER_SCRIPT
 * runs in an opaque origin: even a handler that slipped through
 * sanitization could not reach the app's cookies/storage or its parent
 * window directly. Communication back to the parent goes exclusively
 * through `postMessage`, verified there via `event.source ===
 * iframe.contentWindow` rather than `event.origin` (which is `"null"` for
 * an opaque origin).
 */

import { candidateSelectors } from "@datarover/browser-scripts";
import { API_BASE_URL } from "../api/client";

const JAVASCRIPT_URL_PATTERN = /^\s*javascript:/i;
const URL_ATTRIBUTES = new Set(["href", "src"]);

function stripDangerousContent(doc: Document): void {
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    script.remove();
  }

  for (const meta of Array.from(doc.querySelectorAll("meta[http-equiv]"))) {
    if (meta.getAttribute("http-equiv")?.toLowerCase() === "refresh") {
      meta.remove();
    }
  }

  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && JAVASCRIPT_URL_PATTERN.test(attr.value)) {
        element.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Resolves `rawUrl` against `baseUrl` and points it at the API's asset proxy instead of the
 * target site directly.
 *
 * Real-world finding (verified against a live site, not a guess): several image CDNs block
 * requests made from the preview iframe's context — even though the exact same URL, fetched by
 * our own backend's HTTP client, succeeds without issue. Routing through `/tools/preview-asset`
 * (which fetches server-side, exactly like `preview-html` already does for the page itself) makes
 * the preview reliable regardless of what a given target site's CDN does or doesn't allow from an
 * iframe. Returns `null` when `rawUrl` can't be parsed as a URL at all (left untouched by the
 * caller in that case).
 */
function assetProxyUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const absolute = new URL(rawUrl, baseUrl).toString();
    return `${API_BASE_URL}/tools/preview-asset?url=${encodeURIComponent(absolute)}`;
  } catch {
    return null;
  }
}

function rewriteSrcset(value: string, baseUrl: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        return trimmed;
      }
      const spaceIndex = trimmed.indexOf(" ");
      const rawUrl = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
      const descriptor = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex);
      const proxied = assetProxyUrl(rawUrl, baseUrl);
      return proxied ? `${proxied}${descriptor}` : trimmed;
    })
    .join(", ");
}

/**
 * Rewrites every `<img>`'s `src`/`srcset` to go through the asset proxy (see assetProxyUrl).
 * Skipped entirely when `baseUrl` is unavailable — there would be nothing safe to resolve a
 * relative `src` against. Known limitation: CSS background images (`background: url(...)` in a
 * `<style>` block or inline `style` attribute) are not rewritten and still load directly from the
 * target site, so they remain subject to the same CDN blocking this function works around for
 * `<img>` — acceptable for now since Specs.md §6's preview is about picking elements, not
 * pixel-perfect visual fidelity.
 */
function rewriteImageSources(doc: Document, baseUrl: string | undefined): void {
  if (!baseUrl) {
    return;
  }
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const rawSrc = img.getAttribute("src");
    if (rawSrc) {
      const proxied = assetProxyUrl(rawSrc, baseUrl);
      if (proxied) {
        img.setAttribute("src", proxied);
      }
    }
    const rawSrcset = img.getAttribute("srcset");
    if (rawSrcset) {
      img.setAttribute("srcset", rewriteSrcset(rawSrcset, baseUrl));
    }
  }
}

function ensureBase(doc: Document, baseUrl: string | undefined): void {
  let head = doc.head;
  if (!head) {
    head = doc.createElement("head");
    doc.documentElement.insertBefore(head, doc.body);
  }

  for (const existing of Array.from(head.querySelectorAll("base"))) {
    existing.remove();
  }

  if (!baseUrl) {
    return;
  }
  const base = doc.createElement("base");
  base.setAttribute("href", baseUrl);
  head.insertBefore(base, head.firstChild);
}

/**
 * Message posted from inside the sandboxed iframe to the parent window
 * when the user clicks a previewed element. `selectors` is an ordered list
 * of plausible CSS selector candidates computed client-side (id, data-*
 * attributes, own class, parent+own class, and a positional fallback) —
 * the parent is responsible for asking the real backend
 * (`useTestSelector`, which delegates to `@datarover/extractor`'s
 * `scoreSelector`) to score and validate them. This script never invents a
 * robustness score itself.
 */
export interface ElementSelectedMessage {
  source: "datarover-html-preview";
  type: "element-selected";
  selectors: string[];
  tagName: string;
  textPreview: string;
}

export function isElementSelectedMessage(value: unknown): value is ElementSelectedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).source === "datarover-html-preview" &&
    (value as Record<string, unknown>).type === "element-selected"
  );
}

const PICKER_SCRIPT = `
(function () {
  var HIGHLIGHT_STYLE = "2px solid #6366f1";
  var hovered = null;

  // Shared with apps/browser-worker's live-session recorder — see @datarover/browser-scripts'
  // candidateSelectors.ts for the actual algorithm and why embedding its source via
  // \`.toString()\` (rather than a second hand-written copy) is safe here.
  var candidateSelectors = (${candidateSelectors.toString()});

  document.addEventListener(
    "mouseover",
    function (event) {
      if (hovered && hovered.style) hovered.style.outline = "";
      hovered = event.target;
      if (hovered && hovered.style) hovered.style.outline = HIGHLIGHT_STYLE;
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    function (event) {
      if (event.target && event.target.style) event.target.style.outline = "";
    },
    true,
  );

  document.addEventListener(
    "click",
    function (event) {
      event.preventDefault();
      event.stopPropagation();
      var target = event.target;
      if (!target || target.nodeType !== 1) return;
      window.parent.postMessage(
        {
          source: "datarover-html-preview",
          type: "element-selected",
          selectors: candidateSelectors(target),
          tagName: target.tagName.toLowerCase(),
          textPreview: (target.textContent || "").trim().slice(0, 80),
        },
        "*",
      );
    },
    true,
  );
})();
`;

/**
 * Sanitizes `html`, injects a `<base href="baseUrl">` (skipped when
 * `baseUrl` is undefined — e.g. the http node's URL still contains an
 * unresolved `{{ }}` expression the frontend can't interpolate itself),
 * and appends PICKER_SCRIPT. Returns a full document string suitable for
 * an iframe's `srcDoc`.
 */
export function buildSandboxedDocument(html: string, baseUrl: string | undefined): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  stripDangerousContent(doc);
  rewriteImageSources(doc, baseUrl);
  ensureBase(doc, baseUrl);

  const script = doc.createElement("script");
  script.textContent = PICKER_SCRIPT;
  (doc.body ?? doc.documentElement).appendChild(script);

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
