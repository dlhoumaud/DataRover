import { extract } from "@datarover/extractor";
import type { ExtractNode } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/** Shape produced by {@link httpExecutor}'s output. */
interface HttpLikeOutput {
  status: unknown;
  headers: unknown;
  body: unknown;
}

/** `true` when `value` looks like an `http` node's `{ status, headers, body }` output. */
function isHttpLikeOutput(value: unknown): value is HttpLikeOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "headers" in value &&
    "body" in value
  );
}

/**
 * Executor for `extract` nodes.
 *
 * The raw data to extract from is read from `ctx.actionsOutput[node.source]`.
 * When that output looks like an `http` node's result (`{ status, headers,
 * body }`), its `body` is used as the source document; otherwise the output
 * value itself is used as-is, which allows chaining an `extract` node
 * directly after another `extract` node.
 *
 * Every rule in `node.rules` is run via `extract` from
 * `@datarover/extractor`, and the resulting `{ [rule.name]: value }` pairs
 * are merged into a single output object.
 */
export const extractExecutor: NodeExecutor<ExtractNode> = async (
  node: ExtractNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const sourceOutput = ctx.actionsOutput[node.source]?.output;
  const sourceData = isHttpLikeOutput(sourceOutput) ? sourceOutput.body : sourceOutput;

  const output: Record<string, unknown> = {};
  for (const rule of node.rules) {
    const outcome = extract(sourceData, node.sourceType, rule);
    output[rule.name] = outcome.value;
  }

  return { output };
};
