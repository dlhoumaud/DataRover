import type { ExpressionContext } from "./context.js";
import { evaluateExpression } from "./evaluator.js";

/** Matches the first `{{ ... }}` block in a string (non-greedy, spans newlines). */
const TEMPLATE_BLOCK_PATTERN = /\{\{([\s\S]*?)\}\}/;
/** Same pattern, global, for replacing every block in a larger string. */
const TEMPLATE_BLOCK_PATTERN_GLOBAL = /\{\{([\s\S]*?)\}\}/g;

/** Returns `true` if `value` contains at least one `{{ ... }}` template block. */
export function hasTemplate(value: string): boolean {
  return TEMPLATE_BLOCK_PATTERN.test(value);
}

/**
 * If `trimmed` is made of nothing but a single `{{ ... }}` block (no other
 * characters before or after it), returns that block's inner expression
 * source. Otherwise returns `undefined`.
 */
function matchSingleTemplateBlock(trimmed: string): string | undefined {
  const match = TEMPLATE_BLOCK_PATTERN.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  if (match.index !== 0 || match[0].length !== trimmed.length) {
    return undefined;
  }
  return match[1];
}

/**
 * Interpolates `{{ expr }}` blocks inside a single string.
 *
 * - If the entire string (after trimming) is exactly one `{{ expr }}`
 *   block with nothing else around it, the raw evaluated value is
 *   returned as-is (preserving its type: number, boolean, object, array,
 *   `undefined`, ...).
 * - Otherwise, every `{{ expr }}` occurrence found in the string is
 *   replaced by `String(evaluateExpression(expr, context))`, with
 *   `undefined` results replaced by the empty string, and the resulting
 *   string is returned.
 *
 * @throws {ExpressionSyntaxError} If any embedded expression fails to tokenize/parse.
 * @throws {ExpressionEvaluationError} If any embedded expression fails to evaluate.
 */
export function interpolateString(template: string, context: ExpressionContext): unknown {
  const trimmed = template.trim();
  const singleBlockExpression = matchSingleTemplateBlock(trimmed);
  if (singleBlockExpression !== undefined) {
    return evaluateExpression(singleBlockExpression.trim(), context);
  }

  return template.replace(TEMPLATE_BLOCK_PATTERN_GLOBAL, (_match: string, expr: string): string => {
    const value = evaluateExpression(expr.trim(), context);
    return value === undefined ? "" : String(value);
  });
}

/**
 * `true` for a plain data object (`{}` literal or `Object.create(null)`),
 * `false` for arrays, `null`, class instances, `Date`, `Map`, `RegExp`,
 * and other non-plain objects — those are left untouched by
 * {@link interpolate}.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively walks `value` and interpolates every string it finds:
 * - `string` → {@link interpolateString}.
 * - `array` → a new array with `interpolate` applied to each element.
 * - plain object → a new object with `interpolate` applied to each value
 *   (keys are left unchanged).
 * - anything else (numbers, booleans, `null`, `undefined`, `Date`,
 *   class instances, ...) is returned unchanged.
 */
export function interpolate(value: unknown, context: ExpressionContext): unknown {
  if (typeof value === "string") {
    return interpolateString(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, context));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      result[key] = interpolate(entryValue, context);
    }
    return result;
  }

  return value;
}
