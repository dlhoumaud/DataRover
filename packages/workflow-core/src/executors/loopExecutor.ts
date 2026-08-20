import { interpolate } from "@datarover/expression-engine";
import type { ExpressionContext } from "@datarover/expression-engine";
import type { LoopNode } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/**
 * Executor for `loop` nodes (Specs.md §9.5's "FOR EACH", scoped down — see `LoopNodeSchema`'s doc
 * comment in @datarover/workflow-types for the embedded-body design rationale).
 *
 * `node.source` is interpolated (same convention as `dataTransform.input`/`http.url` — a `{{ }}`
 * template, not a bare node-id reference like `extract.source`) and must resolve to a real array;
 * a config mistake here (pointing at a scalar, an object, `undefined`) is surfaced as a loud,
 * explicit error rather than silently coerced into a single-element loop.
 *
 * Each iteration runs `node.body` (in order, via `ctx.runNode` — the engine's own executor
 * dispatch, reused rather than duplicated) against a per-iteration context that layers `item` (the
 * current element) and `runtime` (`{ index, isFirst, isLast }`) on top of the *outer* context,
 * rebuilt fresh on every access so a body step that just ran a `setVariable` is immediately visible
 * to the next one. `variables` (the `global`/`project`/`workflow` buckets) is the same mutable
 * object the outer scope uses, so a body `setVariable` node's writes accumulate across iterations
 * and remain visible after the loop ends — exactly like a `setVariable` node anywhere else in the
 * graph. `actionsOutput`, by contrast, is intentionally **not** shared with the outer scope: each
 * iteration gets its own bucket, seeded from a snapshot of the outer one (so a body step can still
 * read `actions.<earlierTopLevelNodeId>.output`) but populated only with *this iteration's* body
 * steps as they run (so a later body step can read an earlier one's output via
 * `actions.<bodyStepId>.output`, scoped to the same pass through the loop). None of it crosses back
 * out — only the loop node's own overall output does, via the normal `actionsOutput[node.id]`
 * bookkeeping the engine already does for every node, which avoids downstream nodes ever having to
 * guess which iteration's value a body step's id would refer to.
 */
export const loopExecutor: NodeExecutor<LoopNode> = async (
  node: LoopNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  if (ctx.runNode === undefined) {
    throw new Error('loop node "' + node.name + '": engine did not provide a runNode callback');
  }
  const runNode = ctx.runNode;

  const items = interpolate(node.source, ctx.expressionContext());
  if (!Array.isArray(items)) {
    throw new Error(
      `Loop node "${node.name}": "source" did not resolve to an array (got ${typeof items})`,
    );
  }

  const results: unknown[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const runtime = { index, isFirst: index === 0, isLast: index === items.length - 1 };

    // Seeded from a snapshot of the outer scope's outputs so body steps can still reference
    // earlier top-level nodes; populated with this iteration's own body steps as they run, and
    // discarded once the iteration ends — never merged back into ctx.actionsOutput.
    const iterationActionsOutput: Record<string, { output?: unknown }> = { ...ctx.actionsOutput };

    const iterationContext: NodeExecutionContext = {
      variables: ctx.variables,
      actionsOutput: iterationActionsOutput,
      logger: ctx.logger,
      runNode,
      expressionContext: (): ExpressionContext => ({
        ...ctx.expressionContext(),
        actions: iterationActionsOutput,
        item,
        runtime,
      }),
    };

    let lastOutput: unknown;
    for (const bodyNode of node.body) {
      const result = await runNode(bodyNode, iterationContext);
      iterationActionsOutput[bodyNode.id] = { output: result.output };
      lastOutput = result.output;
    }
    results.push(lastOutput);
  }

  return { output: node.outputMode === "list" ? results : results.at(-1) };
};
