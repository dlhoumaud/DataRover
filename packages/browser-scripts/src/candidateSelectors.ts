/**
 * Computes an ordered list of plausible CSS selector candidates for `el`: its `#id` (if any and
 * not numeric-leading), every `data-*` attribute, `href`/`src` (a link's destination or an image's
 * source is usually unique per element — see `IDENTITY_ATTRIBUTES` below), its own classes combined
 * with any of those same attributes (see the loop right after `ownClasses` below — a shared class
 * AND a shared attribute can each fail alone while their *combination* still narrows things down to
 * one), its "clean" own classes alone (looks author-written, not a hash), its full raw class list
 * as a fallback, then the more descriptive-but-less-reliably-unique
 * `name`/`alt`/`title`/`aria-label`/`placeholder` attributes alone (see `DESCRIPTIVE_ATTRIBUTES`),
 * a parent-class + own-class combination, and finally an ancestor-anchored positional path as the
 * last resort. Deliberately does NOT consider `style` (asked for explicitly once, when this list
 * still routinely produced non-unique candidates): it encodes appearance/position, not identity —
 * two unrelated elements sharing the same layout (`position:fixed;top:10px;left:10px`, say) is
 * normal and common, and a real element's own `style` is often mutated by page JS after load
 * anyway, unlike `href`/`src`/`id`/`class`.
 *
 * Still never *scores or validates* candidates itself (that's `packages/extractor`'s
 * `scoreSelector`'s job against a real document once a candidate has actually been chosen, for the
 * `extract` node's own selector-scoring path — see `apps/browser-worker`'s `recorderScript.ts` for
 * the OTHER validation this module feeds: picking the first candidate that resolves to exactly one
 * element on the live page, right here at recording time, since a whole *ordered list* of
 * plausible-but-unverified candidates is exactly what made a page's shared utility class
 * (`.full-width`) or repeated navigation class (`.nav-link.clickable2`) end up recorded as-is,
 * despite matching hundreds of elements — this broader attribute set, and the combined candidates
 * built from it, exist specifically so a genuinely distinguishing signal (a link's own `href`, or a
 * class *plus* a specific `title`) gets a chance to be tried at all, rather than only ever falling
 * back to an ancestor-anchored path once every single-attribute guess turns out non-unique).
 *
 * One case no amount of attribute-combining can ever fix, by construction: a carousel library
 * (e.g. slick.js) that clones a slide's entire markup verbatim for a seamless infinite-loop effect
 * produces two REAL DOM elements with byte-for-byte identical tag/class/`alt`/`src` — every
 * attribute this function knows about, individually or combined, matches both. Distinguishing them
 * needs positional information (which of two visually-identical nodes is "the real one" vs. the
 * clone), which is a different, harder problem this module doesn't attempt to solve.
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
  // Attributes that usually identify ONE specific element rather than a category of similar ones
  // — a link's destination, an image's source — so they're tried right after `id`/`data-*`,
  // ahead of any class-based guess.
  const IDENTITY_ATTRIBUTES = ["href", "src"];
  // Attributes that are meaningful but more likely to repeat across several similar elements (a
  // shared `placeholder`, several buttons with the same `title`) — tried after the class-based
  // candidates, not before, since they're a weaker uniqueness signal than those.
  const DESCRIPTIVE_ATTRIBUTES = ["name", "alt", "title", "aria-label", "placeholder"];
  // A `src`/`href` holding an inline `data:` URI can run to megabytes — technically still a valid
  // CSS attribute-equality selector, but a pointless, bloated one to ever record. No such cap
  // existed for `data-*` above; left alone rather than risking that already-relied-upon behavior.
  const MAX_ATTRIBUTE_VALUE_LENGTH = 300;

  /** The `[name="value"]` fragment alone (no tag/class prefix), or `null` when the attribute is
   *  missing/empty, its value contains a `"` (would break out of the selector's own quoting — same
   *  guard the `data-*` loop below already uses), or is implausibly long. Factored out from
   *  `attributeSelector` below so the exact same guard also backs the combined class+attribute
   *  candidates further down — every attribute-based candidate in this file goes through this one
   *  validation, never a second hand-rolled copy of it. */
  function attributeValueFragment(node: Element, name: string): string | null {
    const value = node.getAttribute(name);
    if (!value || value.indexOf('"') !== -1 || value.length > MAX_ATTRIBUTE_VALUE_LENGTH) {
      return null;
    }
    return "[" + name + '="' + value + '"]';
  }

  /** Tag-scoped attribute-equality selector (e.g. `a[href="..."]`). Scoped by tag name (unlike the
   *  bare `[data-*="..."]` candidates below) mainly for readability in the recorded workflow —
   *  `pickSelector`'s own uniqueness check doesn't depend on it either way. */
  function attributeSelector(node: Element, name: string): string | null {
    const fragment = attributeValueFragment(node, name);
    return fragment ? node.tagName.toLowerCase() + fragment : null;
  }

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

  IDENTITY_ATTRIBUTES.forEach((name) => {
    const selector = attributeSelector(el, name);
    if (selector) {
      candidates.push(selector);
    }
  });

  const own = ownClasses(el);
  if (own.length > 0) {
    const ownClassSelector = "." + own.join(".");
    // Neither a shared class NOR a shared attribute is unique on its own often enough — a whole
    // category of elements (every slider slide, every "badge" label) commonly reuses one class,
    // and the same is true of e.g. a repeated `title`/`alt` across several of them — but the
    // *combination* of "this class AND this exact attribute value" frequently narrows it down to
    // one, without needing anything as drastic as a full ancestor-anchored path. Tried before the
    // plain class alone: strictly more specific, so if it resolves at all it's a better pick.
    IDENTITY_ATTRIBUTES.concat(DESCRIPTIVE_ATTRIBUTES).forEach((name) => {
      const fragment = attributeValueFragment(el, name);
      if (fragment) {
        candidates.push(ownClassSelector + fragment);
      }
    });
    candidates.push(ownClassSelector);
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

  DESCRIPTIVE_ATTRIBUTES.forEach((name) => {
    const selector = attributeSelector(el, name);
    if (selector) {
      candidates.push(selector);
    }
  });

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
