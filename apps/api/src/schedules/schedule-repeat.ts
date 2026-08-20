import type { Schedule } from "@datarover/database";

/** The subset of BullMQ's `RepeatOptions` this app ever needs — either a fixed interval or a cron
 * pattern, never both (mirrored from bullmq's own type rather than imported, to keep this file
 * a pure, dependency-free function that's trivial to unit test). */
export interface RepeatOptions {
  pattern?: string;
  every?: number;
}

/**
 * Translates a `Schedule` row's `type`/`everyMinutes`/`cronExpression` into the BullMQ repeat
 * options `ScheduleQueueService.upsertScheduler` needs, or `null` when the schedule should never
 * fire automatically (`type: "manual"` — see the `Schedule` model's doc comment in schema.prisma).
 *
 * `hourly`/`daily`/`weekly` are fixed cron patterns (aligned to the wall clock — top of the hour,
 * midnight, midnight Sunday) rather than "every N ms since the schedule was created": the latter
 * would drift with server restarts and doesn't match what a user reading "Daily" would expect.
 * Timezone is deliberately left at BullMQ's default (UTC) — Specs.md §14 lists timezone support
 * as a future evolution, not required for this iteration.
 */
export function scheduleToRepeatOptions(
  schedule: Pick<Schedule, "type" | "everyMinutes" | "cronExpression">,
): RepeatOptions | null {
  switch (schedule.type) {
    case "manual":
      return null;
    case "interval": {
      if (schedule.everyMinutes === null || schedule.everyMinutes === undefined) {
        throw new Error('Schedule type "interval" requires "everyMinutes" to be set');
      }
      return { every: schedule.everyMinutes * 60_000 };
    }
    case "hourly":
      return { pattern: "0 * * * *" };
    case "daily":
      return { pattern: "0 0 * * *" };
    case "weekly":
      return { pattern: "0 0 * * 0" };
    case "cron": {
      if (!schedule.cronExpression) {
        throw new Error('Schedule type "cron" requires "cronExpression" to be set');
      }
      return { pattern: schedule.cronExpression };
    }
    default: {
      const exhaustiveCheck: never = schedule.type;
      throw new Error(`Unsupported schedule type: ${String(exhaustiveCheck)}`);
    }
  }
}
