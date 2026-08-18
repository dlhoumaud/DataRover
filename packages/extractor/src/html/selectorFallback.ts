const NTH_PATTERN = /:nth-child|:nth-of-type/;

/**
 * Counts the number of combinators (child `>` or descendant ` `) present in
 * a CSS selector, ignoring whitespace that appears inside attribute selector
 * brackets (e.g. `[data-testid="add to cart"]`) or inside pseudo-class
 * arguments (e.g. `:nth-child(2n + 1)`), since those are not structural
 * combinators.
 */
function countCombinators(selector: string): number {
  const withoutAttributeSelectors = selector.replace(/\[[^\]]*\]/g, "");
  const withoutPseudoArgs = withoutAttributeSelectors.replace(
    /:[a-zA-Z-]+\([^)]*\)/g,
    "",
  );

  const childCombinators = (withoutPseudoArgs.match(/>/g) ?? []).length;

  const normalized = withoutPseudoArgs.replace(/\s*>\s*/g, ">").trim();
  const compoundParts = normalized.split(/\s+/).filter(Boolean);
  const descendantCombinators = Math.max(0, compoundParts.length - 1);

  return childCombinators + descendantCombinators;
}

/**
 * Scores a CSS selector's robustness on a 0-100 heuristic scale, used to
 * decide which selector in a fallback chain is the most resilient to markup
 * changes.
 *
 * Heuristic:
 * - +40 if it targets a `data-*` attribute (e.g. `[data-testid="..."]`).
 * - +25 if it targets an id (`#`).
 * - +15 if it is a stable class selector (contains `.` and no `nth-child`/`nth-of-type`).
 * - -30 if it relies on positional pseudo-classes (`:nth-child`, `:nth-of-type`).
 * - -10 per structural combinator (`>` or descendant space) beyond the first,
 *   since long selector chains are fragile to markup changes.
 *
 * The result is clamped to the [0, 100] range.
 */
export function scoreSelector(selector: string): number {
  let score = 0;

  const targetsDataAttribute =
    selector.includes("[data-testid") || selector.includes("[data-");
  if (targetsDataAttribute) {
    score += 40;
  }

  if (selector.includes("#")) {
    score += 25;
  }

  const hasPositionalPseudoClass = NTH_PATTERN.test(selector);
  if (selector.includes(".") && !hasPositionalPseudoClass) {
    score += 15;
  }

  if (hasPositionalPseudoClass) {
    score -= 30;
  }

  const combinatorCount = countCombinators(selector);
  score -= 10 * Math.max(0, combinatorCount - 1);

  return Math.min(100, Math.max(0, score));
}
