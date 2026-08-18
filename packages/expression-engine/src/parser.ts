import { ExpressionSyntaxError } from "./errors.js";
import type { Token } from "./tokenizer.js";

/** A literal value baked directly into the expression source. */
export type LiteralValue = string | number | boolean | null | undefined;

/** A literal AST node: a number, string, boolean, `null`, or `undefined`. */
export interface Literal {
  type: "Literal";
  value: LiteralValue;
}

/**
 * A context path AST node. `name` holds the full raw dotted/indexed path
 * exactly as written in the source (e.g. `"actions.login.output.token"`,
 * `"item.prices[0]"`) — it is resolved against an `ExpressionContext` by
 * the evaluator via `resolvePath`, never split further by the parser.
 */
export interface Identifier {
  type: "Identifier";
  name: string;
}

/** The comparison operators supported by {@link BinaryExpression}. */
export type ComparisonOperator = "<" | ">" | "<=" | ">=" | "==" | "===" | "!=" | "!==";

/** A comparison between two sub-expressions, e.g. `item.price < global.max`. */
export interface BinaryExpression {
  type: "BinaryExpression";
  operator: ComparisonOperator;
  left: AstNode;
  right: AstNode;
}

/** The logical operators supported by {@link LogicalExpression}. */
export type LogicalOperator = "&&" | "||";

/** A short-circuiting logical combination of two sub-expressions. */
export interface LogicalExpression {
  type: "LogicalExpression";
  operator: LogicalOperator;
  left: AstNode;
  right: AstNode;
}

/** Logical negation (`!expr`). */
export interface UnaryExpression {
  type: "UnaryExpression";
  operator: "!";
  argument: AstNode;
}

/** Any node produced by {@link parse}. */
export type AstNode = Literal | Identifier | BinaryExpression | LogicalExpression | UnaryExpression;

const COMPARISON_OPERATORS = new Set<string>(["<", ">", "<=", ">=", "==", "===", "!=", "!=="]);

/**
 * Recursive-descent parser over a token stream produced by `tokenize`.
 *
 * Grammar (lowest to highest precedence):
 * ```
 * logicalOr   := logicalAnd ( "||" logicalAnd )*
 * logicalAnd  := comparison ( "&&" comparison )*
 * comparison  := unary ( compOp unary )*
 * unary       := "!" unary | primary
 * primary     := "(" logicalOr ")" | Number | String | Identifier
 * ```
 */
class Parser {
  private readonly tokens: readonly Token[];
  private position = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  parseProgram(): AstNode {
    if (this.tokens.length === 0) {
      throw new ExpressionSyntaxError("Cannot parse an empty expression");
    }

    const node = this.parseLogicalOr();

    const trailing = this.peek();
    if (trailing !== undefined) {
      throw new ExpressionSyntaxError(`Unexpected token "${trailing.value}" at position ${trailing.position}`);
    }

    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private advance(): Token {
    const token = this.tokens[this.position];
    if (token === undefined) {
      throw new ExpressionSyntaxError("Unexpected end of expression");
    }
    this.position += 1;
    return token;
  }

  private isOperator(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.type === "Operator" && token.value === value;
  }

  private parseLogicalOr(): AstNode {
    let left = this.parseLogicalAnd();

    while (this.isOperator("||")) {
      this.advance();
      const right = this.parseLogicalAnd();
      left = { type: "LogicalExpression", operator: "||", left, right };
    }

    return left;
  }

  private parseLogicalAnd(): AstNode {
    let left = this.parseComparison();

    while (this.isOperator("&&")) {
      this.advance();
      const right = this.parseComparison();
      left = { type: "LogicalExpression", operator: "&&", left, right };
    }

    return left;
  }

  private parseComparison(): AstNode {
    let left = this.parseUnary();

    while (true) {
      const token = this.peek();
      if (token === undefined || token.type !== "Operator" || !COMPARISON_OPERATORS.has(token.value)) {
        break;
      }
      this.advance();
      const operator = token.value as ComparisonOperator;
      const right = this.parseUnary();
      left = { type: "BinaryExpression", operator, left, right };
    }

    return left;
  }

  private parseUnary(): AstNode {
    const token = this.peek();
    if (token !== undefined && token.type === "Operator" && token.value === "!") {
      this.advance();
      const argument = this.parseUnary();
      return { type: "UnaryExpression", operator: "!", argument };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    const token = this.peek();
    if (token === undefined) {
      throw new ExpressionSyntaxError("Unexpected end of expression");
    }

    if (token.type === "LParen") {
      this.advance();
      const node = this.parseLogicalOr();
      const closing = this.peek();
      if (closing === undefined || closing.type !== "RParen") {
        throw new ExpressionSyntaxError(`Expected ")" to match "(" at position ${token.position}`);
      }
      this.advance();
      return node;
    }

    if (token.type === "Number") {
      this.advance();
      return { type: "Literal", value: Number(token.value) };
    }

    if (token.type === "String") {
      this.advance();
      return { type: "Literal", value: token.value };
    }

    if (token.type === "Identifier") {
      this.advance();
      switch (token.value) {
        case "true":
          return { type: "Literal", value: true };
        case "false":
          return { type: "Literal", value: false };
        case "null":
          return { type: "Literal", value: null };
        case "undefined":
          return { type: "Literal", value: undefined };
        default:
          return { type: "Identifier", name: token.value };
      }
    }

    throw new ExpressionSyntaxError(`Unexpected token "${token.value}" at position ${token.position}`);
  }
}

/**
 * Parses a token stream (from `tokenize`) into an expression AST.
 *
 * @throws {ExpressionSyntaxError} On an empty token stream, an
 * unexpected token, an unclosed parenthesis, or leftover tokens after a
 * complete expression has been parsed (e.g. `"a; b"`, which is never
 * valid here since there is no statement separator in this grammar).
 */
export function parse(tokens: readonly Token[]): AstNode {
  return new Parser(tokens).parseProgram();
}
