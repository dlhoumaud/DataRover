import type { ExpressionContext } from "@datarover/expression-engine";
import type { SetVariableNode } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { setVariableExecutor } from "./setVariableExecutor.js";
import type { EngineVariables, NodeExecutionContext } from "./types.js";

function buildContext(
  expressionContext: ExpressionContext,
  variables: EngineVariables,
): NodeExecutionContext {
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

describe("setVariableExecutor", () => {
  it("interpolates each template and writes the result into workflow variables", async () => {
    const variables: EngineVariables = { global: { name: "Ada" }, project: {}, workflow: {} };
    const node: SetVariableNode = {
      id: "set-1",
      name: "Set greeting",
      type: "setVariable",
      variables: {
        greeting: "Hello {{ global.name }}",
        isReady: "{{ true }}",
        total: "{{ 2 }}",
      },
    };

    const ctx = buildContext({ global: variables.global, workflow: variables.workflow }, variables);
    const result = await setVariableExecutor(node, ctx);

    expect(variables.workflow.greeting).toBe("Hello Ada");
    expect(variables.workflow.isReady).toBe(true);
    expect(variables.workflow.total).toBe(2);
    expect(result.output).toEqual({ greeting: "Hello Ada", isReady: true, total: 2 });
  });

  it("returns an empty output object when the node declares no variables", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: {} };
    const node: SetVariableNode = {
      id: "set-2",
      name: "No-op",
      type: "setVariable",
      variables: {},
    };
    const ctx = buildContext({}, variables);
    const result = await setVariableExecutor(node, ctx);
    expect(result.output).toEqual({});
  });

  it("overwrites a pre-existing workflow variable of the same name", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { count: 1 } };
    const node: SetVariableNode = {
      id: "set-3",
      name: "Reset count",
      type: "setVariable",
      variables: { count: "{{ 0 }}" },
    };
    const ctx = buildContext({ workflow: variables.workflow }, variables);
    await setVariableExecutor(node, ctx);
    expect(variables.workflow.count).toBe(0);
  });
});
