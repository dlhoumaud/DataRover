import { getPrismaClient } from "@datarover/database";
import type { ExecutionStatus as PrismaExecutionStatus, Prisma } from "@datarover/database";
import type { ExecutionJobData } from "@datarover/queue";
import { createConsoleLogger } from "@datarover/shared";
import { WorkflowEngine } from "@datarover/workflow-core";
import type { ExecutionEvent } from "@datarover/workflow-core";
import { WorkflowDefinitionSchema } from "@datarover/workflow-types";
// `Execution` exists both as a Prisma model type (re-exported by
// `@datarover/database`) and as the shape `WorkflowEngine.run` resolves with
// (from `@datarover/workflow-types`). They are unrelated, same-named types,
// so the latter is aliased below to keep the two from ever being confused.
import type { Execution as WorkflowExecution } from "@datarover/workflow-types";

const logger = createConsoleLogger("worker");

/**
 * The `Execution` row shape loaded by {@link processExecutionJob}, including
 * the relations it needs.
 */
type ExecutionWithRelations = Prisma.ExecutionGetPayload<{
  include: { workflowVersion: true; workflow: { include: { project: true } } };
}>;

/**
 * Builds a synchronous `onEvent` handler that only writes structured lines to
 * the console for observability. It MUST NOT touch the database: `onEvent`
 * fires synchronously while `WorkflowEngine.run` is still walking the graph,
 * long before the final `Execution` (and its `logs` array) is available, so
 * any DB write attempted here would race the transaction performed once
 * `run()` resolves. The durable log trail is persisted afterwards from
 * `result.logs`, see {@link processExecutionJob}.
 */
function buildEventLogger(executionId: string): (event: ExecutionEvent) => void {
  return (event: ExecutionEvent): void => {
    switch (event.type) {
      case "started":
        logger.info(`[${executionId}] started (workflow "${event.workflowId}")`);
        break;
      case "action-started":
        logger.info(`[${executionId}] action started: "${event.nodeName}" (${event.nodeId})`);
        break;
      case "action-completed":
        logger.info(`[${executionId}] action completed: ${event.nodeId} in ${event.durationMs}ms`);
        break;
      case "action-failed":
        logger.error(`[${executionId}] action failed: ${event.nodeId}: ${event.error}`);
        break;
      case "completed":
        logger.info(`[${executionId}] ${event.status} in ${event.durationMs}ms`);
        break;
    }
  };
}

/**
 * Records an `Execution` as `"failed"` as a last resort, used when something
 * goes wrong before or during the normal success/failure persistence path
 * below (e.g. a malformed stored `WorkflowDefinition`, or a database error).
 * Ensures an execution never stays stuck in `"running"`/`"pending"`.
 *
 * Swallows any error raised by the update itself (logging it instead) so the
 * original error that triggered this fallback is always the one that
 * propagates out of {@link processExecutionJob}.
 */
async function markAsFailedBestEffort(executionId: string, message: string): Promise<void> {
  const prisma = getPrismaClient();
  const failedStatus: PrismaExecutionStatus = "failed";
  try {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: failedStatus,
        finishedAt: new Date(),
        error: message,
      },
    });
  } catch (updateError) {
    const updateMessage =
      updateError instanceof Error ? updateError.message : String(updateError);
    logger.error(
      `[${executionId}] failed to record fallback "failed" status (${updateMessage}); ` +
        "execution may remain stuck",
    );
  }
}

/**
 * Loads the `Execution` identified by `jobData.executionId` from the
 * database, replays its stored `WorkflowVersion.definition` through a fresh
 * `WorkflowEngine`, and persists the outcome (final status/error/action
 * results, plus every log line) back to Postgres.
 *
 * Never leaves the caller with a dangling execution row: any failure
 * (missing row, invalid definition, node execution failure, database error)
 * results in the `Execution` being marked `"failed"` with an explanatory
 * `error` message before the error is rethrown, so BullMQ can still apply
 * its own retry/failure policy on the job itself.
 */
export async function processExecutionJob(jobData: ExecutionJobData): Promise<void> {
  const prisma = getPrismaClient();

  try {
    const executionRow: ExecutionWithRelations = await prisma.execution.findUniqueOrThrow({
      where: { id: jobData.executionId },
      include: {
        workflowVersion: true,
        workflow: { include: { project: true } },
      },
    });

    const runningStatus: PrismaExecutionStatus = "running";
    await prisma.execution.update({
      where: { id: jobData.executionId },
      data: {
        status: runningStatus,
        startedAt: new Date(),
      },
    });

    const definition = WorkflowDefinitionSchema.parse(executionRow.workflowVersion.definition);

    const projectVariables = (executionRow.workflow.project.variables ??
      {}) as unknown as Record<string, unknown>;

    const engine = new WorkflowEngine();
    const result: WorkflowExecution = await engine.run(definition, {
      variables: { global: projectVariables },
      onEvent: buildEventLogger(jobData.executionId),
    });

    const finalStatus: PrismaExecutionStatus = result.status === "success" ? "success" : "failed";

    await prisma.$transaction([
      prisma.execution.update({
        where: { id: jobData.executionId },
        data: {
          status: finalStatus,
          finishedAt: new Date(),
          error: result.error,
          actionResults: result.actionResults as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.executionLog.createMany({
        data: result.logs.map((l) => ({
          executionId: jobData.executionId,
          timestamp: new Date(l.timestamp),
          level: l.level,
          message: l.message,
          nodeId: l.nodeId,
        })),
      }),
    ]);

    logger.info(`[${jobData.executionId}] persisted with status "${finalStatus}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[${jobData.executionId}] processing failed: ${message}`);
    await markAsFailedBestEffort(jobData.executionId, message);
    throw error;
  }
}
