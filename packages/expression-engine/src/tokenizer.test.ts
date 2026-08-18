import { describe, expect, it } from "vitest";
import { ExpressionSyntaxError } from "./errors.js";
import { tokenize } from "./tokenizer.js";
import type { Token } from "./tokenizer.js";

function values(tokens: Token[]): string[] {
  return tokens.map((token) => token.value);
}

function types(tokens: Token[]): string[] {
  return tokens.map((token) => token.type);
}

describe("tokenize", () => {
  it("tokenizes a dotted identifier path", () => {
    const tokens = tokenize("global.baseUrl");
    expect(types(tokens)).toEqual(["Identifier"]);
    expect(values(tokens)).toEqual(["global.baseUrl"]);
  });

  it("tokenizes a path with array indices", () => {
    const tokens = tokenize("actions.extract.output.prices[0]");
    expect(types(tokens)).toEqual(["Identifier"]);
    expect(values(tokens)).toEqual(["actions.extract.output.prices[0]"]);
  });

  it("tokenizes integers and floats", () => {
    const tokens = tokenize("42 3.14");
    expect(types(tokens)).toEqual(["Number", "Number"]);
    expect(values(tokens)).toEqual(["42", "3.14"]);
  });

  it("tokenizes single- and double-quoted strings", () => {
    const tokens = tokenize(`'hello' "world"`);
    expect(types(tokens)).toEqual(["String", "String"]);
    expect(values(tokens)).toEqual(["hello", "world"]);
  });

  it("processes basic escape sequences inside strings", () => {
    const tokens = tokenize(String.raw`'a\'b' "c\"d" 'line\nbreak'`);
    expect(values(tokens)).toEqual(["a'b", 'c"d', "line\nbreak"]);
  });

  it("tokenizes true, false, null, and undefined as identifiers", () => {
    const tokens = tokenize("true false null undefined");
    expect(types(tokens)).toEqual(["Identifier", "Identifier", "Identifier", "Identifier"]);
    expect(values(tokens)).toEqual(["true", "false", "null", "undefined"]);
  });

  it("tokenizes all comparison and logical operators", () => {
    const tokens = tokenize("< > <= >= == === != !== && || !");
    expect(types(tokens)).toEqual(new Array<string>(11).fill("Operator"));
    expect(values(tokens)).toEqual(["<", ">", "<=", ">=", "==", "===", "!=", "!==", "&&", "||", "!"]);
  });

  it("prefers the longest matching operator", () => {
    expect(values(tokenize("==="))).toEqual(["==="]);
    expect(values(tokenize("!=="))).toEqual(["!=="]);
    expect(values(tokenize("=="))).toEqual(["=="]);
    expect(values(tokenize("!="))).toEqual(["!="]);
  });

  it("tokenizes parentheses and commas", () => {
    const tokens = tokenize("(a, b)");
    expect(types(tokens)).toEqual(["LParen", "Identifier", "Comma", "Identifier", "RParen"]);
  });

  it("skips whitespace between tokens", () => {
    const tokens = tokenize("  item.price   <   global.targetPrice  ");
    expect(values(tokens)).toEqual(["item.price", "<", "global.targetPrice"]);
  });

  it("tokenizes a full comparison expression", () => {
    const tokens = tokenize("item.price < global.targetPrice && item.available === true");
    expect(values(tokens)).toEqual([
      "item.price",
      "<",
      "global.targetPrice",
      "&&",
      "item.available",
      "===",
      "true",
    ]);
  });

  it("throws ExpressionSyntaxError on an unexpected character", () => {
    expect(() => tokenize("item.price % 2")).toThrow(ExpressionSyntaxError);
    expect(() => tokenize("a @ b")).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on an unterminated string literal", () => {
    expect(() => tokenize("'unterminated")).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on a lone & or |", () => {
    expect(() => tokenize("a & b")).toThrow(ExpressionSyntaxError);
    expect(() => tokenize("a | b")).toThrow(ExpressionSyntaxError);
  });

  it("returns an empty array for an empty string", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});
