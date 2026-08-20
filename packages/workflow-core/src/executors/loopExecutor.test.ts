import type { LoopBodyNode, LoopNode } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { loopExecutor } from "./loopExecutor.js";
import { setVariableExecutor } from "./setVariableExecutor.js";
import type { EngineVariables, NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/** The only body-step type these tests need — the loop's own machinery is what's under test, not
 * any individual body executor's own correctness (each has its own dedicated test file). */
const BODY_EXECUTORS: Record<string, NodeExecutor> = {
  setVariable: setVariableExecutor as NodeExecutor,
};

function buildContext(variables: EngineVariables): NodeExecutionContext {
  const actionsOutput: Record<string, { output?: unknown }> = {};
  return {
    expressionContext: () => ({
      global: variables.global,
      project: variables.project,
      workflow: variables.workflow,
      actions: actionsOutput,
    }),
    variables,
    actionsOutput,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    runNode: async (node: LoopBodyNode, ctx: NodeExecutionContext): Promise<NodeExecutionResult> => {
      const executor = BODY_EXECUTORS[node.type];
      if (executor === undefined) {
        throw new Error(`no test-double executor for body node type "${node.type}"`);
      }
      return executor(node, ctx);
    },
  };
}

function loopNode(overrides: Partial<LoopNode>): LoopNode {
  return {
    id: "loop1",
    name: "Boucle",
    type: "loop",
    source: "{{ workflow.items }}",
    body: [{ id: "step1", name: "Step 1", type: "setVariable", variables: {} }],
    outputMode: "list",
    ...overrides,
  };
}

describe("loopExecutor", () => {
  it("returns an empty list without running the body when the source array is empty", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: [] } };
    const ctx = buildContext(variables);
    const result = await loopExecutor(loopNode({}), ctx);
    expect(result.output).toEqual([]);
  });

  it("throws a clear error when source does not resolve to an array", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: 42 } };
    const ctx = buildContext(variables);
    await expect(loopExecutor(loopNode({}), ctx)).rejects.toThrow(/did not resolve to an array/);
  });

  it("binds item and runtime (index/isFirst/isLast) for every iteration", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: ["a", "b", "c"] } };
    const ctx = buildContext(variables);
    const node = loopNode({
      body: [
        {
          id: "capture",
          name: "Capture",
          type: "setVariable",
          variables: {
            item: "{{ item }}",
            index: "{{ runtime.index }}",
            isFirst: "{{ runtime.isFirst }}",
            isLast: "{{ runtime.isLast }}",
          },
        },
      ],
    });

    const result = await loopExecutor(node, ctx);

    expect(result.output).toEqual([
      { item: "a", index: 0, isFirst: true, isLast: false },
      { item: "b", index: 1, isFirst: false, isLast: false },
      { item: "c", index: 2, isFirst: false, isLast: true },
    ]);
  });

  it("accumulates workflow variable writes across iterations and leaves them visible after the loop", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: [1, 2, 3], log: "" } };
    const ctx = buildContext(variables);
    const node = loopNode({
      body: [
        { id: "append", name: "Append", type: "setVariable", variables: { log: "{{ workflow.log }}{{ item }};" } },
      ],
    });

    await loopExecutor(node, ctx);

    expect(variables.workflow.log).toBe("1;2;3;");
  });

  it("lets a later body step read an earlier body step's output within the same iteration", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: ["x", "y"] } };
    const ctx = buildContext(variables);
    const node = loopNode({
      body: [
        { id: "stepA", name: "Step A", type: "setVariable", variables: { echo: "{{ item }}" } },
        {
          id: "stepB",
          name: "Step B",
          type: "setVariable",
          variables: { fromStepA: "{{ actions.stepA.output.echo }}" },
        },
      ],
    });

    const result = await loopExecutor(node, ctx);

    expect(result.output).toEqual([{ fromStepA: "x" }, { fromStepA: "y" }]);
  });

  it("does not leak body-step outputs into the outer scope's actionsOutput", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: [1] } };
    const ctx = buildContext(variables);
    const node = loopNode({
      body: [{ id: "inner", name: "Inner", type: "setVariable", variables: { x: "{{ item }}" } }],
    });

    await loopExecutor(node, ctx);

    expect(ctx.actionsOutput.inner).toBeUndefined();
  });

  it('collects every iteration\'s last body output when outputMode is "list"', async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: [10, 20] } };
    const ctx = buildContext(variables);
    const node = loopNode({
      outputMode: "list",
      body: [
        { id: "first", name: "First", type: "setVariable", variables: { a: "{{ item }}" } },
        { id: "second", name: "Second", type: "setVariable", variables: { b: "{{ item }}" } },
      ],
    });

    const result = await loopExecutor(node, ctx);

    // Each iteration's *last* body step wins ({ b: ... }), not the first ({ a: ... }).
    expect(result.output).toEqual([{ b: 10 }, { b: 20 }]);
  });

  it('keeps only the final iteration\'s output when outputMode is "last"', async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: [10, 20, 30] } };
    const ctx = buildContext(variables);
    const node = loopNode({
      outputMode: "last",
      body: [{ id: "step", name: "Step", type: "setVariable", variables: { value: "{{ item }}" } }],
    });

    const result = await loopExecutor(node, ctx);

    expect(result.output).toEqual({ value: 30 });
  });

  it("throws when the engine did not provide a runNode callback", async () => {
    const variables: EngineVariables = { global: {}, project: {}, workflow: { items: [1] } };
    const ctx = buildContext(variables);
    const { runNode: _runNode, ...ctxWithoutRunNode } = ctx;
    await expect(loopExecutor(loopNode({}), ctxWithoutRunNode)).rejects.toThrow(/runNode/);
  });
});
