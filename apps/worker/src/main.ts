import { disconnectPrismaClient } from "@datarover/database";
import { EXECUTION_QUEUE_NAME, getRedisConnectionOptions } from "@datarover/queue";
import type { ExecutionJobData } from "@datarover/queue";
import { createConsoleLogger } from "@datarover/shared";
import type { Job } from "bullmq";
import { Worker } from "bullmq";

import { processExecutionJob } from "./processExecutionJob.js";

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

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down worker gracefully...`);

  try {
    await worker.close();
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
