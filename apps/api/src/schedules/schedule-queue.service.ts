import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  SCHEDULE_TRIGGER_QUEUE_NAME,
  getRedisConnectionOptions,
  type ScheduleTriggerJobData,
} from "@datarover/queue";
import type { RepeatOptions } from "./schedule-repeat";

/**
 * Producer-side wrapper around the BullMQ *job scheduler* backing recurring `Schedule` triggers
 * (Specs.md §14) — one job scheduler per `Schedule` row, keyed by the schedule's own id so
 * upserting/removing it is idempotent regardless of how many times it's called. Like
 * `ExecutionQueueService`, this only ever produces: turning a tick into a new `Execution` is
 * apps/worker's job (see apps/worker/src/processScheduleTrigger.ts).
 */
@Injectable()
export class ScheduleQueueService implements OnModuleDestroy {
  private readonly queue: Queue<ScheduleTriggerJobData>;

  constructor() {
    this.queue = new Queue<ScheduleTriggerJobData>(SCHEDULE_TRIGGER_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
    });
  }

  async upsertScheduler(
    scheduleId: string,
    repeatOpts: RepeatOptions,
    data: ScheduleTriggerJobData,
  ): Promise<void> {
    await this.queue.upsertJobScheduler(scheduleId, repeatOpts, { name: "trigger", data });
  }

  /** A no-op (not an error) when `scheduleId` never had a job scheduler registered — e.g. it was
   * always `type: "manual"`, or is already removed. */
  async removeScheduler(scheduleId: string): Promise<void> {
    await this.queue.removeJobScheduler(scheduleId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
