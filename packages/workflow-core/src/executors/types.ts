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

/** One proxy reserved from the global pool for the duration of a single node's execution. */
export interface ReservedProxy {
  id: string;
  host: string;
  port: number;
}

/**
 * The small surface `httpExecutor`/`browserActionExecutor` need to use the global proxy pool for
 * a node with `networkMode: "proxy"` — deliberately just this interface, never a direct
 * `@datarover/database`/Prisma dependency: this package stays fully DB-agnostic (testable without
 * a real database), exactly like `runNode` below is an *injected capability* rather than this
 * package reaching out to the engine itself. The concrete, Prisma-backed implementation lives in
 * `@datarover/database`'s `proxyPool.ts` and is wired in by `apps/worker` (the one app that
 * already depends on `@datarover/database` directly) when it builds `RunOptions`.
 */
export interface ProxyPoolClient {
  /** Reserves one available proxy, or `null` if none is available right now. */
  reserve: () => Promise<ReservedProxy | null>;
  /** Records a failure against a proxy — may purge it entirely once its error threshold is reached. */
  reportError: (id: string) => Promise<void>;
  /** Releases a proxy back to the pool — always called once the node's execution finishes,
   *  success or failure alike; safe to call even if `reportError` already purged the same id. */
  release: (id: string) => Promise<void>;
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
  /** Present whenever the environment running this engine has a proxy pool wired up (real
   *  executions via `apps/worker` always provide one) — absent in most executor unit tests, which
   *  is exactly why `httpExecutor`/`browserActionExecutor` throw a clear, specific error rather
   *  than silently falling back to a direct connection when a `networkMode: "proxy"` node runs
   *  without one. */
  proxyPool?: ProxyPoolClient;
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
