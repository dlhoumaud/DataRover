import type { ExpressionContext } from "@datarover/expression-engine";
import type { ConditionNode } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { conditionExecutor } from "./conditionExecutor.js";
import type { EngineVariables, NodeExecutionContext } from "./types.js";

function buildContext(expressionContext: ExpressionContext): NodeExecutionContext {
  const variables: EngineVariables = { global: {}, project: {}, workflow: {} };
  return {
    expressionContext: () => expressionContext,
    variables,
    actionsOutput: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
}

describe("conditionExecutor", () => {
  const node: ConditionNode = {
    id: "cond-1",
    name: "Check price",
    type: "condition",
    expression: "item.price < 30",
  };

  it("returns output true and branch 'true' when the expression is truthy", async () => {
    const ctx = buildContext({ item: { price: 10 } });
    const result = await conditionExecutor(node, ctx);
    expect(result.output).toBe(true);
    expect(result.branch).toBe("true");
  });

  it("returns output false and branch 'false' when the expression is falsy", async () => {
    const ctx = buildContext({ item: { price: 100 } });
    const result = await conditionExecutor(node, ctx);
    expect(result.output).toBe(false);
    expect(result.branch).toBe("false");
  });

  it("treats an unresolved path as falsy", async () => {
    const ctx = buildContext({});
    const result = await conditionExecutor(node, ctx);
    expect(result.output).toBe(false);
    expect(result.branch).toBe("false");
  });

  it("reads the expression context freshly from ctx.expressionContext()", async () => {
    let currentPrice = 50;
    const ctx: NodeExecutionContext = {
      expressionContext: () => ({ item: { price: currentPrice } }),
      variables: { global: {}, project: {}, workflow: {} },
      actionsOutput: {},
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };

    const first = await conditionExecutor(node, ctx);
    expect(first.branch).toBe("false");

    currentPrice = 5;
    const second = await conditionExecutor(node, ctx);
    expect(second.branch).toBe("true");
  });
});
