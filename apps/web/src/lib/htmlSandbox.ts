/**
 * Builds the sandboxed document injected into the picker iframe's `srcDoc`
 * (see HtmlPreviewSelector). This is the security boundary described in
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
 * WITHOUT `allow-same-origin` (see HtmlPreviewSelector) so PICKER_SCRIPT
 * runs in an opaque origin: even a handler that slipped through
 * sanitization could not reach the app's cookies/storage or its parent
 * window directly. Communication back to the parent goes exclusively
 * through `postMessage`, verified there via `event.source ===
 * iframe.contentWindow` rather than `event.origin` (which is `"null"` for
 * an opaque origin).
 */

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

  function escapeIdent(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function isCleanClass(name) {
    // Rejects class names that look auto-generated (hashed) rather than
    // author-written. A rough heuristic, not a guarantee: the backend's
    // real scoreSelector is the source of truth for robustness — this only
    // decides what is worth proposing as a candidate at all.
    if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name)) return false;
    if (name.length > 24) return false;
    if (/[0-9]{3,}/.test(name)) return false;
    return true;
  }

  function ownClasses(el) {
    return Array.from(el.classList || []).filter(isCleanClass);
  }

  function allClasses(el) {
    return Array.from(el.classList || []);
  }

  function escapedClassSelector(classes) {
    return "." + classes.map(escapeIdent).join(".");
  }

  function anchoredPathSelector(el) {
    // Positional fallback of last resort. Deliberately climbs only up to the NEAREST ancestor
    // that has an id or ANY class (checked without the isCleanClass filter — an auto-generated
    // CSS-module/styled-components hash like ".Product_root__a3f92" is still a far shorter, far
    // more robust anchor than continuing to climb all the way to <body>; this is exactly the kind
    // of class real component-framework sites use everywhere instead of semantic tags, which is
    // also why they tend to be the ones with no <p> at all), rather than walking all the way from
    // the clicked element to <body> every time: a long positional path depends on the exact shape
    // of the whole ancestor chain, and real-world markup is often quirky enough that a browser's
    // parser and the backend's extractor (a different HTML parser) reconstruct slightly different
    // trees for it, silently breaking a long from-the-root path. A short path anchored on the
    // closest identifiable ancestor is far less exposed to that divergence, and is also just a
    // better selector on its own merits.
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== "html") {
      var tag = node.tagName.toLowerCase();
      var id = node.getAttribute("id");
      if (id && !/^[0-9]/.test(id)) {
        parts.unshift(tag + "#" + escapeIdent(id));
        break;
      }

      var classes = allClasses(node);
      var parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }

      if (classes.length > 0) {
        parts.unshift(tag + escapedClassSelector(classes));
        break;
      }

      var siblings = Array.from(parent.children).filter(function (child) {
        return child.tagName === node.tagName;
      });
      var index = siblings.indexOf(node) + 1;
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  function candidateSelectors(el) {
    var candidates = [];

    var id = el.getAttribute("id");
    if (id && !/^[0-9]/.test(id)) {
      candidates.push("#" + escapeIdent(id));
    }

    Array.from(el.attributes || []).forEach(function (attr) {
      if (attr.name.indexOf("data-") === 0 && attr.value && attr.value.indexOf('"') === -1) {
        candidates.push("[" + attr.name + '="' + attr.value + '"]');
      }
    });

    var own = ownClasses(el);
    if (own.length > 0) {
      candidates.push("." + own.join("."));
    }

    // Also propose the element's exact, full class list as-is — even when every class looks
    // auto-generated (a hash/CSS-module name), it's still a real, working selector: better to
    // offer a "not pretty" candidate that matches than nothing at all, especially since this is
    // exactly the situation on generic-div-only sites (no p, no id, no data-*) driven by
    // component frameworks whose classes are near-universally hashed.
    var raw = allClasses(el);
    if (raw.length > 0) {
      var rawSelector = escapedClassSelector(raw);
      if (candidates.indexOf(rawSelector) === -1) {
        candidates.push(rawSelector);
      }
    }

    var parent = el.parentElement;
    if (parent) {
      var parentClasses = ownClasses(parent);
      if (parentClasses.length > 0 && own.length > 0) {
        candidates.push("." + parentClasses.join(".") + " ." + own.join("."));
      }
    }

    candidates.push(anchoredPathSelector(el));

    return candidates.filter(function (value, index) {
      return value && candidates.indexOf(value) === index;
    });
  }

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
