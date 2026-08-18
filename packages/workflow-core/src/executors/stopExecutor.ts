import type { StopNode } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/**
 * Executor for `stop` nodes.
 *
 * CONTRACT: this executor itself performs no control-flow action beyond
 * returning `{ stopped: true, reason }` as its output — it is the caller
 * (the engine's `run` loop) that must recognize that the node it just ran
 * was a `stop` node (`node.type === "stop"`) and, upon seeing that, halt
 * graph traversal and mark the execution as finished successfully,
 * ignoring any outgoing edges the node might otherwise have. The output
 * payload is purely informational, for logs and downstream consumers.
 */
export const stopExecutor: NodeExecutor<StopNode> = async (
  node: StopNode,
  _ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  return {
    output: {
      stopped: true,
      reason: node.reason,
    },
  };
};
