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

  function pickSelector(el) {
    var candidates = candidateSelectors(el);
    return candidates.length > 0 ? candidates[0] : null;
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
