import { resolvePath } from "./context.js";
import type { ExpressionContext } from "./context.js";
import { ExpressionEvaluationError } from "./errors.js";
import { parse } from "./parser.js";
import type { AstNode, ComparisonOperator } from "./parser.js";
import { tokenize } from "./tokenizer.js";

type OrderingOperator = "<" | ">" | "<=" | ">=";

/**
 * Evaluates a single AST node against a context. This is a pure tree
 * walk: no branch of it ever hands source text to `eval`, `new
 * Function`, or any other dynamic-code-execution mechanism — every
 * operator is implemented as plain TypeScript logic below.
 *
 * - `Literal` nodes return their baked-in value as-is.
 * - `Identifier` nodes resolve their raw path against `context` via
 *   {@link resolvePath} (from `./context`).
 * - `UnaryExpression` (`!`) coerces its operand to boolean and negates it.
 * - `LogicalExpression` (`&&` / `||`) short-circuits exactly like plain
 *   JavaScript: `a && b` evaluates and returns `a` when `a` is falsy
 *   (never evaluating `b`), otherwise returns `b`; `a || b` returns `a`
 *   when `a` is truthy (never evaluating `b`), otherwise returns `b`.
 * - `BinaryExpression` applies one of `< > <= >= == === != !==`.
 */
export function evaluateAst(ast: AstNode, context: ExpressionContext): unknown {
  switch (ast.type) {
    case "Literal":
      return ast.value;

    case "Identifier":
      return resolvePath(context, ast.name);

    case "UnaryExpression":
      return !toBoolean(evaluateAst(ast.argument, context));

    case "LogicalExpression": {
      const left = evaluateAst(ast.left, context);
      if (ast.operator === "&&") {
        return toBoolean(left) ? evaluateAst(ast.right, context) : left;
      }
      return toBoolean(left) ? left : evaluateAst(ast.right, context);
    }

    case "BinaryExpression": {
      const left = evaluateAst(ast.left, context);
      const right = evaluateAst(ast.right, context);
      return applyComparison(ast.operator, left, right);
    }

    default: {
      const exhaustive: never = ast;
      throw new ExpressionEvaluationError(`Unsupported AST node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Tokenizes, parses, and evaluates an expression string against a
 * context in one call. Returns the raw evaluated value (which may be of
 * any type: number, string, boolean, object, `undefined`, ...).
 *
 * @throws {ExpressionSyntaxError} If `expr` cannot be tokenized or parsed.
 * @throws {ExpressionEvaluationError} If a valid AST cannot be evaluated.
 */
export function evaluateExpression(expr: string, context: ExpressionContext): unknown {
  const tokens = tokenize(expr);
  const ast = parse(tokens);
  return evaluateAst(ast, context);
}

/**
 * Evaluates an expression and coerces the result to a boolean using
 * standard JavaScript truthiness. `undefined` and `null` results (e.g.
 * from a path that does not resolve to anything) are treated as `false`.
 */
export function evaluateCondition(expr: string, context: ExpressionContext): boolean {
  const result = evaluateExpression(expr, context);
  return toBoolean(result);
}

/** Standard JavaScript truthy coercion, implemented without relying on `Boolean(...)`. */
function toBoolean(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0 && !Number.isNaN(value);
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  // Objects and arrays (including empty ones) are always truthy in JavaScript.
  return true;
}

function applyComparison(operator: ComparisonOperator, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "<":
    case ">":
    case "<=":
    case ">=":
      return compareOrdered(operator, left, right);
    case "==":
      return looseEquals(left, right);
    case "===":
      return strictEquals(left, right);
    case "!=":
      return !looseEquals(left, right);
    case "!==":
      return !strictEquals(left, right);
    default: {
      const exhaustive: never = operator;
      throw new ExpressionEvaluationError(`Unsupported comparison operator: ${String(exhaustive)}`);
    }
  }
}

function compareOrdered(operator: OrderingOperator, left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return compareValues(operator, left, right);
  }
  return compareValues(operator, toNumber(left), toNumber(right));
}

function compareValues<T extends number | string>(operator: OrderingOperator, left: T, right: T): boolean {
  switch (operator) {
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
    default: {
      const exhaustive: never = operator;
      throw new ExpressionEvaluationError(`Unsupported ordering operator: ${String(exhaustive)}`);
    }
  }
}

function strictEquals(left: unknown, right: unknown): boolean {
  return left === right;
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  const leftIsNullish = left === null || left === undefined;
  const rightIsNullish = right === null || right === undefined;
  if (leftIsNullish || rightIsNullish) {
    return leftIsNullish && rightIsNullish;
  }

  const leftType = typeof left;
  const rightType = typeof right;
  const isPrimitive = (type: string): boolean => type === "number" || type === "boolean" || type === "string";

  if (isPrimitive(leftType) && isPrimitive(rightType)) {
    return toNumber(left) === toNumber(right);
  }

  return false;
}

/** Coerces a resolved value to a number for numeric comparison, mirroring JS's relational-operator coercion. */
function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  if (value === null) {
    return 0;
  }
  return Number.NaN;
}
