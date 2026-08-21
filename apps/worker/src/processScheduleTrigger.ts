import { getPrismaClient } from "@datarover/database";
import type { ExecutionStatus as PrismaExecutionStatus } from "@datarover/database";
import { EXECUTION_QUEUE_NAME, getRedisConnectionOptions } from "@datarover/queue";
import type { ExecutionJobData, ScheduleTriggerJobData } from "@datarover/queue";
import { createConsoleLogger } from "@datarover/shared";
import { Queue } from "bullmq";

const logger = createConsoleLogger("worker");

/**
 * Producer side of `EXECUTION_QUEUE_NAME` — this worker process both *consumes*
 * `SCHEDULE_TRIGGER_QUEUE_NAME` (via {@link processScheduleTrigger}) and *produces* onto this
 * queue, mirroring apps/api's `ExecutionQueueService` exactly. One instance for the whole
 * process, closed alongside everything else in main.ts's graceful shutdown — see
 * {@link closeScheduleTriggerResources}.
 */
const executionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
});

export async function closeScheduleTriggerResources(): Promise<void> {
  await executionQueue.close();
}

/**
 * Turns one scheduled tick into a brand new `Execution`, then enqueues it onto
 * `EXECUTION_QUEUE_NAME` — the exact same path `ExecutionsService.createForWorkflow` takes for a
 * manual "Exécuter" click in the UI, just triggered by a BullMQ job scheduler instead of an HTTP
 * request. From there, `processExecutionJob` (already registered on that queue) takes over
 * exactly as it would for any other execution.
 *
 * A `Schedule`'s BullMQ job scheduler and its database row can only ever be *approximately* kept
 * in sync (see `SchedulesService.setEnabled`/`.remove`) — a tick can still be in flight the moment
 * a schedule is disabled or deleted. That race is expected, ordinary behavior, not a failure worth
 * BullMQ retrying or alerting on, so it's handled by skipping quietly rather than throwing.
 */
export async function processScheduleTrigger(jobData: ScheduleTriggerJobData): Promise<void> {
  const prisma = getPrismaClient();

  const schedule = await prisma.schedule.findUnique({ where: { id: jobData.scheduleId } });
  if (!schedule || !schedule.enabled) {
    logger.info(
      `[schedule ${jobData.scheduleId}] skipped: ${schedule ? "disabled" : "no longer exists"}`,
    );
    return;
  }

  const currentVersion = await prisma.workflowVersion.findFirst({
    where: { workflowId: jobData.workflowId },
    orderBy: { version: "desc" },
  });
  if (!currentVersion) {
    logger.error(
      `[schedule ${jobData.scheduleId}] skipped: workflow ${jobData.workflowId} has no versions to run`,
    );
    return;
  }

  const execution = await prisma.execution.create({
    data: {
      workflowId: jobData.workflowId,
      workflowVersionId: currentVersion.id,
      status: "pending",
    },
  });

  try {
    await executionQueue.add("run", { executionId: execution.id });
  } catch (error) {
    // Never leave a dangling "pending" execution nobody will ever pick up — same principle as
    // processExecutionJob.ts's markAsFailedBestEffort, applied to the one failure mode specific
    // to this path (the row was created, but the follow-up enqueue itself failed).
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[schedule ${jobData.scheduleId}] failed to enqueue execution "${execution.id}": ${message}`);
    const failedStatus: PrismaExecutionStatus = "failed";
    await prisma.execution
      .update({
        where: { id: execution.id },
        data: { status: failedStatus, finishedAt: new Date(), error: `Failed to enqueue: ${message}` },
      })
      .catch(() => undefined);
    throw error;
  }

  logger.info(
    `[schedule ${jobData.scheduleId}] created and enqueued execution "${execution.id}" for workflow "${jobData.workflowId}"`,
  );
}
