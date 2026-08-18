import type { ExpressionContext } from "@datarover/expression-engine";
import { createConsoleLogger, generateId } from "@datarover/shared";
import type { Logger } from "@datarover/shared";
import type {
  ActionNode,
  ActionResult,
  Execution,
  ExecutionLogEntry,
  WorkflowDefinition,
} from "@datarover/workflow-types";

import type { ExecutionEvent } from "./events.js";
import { conditionExecutor } from "./executors/conditionExecutor.js";
import { extractExecutor } from "./executors/extractExecutor.js";
import { httpExecutor } from "./executors/httpExecutor.js";
import { setVariableExecutor } from "./executors/setVariableExecutor.js";
import { stopExecutor } from "./executors/stopExecutor.js";
import type { EngineVariables, NodeExecutionContext, NodeExecutor } from "./executors/types.js";
import { getNextNodeId, getNodeById, validateDefinition } from "./graph.js";
import { withRetry, withTimeout } from "./retry.js";

/** Default bound on the number of node visits in a single run, guarding against cycles. */
const DEFAULT_MAX_STEPS = 1000;

/** Options accepted by {@link WorkflowEngine.run}. */
export interface RunOptions {
  /** Initial `global`/`project` variable buckets exposed to expressions and templates. */
  variables?: {
    global?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
  /** Called synchronously for every lifecycle event as the execution progresses. */
  onEvent?: (event: ExecutionEvent) => void;
  /** Maximum number of node visits before aborting with a cycle-detection error. Defaults to `1000`. */
  maxSteps?: number;
  /** Logger used for internal diagnostics. Defaults to a console logger named `"workflow-engine"`. */
  logger?: Logger;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Executes `WorkflowDefinition` graphs.
 *
 * Ships with five default node executors (`http`, `extract`, `condition`,
 * `setVariable`, `stop`); pass `executors` to the constructor to override
 * or extend that registry (e.g. to add a `"browser"` executor in a future
 * version) without needing to modify this class.
 */
export class WorkflowEngine {
  private readonly executors: Record<string, NodeExecutor>;

  constructor(options?: { executors?: Partial<Record<string, NodeExecutor>> }) {
    const defaults: Record<string, NodeExecutor> = {
      http: httpExecutor as NodeExecutor,
      extract: extractExecutor as NodeExecutor,
      condition: conditionExecutor as NodeExecutor,
      setVariable: setVariableExecutor as NodeExecutor,
      stop: stopExecutor as NodeExecutor,
    };
    this.executors = { ...defaults, ...options?.executors } as Record<string, NodeExecutor>;
  }

  /**
   * Runs `definition` from its `startNodeId` through to completion.
   *
   * Validates the definition first (throws synchronously if it is
   * malformed), then walks the graph node by node: each visited node is
   * executed through its registered executor (wrapped with the node's
   * `timeoutMs`/`retryPolicy`, if any), its result is recorded, and the
   * next node is picked via `getNextNodeId` (following the executor's
   * returned `branch` for `condition` nodes). A `stop` node, a node
   * failure (after retries are exhausted), reaching a node with no
   * matching outgoing edge, or exceeding `maxSteps` all terminate the walk.
   *
   * Always resolves (never rejects) with a fully-populated `Execution`,
   * whose `status` is `"success"` or `"failed"`.
   */
  async run(definition: WorkflowDefinition, options?: RunOptions): Promise<Execution> {
    validateDefinition(definition);

    const logger = options?.logger ?? createConsoleLogger("workflow-engine");
    const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
    const onEvent = options?.onEvent;

    const execution: Execution = {
      id: generateId("exec"),
      workflowId: definition.id,
      status: "running",
      startedAt: nowIso(),
      actionResults: [],
      logs: [],
    };

    const emit = (event: ExecutionEvent): void => {
      onEvent?.(event);
    };

    const appendLog = (
      level: ExecutionLogEntry["level"],
      message: string,
      nodeId?: string,
    ): void => {
      execution.logs.push({ timestamp: nowIso(), level, message, nodeId });
    };

    emit({ type: "started", executionId: execution.id, workflowId: definition.id });
    appendLog("info", `Execution "${execution.id}" started for workflow "${definition.id}"`);
    logger.info(`Execution "${execution.id}" started for workflow "${definition.id}"`);

    const variables: EngineVariables = {
      global: { ...(options?.variables?.global ?? {}) },
      project: { ...(options?.variables?.project ?? {}) },
      workflow: {},
    };

    const actionsOutput: Record<string, { output?: unknown }> = {};

    const buildExpressionContext = (): ExpressionContext => ({
      global: variables.global,
      project: variables.project,
      workflow: variables.workflow,
      actions: actionsOutput,
    });

    const runStartedAt = Date.now();
    let currentNodeId: string | undefined = definition.startNodeId;
    let steps = 0;

    while (currentNodeId !== undefined) {
      steps++;
      if (steps > maxSteps) {
        const message = "Max execution steps exceeded (possible cycle)";
        appendLog("error", message);
        logger.error(message);
        execution.status = "failed";
        execution.error = message;
        break;
      }

      const node: ActionNode = getNodeById(definition, currentNodeId);
      const executor = this.executors[node.type];
      if (executor === undefined) {
        const message = `No executor registered for node type "${node.type}"`;
        appendLog("error", message, node.id);
        logger.error(message);
        execution.status = "failed";
        execution.error = message;
        break;
      }

      emit({ type: "action-started", nodeId: node.id, nodeName: node.name });
      appendLog("info", `Action started: "${node.name}"`, node.id);
      logger.info(`Action started: "${node.name}" (${node.id})`);

      const nodeContext: NodeExecutionContext = {
        expressionContext: buildExpressionContext,
        variables,
        actionsOutput,
        logger,
      };

      const startedAt = nowIso();
      const nodeStartedAtMs = Date.now();
      let attempts = 0;

      try {
        const result = await withRetry(async () => {
          attempts++;
          return withTimeout(() => executor(node, nodeContext), node.timeoutMs);
        }, node.retryPolicy);

        const durationMs = Date.now() - nodeStartedAtMs;
        actionsOutput[node.id] = { output: result.output };

        const actionResult: ActionResult = {
          nodeId: node.id,
          status: "success",
          startedAt,
          finishedAt: nowIso(),
          output: result.output,
          attempts,
        };
        execution.actionResults.push(actionResult);

        emit({ type: "action-completed", nodeId: node.id, output: result.output, durationMs });
        appendLog("info", `Action completed: "${node.name}" in ${durationMs}ms`, node.id);
        logger.info(`Action completed: "${node.name}" (${node.id}) in ${durationMs}ms`);

        if (node.type === "stop") {
          // See executors/stopExecutor.ts: the engine, not the executor, is
          // responsible for halting traversal here.
          break;
        }

        currentNodeId = getNextNodeId(definition, node.id, result.branch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        const actionResult: ActionResult = {
          nodeId: node.id,
          status: "failed",
          startedAt,
          finishedAt: nowIso(),
          error: message,
          attempts,
        };
        execution.actionResults.push(actionResult);

        emit({ type: "action-failed", nodeId: node.id, error: message });
        appendLog("error", `Action failed: "${node.name}" (${message})`, node.id);
        logger.error(`Action failed: "${node.name}" (${node.id}): ${message}`);

        execution.status = "failed";
        execution.error = message;
        break;
      }
    }

    if (execution.status === "running") {
      execution.status = "success";
    }

    execution.finishedAt = nowIso();
    const totalDurationMs = Date.now() - runStartedAt;
    const finalStatus = execution.status === "success" ? "success" : "failed";

    emit({ type: "completed", status: finalStatus, durationMs: totalDurationMs });
    appendLog("info", `Execution "${execution.id}" ${finalStatus} in ${totalDurationMs}ms`);
    logger.info(`Execution "${execution.id}" ${finalStatus} in ${totalDurationMs}ms`);

    return execution;
  }
}
