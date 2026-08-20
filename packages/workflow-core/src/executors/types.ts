import type { ExpressionContext } from "@datarover/expression-engine";
import type { Logger } from "@datarover/shared";

/**
 * Mutable variable buckets the engine threads through a single execution.
 * `global` and `project` are seeded once from `RunOptions.variables` and
 * treated as read/write scratch space for the duration of the run;
 * `workflow` starts empty and is populated by `setVariable` nodes.
 */
export interface EngineVariables {
  global: Record<string, unknown>;
  project: Record<string, unknown>;
  workflow: Record<string, unknown>;
}

/**
 * Everything a {@link NodeExecutor} needs to do its job: a way to build an
 * up-to-date `ExpressionContext` (so templates/expressions always see the
 * latest variables and prior action outputs), the raw variable buckets
 * (mutable, e.g. for `setVariable`), the outputs recorded so far for every
 * previously executed node, and a logger.
 *
 * `expressionContext` is a factory rather than a plain value: calling it
 * rebuilds the context afresh from `variables` / `actionsOutput` (and, in a
 * future iteration, the item currently being iterated), so an executor
 * always observes the latest state even if it calls it more than once.
 */
export interface NodeExecutionContext {
  expressionContext: () => ExpressionContext;
  variables: EngineVariables;
  actionsOutput: Record<string, { output?: unknown }>;
  logger: Logger;
  /**
   * Recursively runs another node through the engine's own registered executors — used by
   * `loopExecutor` to run each of its embedded body steps without duplicating the
   * type-to-executor dispatch already implemented by `WorkflowEngine`. Optional (rather than
   * required) specifically so the several existing executor test files' hand-built
   * `NodeExecutionContext` fixtures don't all need updating for a capability only `loop` uses;
   * every real context built by `WorkflowEngine.run` provides it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runNode?: (node: any, ctx: NodeExecutionContext) => Promise<NodeExecutionResult>;
}

/**
 * What a {@link NodeExecutor} hands back to the engine after running.
 *
 * - `output` becomes `actionsOutput[node.id].output`, visible to downstream
 *   nodes/expressions as `actions.<nodeId>.output`.
 * - `branch` is only meaningful for `condition` nodes: it tells the engine
 *   which outgoing edge (`"true"` or `"false"`) to follow next.
 */
export interface NodeExecutionResult {
  output?: unknown;
  branch?: "true" | "false";
}

/**
 * A single node type's execution logic: given the node itself and a
 * {@link NodeExecutionContext}, produces a {@link NodeExecutionResult}.
 *
 * `T` defaults to `any` so a heterogeneous registry (`Record<string,
 * NodeExecutor>`) can hold executors for every node type side by side; call
 * sites that know the concrete node type (e.g. this package's own default
 * executors) still get full type safety by instantiating `NodeExecutor<T>`
 * explicitly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeExecutor<T = any> = (node: T, ctx: NodeExecutionContext) => Promise<NodeExecutionResult>;
