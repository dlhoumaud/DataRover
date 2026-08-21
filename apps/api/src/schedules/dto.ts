import { parseExpression } from "cron-parser";
import { z } from "zod";
import { ScheduleType } from "@datarover/workflow-types";

/**
 * `type: "interval"` requires `everyMinutes`; `type: "cron"` requires a `cronExpression` that
 * actually parses — validated here with the exact same library (`cron-parser`, pinned to the
 * version bullmq itself depends on) BullMQ's job scheduler uses internally, so an expression
 * accepted here is guaranteed to be accepted there too. `hourly`/`daily`/`weekly`/`manual` need
 * neither field (see schedule-repeat.ts for the fixed patterns hourly/daily/weekly resolve to).
 */
export const CreateScheduleSchema = z
  .object({
    type: ScheduleType,
    everyMinutes: z.number().int().positive().optional(),
    cronExpression: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === "interval" && value.everyMinutes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["everyMinutes"],
        message: '"everyMinutes" is required when type is "interval"',
      });
    }
    if (value.type === "cron") {
      if (value.cronExpression === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cronExpression"],
          message: '"cronExpression" is required when type is "cron"',
        });
      } else {
        try {
          parseExpression(value.cronExpression);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cronExpression"],
            message: `Invalid cron expression: ${message}`,
          });
        }
      }
    }
  });
export type CreateScheduleDto = z.infer<typeof CreateScheduleSchema>;

/**
 * The only supported update: pause/resume a schedule. Changing its recurrence (type/
 * everyMinutes/cronExpression) means deleting and recreating it — a deliberate scope cut that
 * avoids re-deriving "what does a partial update even mean" for every field combination above.
 */
export const UpdateScheduleSchema = z.object({ enabled: z.boolean() });
export type UpdateScheduleDto = z.infer<typeof UpdateScheduleSchema>;
