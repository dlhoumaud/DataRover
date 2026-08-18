import { interpolate } from "@datarover/expression-engine";
import type { SetVariableNode } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/**
 * Executor for `setVariable` nodes.
 *
 * For every `[key, template]` pair in `node.variables`, interpolates
 * `template` against the current expression context and writes the
 * resolved value into `ctx.variables.workflow[key]`, making it immediately
 * visible to downstream nodes as `workflow.<key>`. Returns the full set of
 * resolved values as `output`.
 */
export const setVariableExecutor: NodeExecutor<SetVariableNode> = async (
  node: SetVariableNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const resolved: Record<string, unknown> = {};

  for (const [key, template] of Object.entries(node.variables)) {
    const value = interpolate(template, ctx.expressionContext());
    ctx.variables.workflow[key] = value;
    resolved[key] = value;
  }

  return { output: resolved };
};
