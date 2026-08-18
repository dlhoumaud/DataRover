/**
 * Thrown when an expression cannot be tokenized or parsed: unexpected
 * characters, unterminated string literals, malformed operators, or
 * leftover tokens after a complete expression has been parsed.
 */
export class ExpressionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionSyntaxError";
    Object.setPrototypeOf(this, ExpressionSyntaxError.prototype);
  }
}

/**
 * Thrown when a syntactically valid expression cannot be evaluated:
 * applying an operator to incompatible operands, or any other failure
 * that occurs while walking a valid AST against a given context.
 */
export class ExpressionEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionEvaluationError";
    Object.setPrototypeOf(this, ExpressionEvaluationError.prototype);
  }
}
