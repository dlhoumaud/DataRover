import { disconnectPrismaClient } from "@datarover/database";
import {
  EXECUTION_QUEUE_NAME,
  SCHEDULE_TRIGGER_QUEUE_NAME,
  getRedisConnectionOptions,
} from "@datarover/queue";
import type { ExecutionJobData, ScheduleTriggerJobData } from "@datarover/queue";
import { createConsoleLogger } from "@datarover/shared";
import type { Job } from "bullmq";
import { Worker } from "bullmq";

import { processExecutionJob } from "./processExecutionJob.js";
import { closeScheduleTriggerResources, processScheduleTrigger } from "./processScheduleTrigger.js";

const logger = createConsoleLogger("worker");

const rawConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);
const concurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? rawConcurrency : 5;

const worker = new Worker<ExecutionJobData>(
  EXECUTION_QUEUE_NAME,
  (job) => processExecutionJob(job.data),
  {
    connection: getRedisConnectionOptions(),
    concurrency,
  },
);

logger.info(
  `Worker started, listening on queue "${EXECUTION_QUEUE_NAME}" with concurrency ${concurrency}`,
);

worker.on("completed", (job: Job<ExecutionJobData>) => {
  logger.info(`Job ${job.id} (execution "${job.data.executionId}") completed successfully`);
});

worker.on("failed", (job: Job<ExecutionJobData> | undefined, error: Error) => {
  const executionId = job?.data.executionId ?? "unknown";
  logger.error(`Job ${job?.id ?? "unknown"} (execution "${executionId}") failed: ${error.message}`);
});

worker.on("error", (error: Error) => {
  logger.error(`Worker connection error: ${error.message}`);
});

/**
 * Second, independent BullMQ Worker in this same process, consuming the ticks
 * `ScheduleQueueService.upsertScheduler` (apps/api) registers per `Schedule` — see
 * processScheduleTrigger.ts. Low concurrency: each tick is a couple of tiny DB reads/writes plus
 * one enqueue, nothing that benefits from parallelism the way running a whole workflow does.
 */
const scheduleTriggerWorker = new Worker<ScheduleTriggerJobData>(
  SCHEDULE_TRIGGER_QUEUE_NAME,
  (job) => processScheduleTrigger(job.data),
  {
    connection: getRedisConnectionOptions(),
    concurrency: 2,
  },
);

logger.info(`Worker started, listening on queue "${SCHEDULE_TRIGGER_QUEUE_NAME}"`);

scheduleTriggerWorker.on("completed", (job: Job<ScheduleTriggerJobData>) => {
  logger.info(`Job ${job.id} (schedule "${job.data.scheduleId}") completed successfully`);
});

scheduleTriggerWorker.on("failed", (job: Job<ScheduleTriggerJobData> | undefined, error: Error) => {
  const scheduleId = job?.data.scheduleId ?? "unknown";
  logger.error(`Job ${job?.id ?? "unknown"} (schedule "${scheduleId}") failed: ${error.message}`);
});

scheduleTriggerWorker.on("error", (error: Error) => {
  logger.error(`Schedule trigger worker connection error: ${error.message}`);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down worker gracefully...`);

  try {
    await worker.close();
    await scheduleTriggerWorker.close();
    await closeScheduleTriggerResources();
    await disconnectPrismaClient();
    logger.info("Worker shut down cleanly.");
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error while shutting down: ${message}`);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
