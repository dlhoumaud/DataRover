import { describe, expect, it } from "vitest";
import { ExpressionSyntaxError } from "./errors.js";
import { parse } from "./parser.js";
import { tokenize } from "./tokenizer.js";

function parseExpr(source: string) {
  return parse(tokenize(source));
}

describe("parse", () => {
  it("parses a number literal", () => {
    expect(parseExpr("42")).toEqual({ type: "Literal", value: 42 });
    expect(parseExpr("3.14")).toEqual({ type: "Literal", value: 3.14 });
  });

  it("parses a string literal", () => {
    expect(parseExpr(`'hello'`)).toEqual({ type: "Literal", value: "hello" });
  });

  it("parses true, false, null, and undefined as literals", () => {
    expect(parseExpr("true")).toEqual({ type: "Literal", value: true });
    expect(parseExpr("false")).toEqual({ type: "Literal", value: false });
    expect(parseExpr("null")).toEqual({ type: "Literal", value: null });
    expect(parseExpr("undefined")).toEqual({ type: "Literal", value: undefined });
  });

  it("parses a bare path as an Identifier node carrying the raw path", () => {
    expect(parseExpr("actions.extract.output.prices[0]")).toEqual({
      type: "Identifier",
      name: "actions.extract.output.prices[0]",
    });
  });

  it("parses a comparison as a BinaryExpression", () => {
    expect(parseExpr("item.price < global.targetPrice")).toEqual({
      type: "BinaryExpression",
      operator: "<",
      left: { type: "Identifier", name: "item.price" },
      right: { type: "Identifier", name: "global.targetPrice" },
    });
  });

  it("parses && as a LogicalExpression", () => {
    expect(parseExpr("a && b")).toEqual({
      type: "LogicalExpression",
      operator: "&&",
      left: { type: "Identifier", name: "a" },
      right: { type: "Identifier", name: "b" },
    });
  });

  it("parses ! as a UnaryExpression", () => {
    expect(parseExpr("!item.available")).toEqual({
      type: "UnaryExpression",
      operator: "!",
      argument: { type: "Identifier", name: "item.available" },
    });
  });

  it("gives && higher precedence than ||", () => {
    // a && b || c  =>  (a && b) || c
    expect(parseExpr("a && b || c")).toEqual({
      type: "LogicalExpression",
      operator: "||",
      left: {
        type: "LogicalExpression",
        operator: "&&",
        left: { type: "Identifier", name: "a" },
        right: { type: "Identifier", name: "b" },
      },
      right: { type: "Identifier", name: "c" },
    });
  });

  it("gives comparisons higher precedence than &&", () => {
    // a < b && c > d  =>  (a < b) && (c > d)
    expect(parseExpr("a < b && c > d")).toEqual({
      type: "LogicalExpression",
      operator: "&&",
      left: { type: "BinaryExpression", operator: "<", left: { type: "Identifier", name: "a" }, right: { type: "Identifier", name: "b" } },
      right: { type: "BinaryExpression", operator: ">", left: { type: "Identifier", name: "c" }, right: { type: "Identifier", name: "d" } },
    });
  });

  it("gives ! higher precedence than comparisons", () => {
    // !a === b  =>  (!a) === b
    expect(parseExpr("!a === b")).toEqual({
      type: "BinaryExpression",
      operator: "===",
      left: { type: "UnaryExpression", operator: "!", argument: { type: "Identifier", name: "a" } },
      right: { type: "Identifier", name: "b" },
    });
  });

  it("parses parentheses to override precedence", () => {
    // a && (b || c)
    expect(parseExpr("a && (b || c)")).toEqual({
      type: "LogicalExpression",
      operator: "&&",
      left: { type: "Identifier", name: "a" },
      right: {
        type: "LogicalExpression",
        operator: "||",
        left: { type: "Identifier", name: "b" },
        right: { type: "Identifier", name: "c" },
      },
    });
  });

  it("parses the section-13 style expression from the spec", () => {
    const ast = parseExpr("item.price < global.targetPrice && item.available === true");
    expect(ast).toEqual({
      type: "LogicalExpression",
      operator: "&&",
      left: {
        type: "BinaryExpression",
        operator: "<",
        left: { type: "Identifier", name: "item.price" },
        right: { type: "Identifier", name: "global.targetPrice" },
      },
      right: {
        type: "BinaryExpression",
        operator: "===",
        left: { type: "Identifier", name: "item.available" },
        right: { type: "Literal", value: true },
      },
    });
  });

  it("throws ExpressionSyntaxError on an empty token stream", () => {
    expect(() => parse([])).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on leftover tokens after a complete expression", () => {
    expect(() => parseExpr("a b")).toThrow(ExpressionSyntaxError);
    expect(() => parseExpr("a && b c")).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on an unclosed parenthesis", () => {
    expect(() => parseExpr("(a && b")).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on a dangling operator", () => {
    expect(() => parseExpr("a &&")).toThrow(ExpressionSyntaxError);
    expect(() => parseExpr("<")).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on a stray comma or unexpected leading token", () => {
    expect(() => parseExpr(",")).toThrow(ExpressionSyntaxError);
    expect(() => parseExpr(")")).toThrow(ExpressionSyntaxError);
  });
});
