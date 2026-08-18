import { z } from "zod";

export const ScheduleType = z.enum(["manual", "interval", "hourly", "daily", "weekly", "cron"]);
export type ScheduleType = z.infer<typeof ScheduleType>;

export const ScheduleSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  type: ScheduleType,
  everyMinutes: z.number().int().positive().optional(),
  cronExpression: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type Schedule = z.infer<typeof ScheduleSchema>;
