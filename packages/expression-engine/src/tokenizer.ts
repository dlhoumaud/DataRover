import { ExpressionSyntaxError } from "./errors.js";

/**
 * The kinds of tokens the expression tokenizer can emit.
 *
 * `Identifier` covers both dotted/indexed context paths (e.g.
 * `actions.login.output.token`, `item.prices[0]`) and the reserved
 * keywords `true`, `false`, `null`, `undefined` — the parser is
 * responsible for telling those apart, the tokenizer only recognizes the
 * character class they are made of.
 */
export type TokenType = "Identifier" | "Number" | "String" | "Operator" | "LParen" | "RParen" | "Comma";

/** A single lexical token produced by {@link tokenize}. */
export interface Token {
  type: TokenType;
  value: string;
  /** Zero-based offset of the token's first character in the source string. */
  position: number;
}

const WHITESPACE_PATTERN = /\s/;
const DIGIT_PATTERN = /[0-9]/;
const IDENTIFIER_START_PATTERN = /[A-Za-z_]/;
const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9_.[\]]/;

const THREE_CHAR_OPERATORS = new Set(["===", "!=="]);
const TWO_CHAR_OPERATORS = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
const ONE_CHAR_OPERATORS = new Set(["<", ">", "!"]);

/**
 * Splits an expression source string into a flat list of tokens.
 *
 * Supports: dotted/indexed identifiers, integer and floating point
 * numbers, single- or double-quoted strings (with `\\`, `\'`, `\"`, `\n`,
 * `\r`, `\t` escapes), the keywords `true`/`false`/`null`/`undefined`
 * (as plain identifier tokens), the comparison and logical operators
 * `< > <= >= == === != !== && || !`, parentheses, and commas.
 *
 * @throws {ExpressionSyntaxError} On an unrecognized character, an
 * unterminated string literal, or an incomplete operator (e.g. a lone
 * `&` or `|`).
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const length = input.length;
  let i = 0;

  while (i < length) {
    const char = input[i] as string;

    if (WHITESPACE_PATTERN.test(char)) {
      i += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "LParen", value: "(", position: i });
      i += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "RParen", value: ")", position: i });
      i += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "Comma", value: ",", position: i });
      i += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      const result = readString(input, i, char);
      tokens.push({ type: "String", value: result.value, position: i });
      i = result.next;
      continue;
    }

    if (DIGIT_PATTERN.test(char)) {
      const result = readNumber(input, i);
      tokens.push({ type: "Number", value: result.value, position: i });
      i = result.next;
      continue;
    }

    if (IDENTIFIER_START_PATTERN.test(char)) {
      const result = readIdentifier(input, i);
      tokens.push({ type: "Identifier", value: result.value, position: i });
      i = result.next;
      continue;
    }

    if (char === "<" || char === ">" || char === "=" || char === "!" || char === "&" || char === "|") {
      const result = readOperator(input, i);
      tokens.push({ type: "Operator", value: result.value, position: i });
      i = result.next;
      continue;
    }

    throw new ExpressionSyntaxError(`Unexpected character "${char}" at position ${i}`);
  }

  return tokens;
}

interface ScanResult {
  value: string;
  next: number;
}

function readString(input: string, start: number, quote: string): ScanResult {
  const length = input.length;
  let i = start + 1;
  let value = "";

  while (i < length) {
    const char = input[i] as string;

    if (char === quote) {
      return { value, next: i + 1 };
    }

    if (char === "\\" && i + 1 < length) {
      value += unescapeChar(input[i + 1] as string);
      i += 2;
      continue;
    }

    value += char;
    i += 1;
  }

  throw new ExpressionSyntaxError(`Unterminated string literal starting at position ${start}`);
}

function unescapeChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
    default:
      return char;
  }
}

function readNumber(input: string, start: number): ScanResult {
  const length = input.length;
  let i = start;

  while (i < length && DIGIT_PATTERN.test(input[i] as string)) {
    i += 1;
  }

  if (i < length && input[i] === "." && i + 1 < length && DIGIT_PATTERN.test(input[i + 1] as string)) {
    i += 1;
    while (i < length && DIGIT_PATTERN.test(input[i] as string)) {
      i += 1;
    }
  }

  return { value: input.slice(start, i), next: i };
}

function readIdentifier(input: string, start: number): ScanResult {
  const length = input.length;
  let i = start;

  while (i < length && IDENTIFIER_PART_PATTERN.test(input[i] as string)) {
    i += 1;
  }

  return { value: input.slice(start, i), next: i };
}

function readOperator(input: string, start: number): ScanResult {
  const three = input.slice(start, start + 3);
  if (THREE_CHAR_OPERATORS.has(three)) {
    return { value: three, next: start + 3 };
  }

  const two = input.slice(start, start + 2);
  if (TWO_CHAR_OPERATORS.has(two)) {
    return { value: two, next: start + 2 };
  }

  const one = input.slice(start, start + 1);
  if (ONE_CHAR_OPERATORS.has(one)) {
    return { value: one, next: start + 1 };
  }

  throw new ExpressionSyntaxError(`Unexpected operator "${one}" at position ${start}`);
}
