import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExpressionContext } from "./context.js";
import { ExpressionSyntaxError } from "./errors.js";
import { evaluateCondition, evaluateExpression } from "./evaluator.js";
import { parse } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("evaluateExpression - literals and paths", () => {
  const context: ExpressionContext = {
    global: { targetPrice: 100 },
    item: { price: 50, available: true, name: "widget" },
  };

  it("evaluates number, string, boolean, null, and undefined literals", () => {
    expect(evaluateExpression("42", context)).toBe(42);
    expect(evaluateExpression("3.14", context)).toBe(3.14);
    expect(evaluateExpression(`'hello'`, context)).toBe("hello");
    expect(evaluateExpression("true", context)).toBe(true);
    expect(evaluateExpression("false", context)).toBe(false);
    expect(evaluateExpression("null", context)).toBeNull();
    expect(evaluateExpression("undefined", context)).toBeUndefined();
  });

  it("evaluates a bare path via resolvePath", () => {
    expect(evaluateExpression("item.price", context)).toBe(50);
    expect(evaluateExpression("global.targetPrice", context)).toBe(100);
  });

  it("evaluates an unresolvable path to undefined", () => {
    expect(evaluateExpression("item.doesNotExist", context)).toBeUndefined();
  });
});

describe("evaluateExpression - numeric and string comparisons", () => {
  it("compares numbers with all ordering operators", () => {
    expect(evaluateExpression("5 < 10", {})).toBe(true);
    expect(evaluateExpression("10 < 5", {})).toBe(false);
    expect(evaluateExpression("10 > 5", {})).toBe(true);
    expect(evaluateExpression("5 <= 5", {})).toBe(true);
    expect(evaluateExpression("5 >= 5", {})).toBe(true);
    expect(evaluateExpression("5 >= 6", {})).toBe(false);
  });

  it("compares strings lexicographically", () => {
    expect(evaluateExpression(`'apple' < 'banana'`, {})).toBe(true);
    expect(evaluateExpression(`'banana' < 'apple'`, {})).toBe(false);
    expect(evaluateExpression(`'apple' <= 'apple'`, {})).toBe(true);
  });

  it("applies loose equality with numeric coercion across types", () => {
    expect(evaluateExpression(`'5' == 5`, {})).toBe(true);
    expect(evaluateExpression("true == 1", {})).toBe(true);
    expect(evaluateExpression("false == 0", {})).toBe(true);
    expect(evaluateExpression("null == undefined", {})).toBe(true);
  });

  it("applies strict equality without coercion across types", () => {
    expect(evaluateExpression(`'5' === 5`, {})).toBe(false);
    expect(evaluateExpression("5 === 5", {})).toBe(true);
    expect(evaluateExpression(`'a' === 'a'`, {})).toBe(true);
  });

  it("applies inequality operators", () => {
    expect(evaluateExpression(`'5' != 5`, {})).toBe(false);
    expect(evaluateExpression(`'5' !== 5`, {})).toBe(true);
    expect(evaluateExpression("5 != 6", {})).toBe(true);
  });
});

describe("evaluateExpression - logical operators and short-circuiting", () => {
  it("implements && with JS-style value semantics (not just booleans)", () => {
    expect(evaluateExpression("false && true", {})).toBe(false);
    expect(evaluateExpression("null && true", {})).toBeNull();
    expect(evaluateExpression("1 && 2", {})).toBe(2);
  });

  it("implements || with JS-style value semantics", () => {
    expect(evaluateExpression("0 || 5", {})).toBe(5);
    expect(evaluateExpression("1 || 2", {})).toBe(1);
    expect(evaluateExpression("null || false", {})).toBe(false);
  });

  it("short-circuits && and never resolves the right operand when the left is falsy", () => {
    let evaluated = false;
    const context: ExpressionContext = {
      global: {
        get poison(): boolean {
          evaluated = true;
          return true;
        },
      },
    };
    expect(evaluateExpression("false && global.poison", context)).toBe(false);
    expect(evaluated).toBe(false);
  });

  it("evaluates the right operand of && when the left is truthy", () => {
    let evaluated = false;
    const context: ExpressionContext = {
      global: {
        get flag(): boolean {
          evaluated = true;
          return true;
        },
      },
    };
    expect(evaluateExpression("true && global.flag", context)).toBe(true);
    expect(evaluated).toBe(true);
  });

  it("short-circuits || and never resolves the right operand when the left is truthy", () => {
    let evaluated = false;
    const context: ExpressionContext = {
      global: {
        get poison(): boolean {
          evaluated = true;
          return true;
        },
      },
    };
    expect(evaluateExpression("true || global.poison", context)).toBe(true);
    expect(evaluated).toBe(false);
  });

  it("evaluates the right operand of || when the left is falsy", () => {
    let evaluated = false;
    const context: ExpressionContext = {
      global: {
        get flag(): boolean {
          evaluated = true;
          return true;
        },
      },
    };
    expect(evaluateExpression("false || global.flag", context)).toBe(true);
    expect(evaluated).toBe(true);
  });

  it("respects a && b || c precedence: (a && b) || c", () => {
    // false && true (=> false), false || true (=> true)
    expect(evaluateExpression("false && true || true", {})).toBe(true);
    // true && false (=> false), false || false (=> false)
    expect(evaluateExpression("true && false || false", {})).toBe(false);
  });
});

describe("evaluateExpression - unary negation", () => {
  it("negates truthy and falsy values into booleans", () => {
    expect(evaluateExpression("!true", {})).toBe(false);
    expect(evaluateExpression("!false", {})).toBe(true);
    expect(evaluateExpression("!0", {})).toBe(true);
    expect(evaluateExpression("!1", {})).toBe(false);
    expect(evaluateExpression("!null", {})).toBe(true);
    expect(evaluateExpression("!undefined", {})).toBe(true);
  });

  it("double negation coerces any value to a plain boolean", () => {
    expect(evaluateExpression(`!!'non-empty'`, {})).toBe(true);
    expect(evaluateExpression(`!!''`, {})).toBe(false);
  });
});

describe("evaluateExpression - complex expression from spec section 13", () => {
  it("evaluates `item.price < global.targetPrice && item.available === true` to true when both conditions hold", () => {
    const context: ExpressionContext = {
      global: { targetPrice: 100 },
      item: { price: 50, available: true },
    };
    expect(evaluateExpression("item.price < global.targetPrice && item.available === true", context)).toBe(true);
  });

  it("evaluates the same expression to false when the price condition fails", () => {
    const context: ExpressionContext = {
      global: { targetPrice: 100 },
      item: { price: 150, available: true },
    };
    expect(evaluateExpression("item.price < global.targetPrice && item.available === true", context)).toBe(false);
  });

  it("evaluates the same expression to false when the availability condition fails", () => {
    const context: ExpressionContext = {
      global: { targetPrice: 100 },
      item: { price: 50, available: false },
    };
    expect(evaluateExpression("item.price < global.targetPrice && item.available === true", context)).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("coerces a truthy expression result to true", () => {
    expect(evaluateCondition("1 < 2", {})).toBe(true);
    expect(evaluateCondition("'non-empty'", {})).toBe(true);
  });

  it("coerces a falsy expression result to false", () => {
    expect(evaluateCondition("2 < 1", {})).toBe(false);
    expect(evaluateCondition("0", {})).toBe(false);
    expect(evaluateCondition(`''`, {})).toBe(false);
  });

  it("treats an undefined or null result as false", () => {
    expect(evaluateCondition("item.doesNotExist", {})).toBe(false);
    expect(evaluateCondition("null", {})).toBe(false);
    expect(evaluateCondition("undefined", {})).toBe(false);
  });
});

describe("security: no dynamic code execution is possible", () => {
  it("rejects statement-separator injection with a syntax error instead of running anything", () => {
    expect(() => evaluateExpression("global.x; process.exit(1)", {})).toThrow(ExpressionSyntaxError);
  });

  it("rejects template-literal / backtick injection with a syntax error", () => {
    expect(() => evaluateExpression("`${global.x}`", {})).toThrow(ExpressionSyntaxError);
  });

  it("rejects function-call syntax entirely: there is no call grammar to exploit", () => {
    const context: ExpressionContext = { runtime: { evil: () => "pwned" } };
    expect(() => evaluateExpression("runtime.evil()", context)).toThrow(ExpressionSyntaxError);
  });

  it("never lets a path resolve to a live constructor/prototype object", () => {
    const context: ExpressionContext = { global: { x: 1 } };
    expect(evaluateExpression("global.constructor", context)).toBeUndefined();
    expect(evaluateExpression("global.constructor.constructor", context)).toBeUndefined();
  });

  it("rejects unknown operators/characters (e.g. bitwise or arithmetic symbols) with a syntax error", () => {
    expect(() => evaluateExpression("1 + 1", {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression("1 & 1", {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression("import('node:fs')", {})).toThrow(ExpressionSyntaxError);
  });

  it("produces a plain data AST with no functions anywhere in it", () => {
    const ast = parse(tokenize("item.price < global.targetPrice && item.available === true"));
    const seenFunctionValue = JSON.stringify(ast, (_key, value) => {
      if (typeof value === "function") {
        throw new Error("AST unexpectedly contains a function value");
      }
      return value;
    });
    expect(typeof seenFunctionValue).toBe("string");
  });

  it("never references eval or the Function constructor anywhere in the engine's own source", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const sourceFiles = ["context.ts", "errors.ts", "tokenizer.ts", "parser.ts", "evaluator.ts", "interpolate.ts", "index.ts"];
    for (const file of sourceFiles) {
      const content = readFileSync(join(currentDir, file), "utf8");
      expect(content).not.toMatch(/\beval\s*\(/);
      expect(content).not.toMatch(/new\s+Function\s*\(/);
    }
  });
});
