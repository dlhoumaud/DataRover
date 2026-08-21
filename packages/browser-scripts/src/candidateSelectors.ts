/**
 * Computes an ordered list of plausible CSS selector candidates for `el`: its `#id` (if any and
 * not numeric-leading), every `data-*` attribute, its "clean" own classes (looks author-written,
 * not a hash), its full raw class list as a fallback, a parent-class + own-class combination, and
 * finally an ancestor-anchored positional path as the last resort. Never scores or validates these
 * — that's `packages/extractor`'s `scoreSelector`'s job, against a real document, once a candidate
 * has actually been chosen.
 *
 * Ported verbatim (same heuristics, same order) from what was previously a single inline copy in
 * `apps/web/src/lib/htmlSandbox.ts`'s sandboxed iframe picker script. Extracted here specifically
 * so the exact same logic can also drive `apps/browser-worker`'s live-session action recorder,
 * without a second hand-maintained copy silently drifting from the first over time.
 *
 * Deliberately a SINGLE function with every helper nested inside it — none of them reference
 * anything outside their own parameters — because of how this gets *used*, not just how it's
 * tested:
 * - `apps/browser-worker` hands this function straight to Playwright's `page.addInitScript`/
 *   `page.evaluate`, which serializes a plain function via `Function.prototype.toString()` and
 *   re-parses the result inside the page — that only produces valid, self-contained code when the
 *   function has no closure over an outer scope.
 * - `apps/web/src/lib/htmlSandbox.ts` reuses it the same way, embedding
 *   `` `(${candidateSelectors.toString()})` `` directly into its own hand-authored picker script
 *   string (its sandboxed iframe has no module loader to `import` this package into).
 *
 * Both call sites work from the same guarantee: this function still does the exact same thing
 * after being round-tripped through `.toString()` — bundler minification may rename its local
 * variables, but never introduces an external reference, so the round trip stays safe either way.
 */
export function candidateSelectors(el: Element): string[] {
  function escapeIdent(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /** Rejects class names that look auto-generated (hashed) rather than author-written. A rough
   *  heuristic, not a guarantee — see this module's own doc comment. */
  function isCleanClass(name: string): boolean {
    if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name)) {
      return false;
    }
    if (name.length > 24) {
      return false;
    }
    if (/[0-9]{3,}/.test(name)) {
      return false;
    }
    return true;
  }

  function ownClasses(node: Element): string[] {
    return Array.from(node.classList).filter(isCleanClass);
  }

  function allClasses(node: Element): string[] {
    return Array.from(node.classList);
  }

  function escapedClassSelector(classes: string[]): string {
    return "." + classes.map(escapeIdent).join(".");
  }

  /** Positional fallback of last resort — climbs only up to the NEAREST ancestor with an id or
   *  any class at all (unfiltered by isCleanClass — even a hashed CSS-module class is a far
   *  shorter, far more robust anchor than climbing all the way to <body>), rather than building a
   *  full root-to-target path every time. */
  function anchoredPathSelector(start: Element): string {
    const parts: string[] = [];
    let node: Element | null = start;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== "html") {
      const tag = node.tagName.toLowerCase();
      const id = node.getAttribute("id");
      if (id && !/^[0-9]/.test(id)) {
        parts.unshift(tag + "#" + escapeIdent(id));
        break;
      }

      const classes = allClasses(node);
      const parent: Element | null = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }

      if (classes.length > 0) {
        parts.unshift(tag + escapedClassSelector(classes));
        break;
      }

      const currentNode = node;
      const siblings = Array.from(parent.children).filter((child) => child.tagName === currentNode.tagName);
      const index = siblings.indexOf(node) + 1;
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  const candidates: string[] = [];

  const id = el.getAttribute("id");
  if (id && !/^[0-9]/.test(id)) {
    candidates.push("#" + escapeIdent(id));
  }

  Array.from(el.attributes).forEach((attr) => {
    if (attr.name.indexOf("data-") === 0 && attr.value && attr.value.indexOf('"') === -1) {
      candidates.push("[" + attr.name + '="' + attr.value + '"]');
    }
  });

  const own = ownClasses(el);
  if (own.length > 0) {
    candidates.push("." + own.join("."));
  }

  // The exact, full class list as-is — even when every class looks auto-generated, it's still a
  // real, working selector: a "not pretty" candidate that matches beats none at all, which is
  // exactly the situation on generic-div-only, component-framework-driven sites.
  const raw = allClasses(el);
  if (raw.length > 0) {
    const rawSelector = escapedClassSelector(raw);
    if (candidates.indexOf(rawSelector) === -1) {
      candidates.push(rawSelector);
    }
  }

  const parent = el.parentElement;
  if (parent) {
    const parentClasses = ownClasses(parent);
    if (parentClasses.length > 0 && own.length > 0) {
      candidates.push("." + parentClasses.join(".") + " ." + own.join("."));
    }
  }

  candidates.push(anchoredPathSelector(el));

  return candidates.filter((value, index) => Boolean(value) && candidates.indexOf(value) === index);
}
