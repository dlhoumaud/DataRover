import { describe, expect, it } from "vitest";
import { ExpressionEvaluationError, ExpressionSyntaxError } from "./errors.js";

describe("ExpressionSyntaxError", () => {
  it("is a real Error subclass with the right name and message", () => {
    const error = new ExpressionSyntaxError("bad token");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExpressionSyntaxError);
    expect(error.name).toBe("ExpressionSyntaxError");
    expect(error.message).toBe("bad token");
  });
});

describe("ExpressionEvaluationError", () => {
  it("is a real Error subclass with the right name and message", () => {
    const error = new ExpressionEvaluationError("cannot evaluate");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExpressionEvaluationError);
    expect(error.name).toBe("ExpressionEvaluationError");
    expect(error.message).toBe("cannot evaluate");
  });

  it("is a distinct class from ExpressionSyntaxError", () => {
    const error = new ExpressionEvaluationError("x");
    expect(error).not.toBeInstanceOf(ExpressionSyntaxError);
  });
});
