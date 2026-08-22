import { candidateSelectors } from "@datarover/browser-scripts";

/**
 * Builds the script installed via `page.addInitScript` (see `session-live.gateway.ts`) so it's
 * re-injected on every new document — including a navigation the user's own recorded click
 * triggers, not just the very first page load. Recording itself is gated on
 * `window.__datarover_recording__` (toggled from the server side via `page.evaluate` in response
 * to `"startRecording"`/`"stopRecording"` client messages — see the gateway for the one known gap
 * this leaves: that flag resets to `false` on every fresh document, so a navigation that happens
 * *while* recording is active needs the gateway to re-arm it once the new document is ready).
 *
 * Records semantic actions:
 * - `click` on any element.
 * - `select` (a `<select>`'s `change` event).
 * - `type` — accumulated per field and only emitted on blur (`focusout`), with the field's final
 *   value, never one step per keystroke; matches `BrowserActionStepSchema`'s `type` step, which is
 *   itself replayed character-by-character at *execution* time regardless of how it was recorded.
 * - `press` — **every** key, everywhere, including inside a text field — deliberately overlapping
 *   with `type` above (a character typed into a field ends up recorded both as its own `press`
 *   *and* folded into that field's aggregate `type` on blur): a first cut that only recorded
 *   non-printable keys (Enter/Tab/Escape/arrows/…) inside a field, on the reasoning that a plain
 *   character was already covered by `type`, left `press` looking like it "didn't detect" typing
 *   at all from inside a field — explicitly asked for again after that first cut shipped, so
 *   exhaustive capture wins over de-duplication here. Only pure modifier keys (Shift/Control/Alt/
 *   Meta/CapsLock/…) pressed on their own are never recorded standalone — meaningless as their
 *   own replay step.
 * - `moveMouse` — debounced to wherever the pointer comes to rest (`MOUSE_MOVE_SETTLE_MS`), the
 *   same "settle, then emit one step" shape `scrollPage` and `type` already use, rather than one
 *   step per `mousemove` event (there can be dozens per second during a real drag).
 * - `scrollPage` — debounced to the page's final resting position (same "settle, then emit one
 *   step" shape as `type`'s blur-based debounce) rather than one step per `scroll` event, which
 *   fires far too often during a single scroll gesture to record verbatim.
 * - `hover` — only after the pointer *dwells* on one element past `HOVER_DWELL_MS`, not on every
 *   `mouseover`/`mouseout` pair a normal pointer path crosses on its way to actually clicking
 *   something — e.g. to open a hover-triggered menu deliberately, per this step's own schema
 *   comment, not to narrate every element the cursor happened to pass over. `<body>`/`<html>`
 *   themselves are excluded outright: the cursor is *always* resting over one of them whenever
 *   it isn't over a smaller element, so without this exclusion, simply leaving the pointer alone
 *   for `HOVER_DWELL_MS` anywhere on the page — including right after any other action — would
 *   itself count as a "hover", which was never a real, deliberate interaction.
 *
 * Passed to `page.addInitScript` as a raw string (not a function) specifically so it can embed
 * `candidateSelectors`'s own source via `.toString()` — see that function's doc comment in
 * `@datarover/browser-scripts` for why this is safe, and `apps/web/src/lib/htmlSandbox.ts` for the
 * other call site doing the exact same embedding.
 */
export function buildRecorderInitScript(): string {
  return `
(function () {
  var candidateSelectors = (${candidateSelectors.toString()});
  var SCROLL_SETTLE_MS = 400;
  var HOVER_DWELL_MS = 600;
  var MOUSE_MOVE_SETTLE_MS = 250;
  var MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock", "OS"];
  // Only worth the extra document.querySelectorAll calls (see refineByExcludingAncestorClass
  // below) once a candidate is ALREADY down to a small, plausible set — never on something like a
  // bare ".full-width" matching 200+ elements site-wide, where no amount of ancestor-diffing will
  // ever produce a sane, narrow-enough exclusion selector anyway.
  var ANCESTOR_REFINEMENT_MAX_MATCHES = 20;
  var ANCESTOR_REFINEMENT_MAX_DEPTH = 8;

  /** el's own ancestor chain, immediate parent first, stopping at (and including) <body>, or
   *  after ANCESTOR_REFINEMENT_MAX_DEPTH levels — whichever comes first. */
  function ancestorChain(el) {
    var chain = [];
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < ANCESTOR_REFINEMENT_MAX_DEPTH) {
      chain.push(node);
      if (node.tagName && node.tagName.toLowerCase() === "body") break;
      node = node.parentElement;
      depth++;
    }
    return chain;
  }

  /** A last refinement for a candidate that's ALMOST right but still resolves to a handful of
   *  elements — the recurring real-world shape being a carousel library (slick.js and friends)
   *  that clones a slide's ENTIRE markup verbatim for a seamless infinite-loop effect: the cloned
   *  \`<img>\` itself ends up byte-for-byte identical to the real one (same class, same src, same
   *  alt — no combination of the target element's OWN attributes can ever tell them apart), but
   *  the CLONE's slide *wrapper* usually carries an extra marker class (e.g. "slick-cloned") the
   *  real one doesn't. Compares \`el\`'s ancestor chain against each of the other matches', depth by
   *  depth; the first depth where some other match's ancestor has a class \`el\`'s own
   *  same-depth ancestor lacks becomes a \`tag.elOwnClasses:not(.extraClass)\` scope, combined with
   *  \`candidate\` via a plain descendant combinator (safe here specifically because \`candidate\`
   *  itself already narrows the page down to this small \`matches\` set — see the caller's own
   *  size cap). Requires \`el\`'s ancestor at that depth to have at least one class of its own to
   *  scope on; a depth with no class anywhere is skipped, not treated as a match. */
  function refineByExcludingAncestorClass(candidate, el, matches) {
    var others = [];
    for (var m = 0; m < matches.length; m++) {
      if (matches[m] !== el) others.push(matches[m]);
    }
    var elChain = ancestorChain(el);
    for (var d = 0; d < elChain.length; d++) {
      var elAncestor = elChain[d];
      var elClasses = Array.prototype.slice.call(elAncestor.classList);
      if (elClasses.length === 0) continue;
      for (var o = 0; o < others.length; o++) {
        var otherChain = ancestorChain(others[o]);
        var otherAncestor = otherChain[d];
        if (!otherAncestor) continue;
        for (var c = 0; c < otherAncestor.classList.length; c++) {
          var extraClass = otherAncestor.classList[c];
          if (elClasses.indexOf(extraClass) !== -1) continue;
          var scope = elAncestor.tagName.toLowerCase() + "." + elClasses.join(".") + ":not(." + extraClass + ")";
          var refined = scope + " " + candidate;
          try {
            var refinedMatches = document.querySelectorAll(refined);
            if (refinedMatches.length === 1 && refinedMatches[0] === el) {
              return refined;
            }
          } catch (e) {
            // Invalid/unsupported selector syntax in this browser — skip it.
          }
        }
      }
    }
    return null;
  }

  // candidateSelectors() deliberately never validates its own candidates (see its doc comment) —
  // it's an ORDERED list of guesses, not a ranked/verified result. Blindly taking candidates[0]
  // used to be a real production bug: on a page using a common utility-class framework, an
  // element's "clean own classes" candidate (e.g. ".full-width") can resolve to hundreds of other
  // elements sharing that same utility class, so a later replay's locator.click/hover on it hits
  // Playwright's strict-mode violation instead of the one element actually recorded. Validate each
  // candidate against the live DOM and commit to the first one that resolves to exactly this
  // element and no other; when a candidate comes close (a small handful of matches, not hundreds),
  // try narrowing it further via refineByExcludingAncestorClass before giving up on it. If nothing
  // resolves (rare — even the anchored-path last resort isn't guaranteed unique, e.g. two literal
  // DOM clones with identical markup all the way up, which no selector can ever tell apart), fall
  // back to the last candidate anyway rather than recording nothing, since anchoredPathSelector is
  // still the most specific guess candidateSelectors produces.
  function pickSelector(el) {
    var candidates = candidateSelectors(el);
    for (var i = 0; i < candidates.length; i++) {
      try {
        var matches = document.querySelectorAll(candidates[i]);
        if (matches.length === 1 && matches[0] === el) {
          return candidates[i];
        }
        if (matches.length > 1 && matches.length <= ANCESTOR_REFINEMENT_MAX_MATCHES) {
          var refined = refineByExcludingAncestorClass(candidates[i], el, matches);
          if (refined) return refined;
        }
      } catch (e) {
        // Invalid/unsupported selector syntax in this browser — skip it.
      }
    }
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }

  function record(step) {
    if (!window.__datarover_recording__ || !window.__datarover_record__) return;
    window.__datarover_record__(JSON.stringify(step));
  }

  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (!target || target.nodeType !== 1) return;
      var selector = pickSelector(target);
      if (!selector) return;
      record({ type: "click", selector: selector });
    },
    true,
  );

  document.addEventListener(
    "change",
    function (event) {
      var target = event.target;
      if (!target || target.tagName !== "SELECT") return;
      var selector = pickSelector(target);
      if (!selector) return;
      record({ type: "select", selector: selector, value: target.value });
    },
    true,
  );

  var pendingValues = new WeakMap();
  document.addEventListener(
    "focusin",
    function (event) {
      var target = event.target;
      if (!target) return;
      var tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        pendingValues.set(target, target.value);
      }
    },
    true,
  );

  document.addEventListener(
    "focusout",
    function (event) {
      var target = event.target;
      if (!target) return;
      var tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") return;
      var before = pendingValues.get(target);
      pendingValues.delete(target);
      if (before === undefined || target.value === before || target.value.length === 0) return;
      var selector = pickSelector(target);
      if (!selector) return;
      record({ type: "type", selector: selector, text: target.value });
    },
    true,
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (MODIFIER_KEYS.indexOf(event.key) !== -1) return;
      record({ type: "press", key: event.key });
    },
    true,
  );

  var moveMouseTimer = null;
  document.addEventListener(
    "mousemove",
    function (event) {
      if (moveMouseTimer) clearTimeout(moveMouseTimer);
      var x = event.clientX;
      var y = event.clientY;
      moveMouseTimer = setTimeout(function () {
        moveMouseTimer = null;
        record({ type: "moveMouse", x: x, y: y });
      }, MOUSE_MOVE_SETTLE_MS);
    },
    true,
  );

  var scrollTimer = null;
  window.addEventListener(
    "scroll",
    function () {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        scrollTimer = null;
        record({ type: "scrollPage", x: window.scrollX, y: window.scrollY });
      }, SCROLL_SETTLE_MS);
    },
    true,
  );

  var hoverTimer = null;
  var hoverTarget = null;
  document.addEventListener(
    "mouseover",
    function (event) {
      var target = event.target;
      if (
        !target ||
        target.nodeType !== 1 ||
        target === hoverTarget ||
        target === document.body ||
        target === document.documentElement
      ) {
        return;
      }
      hoverTarget = target;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        hoverTimer = null;
        var selector = pickSelector(target);
        if (selector) record({ type: "hover", selector: selector });
      }, HOVER_DWELL_MS);
    },
    true,
  );
  document.addEventListener(
    "mouseout",
    function () {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      hoverTarget = null;
    },
    true,
  );
})();
`;
}
