import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  EXECUTION_QUEUE_NAME,
  getRedisConnectionOptions,
  type ExecutionJobData,
} from "@datarover/queue";

/**
 * Producer-side wrapper around the BullMQ execution queue.
 *
 * IMPORTANT: this service only ever *enqueues* jobs. It never processes
 * them — running the workflow engine is the sole responsibility of
 * apps/worker, which consumes this same queue by name.
 */
@Injectable()
export class ExecutionQueueService implements OnModuleDestroy {
  private readonly queue: Queue<ExecutionJobData>;

  constructor() {
    this.queue = new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
    });
  }

  async enqueueExecution(executionId: string): Promise<void> {
    await this.queue.add("run", { executionId });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
