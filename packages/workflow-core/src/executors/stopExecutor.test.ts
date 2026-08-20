import type { ExpressionContext } from "@datarover/expression-engine";
import type { StopNode } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { stopExecutor } from "./stopExecutor.js";
import type { EngineVariables, NodeExecutionContext } from "./types.js";

function buildContext(expressionContext: ExpressionContext): NodeExecutionContext {
  return {
    expressionContext: () => expressionContext,
    variables: { global: {}, project: {}, workflow: {} } satisfies EngineVariables,
    actionsOutput: {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

function node(overrides: Partial<StopNode>): StopNode {
  return { id: "stop1", name: "Stop", type: "stop", ...overrides };
}

describe("stopExecutor", () => {
  it("returns stopped: true and an undefined reason when none is configured", async () => {
    const result = await stopExecutor(node({}), buildContext({}));
    expect(result.output).toEqual({ stopped: true, reason: undefined });
  });

  it("passes through a reason with no template as-is", async () => {
    const result = await stopExecutor(node({ reason: "quota exceeded" }), buildContext({}));
    expect(result.output).toEqual({ stopped: true, reason: "quota exceeded" });
  });

  it("interpolates a {{ }} reason against the current expression context (regression: used to be left literal)", async () => {
    const ctx = buildContext({ actions: { browserAction1: { output: { html: "<html>ok</html>" } } } });
    const result = await stopExecutor(
      node({ reason: "{{ actions.browserAction1.output.html }}" }),
      ctx,
    );
    expect(result.output).toEqual({ stopped: true, reason: "<html>ok</html>" });
  });

  it("interpolates a reason that mixes literal text with a template", async () => {
    const ctx = buildContext({ global: { count: 3 } });
    const result = await stopExecutor(node({ reason: "stopped after {{ global.count }} items" }), ctx);
    expect(result.output).toEqual({ stopped: true, reason: "stopped after 3 items" });
  });
});
