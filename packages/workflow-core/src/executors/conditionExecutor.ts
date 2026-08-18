import { evaluateCondition } from "@datarover/expression-engine";
import type { ConditionNode } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/**
 * Executor for `condition` nodes.
 *
 * Evaluates `node.expression` against the current expression context and
 * returns the boolean result as `output`, along with `branch` set to
 * `"true"` or `"false"` accordingly so the engine can pick the matching
 * outgoing edge.
 */
export const conditionExecutor: NodeExecutor<ConditionNode> = async (
  node: ConditionNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const result = evaluateCondition(node.expression, ctx.expressionContext());
  return {
    output: result,
    branch: result ? "true" : "false",
  };
};
