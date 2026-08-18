import { z } from "zod";

export const ExecutionStatus = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
  "retrying",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const ActionResultSchema = z.object({
  nodeId: z.string(),
  status: ExecutionStatus,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  attempts: z.number().int().min(0).default(0),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const ExecutionLogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error", "debug"]),
  message: z.string(),
  nodeId: z.string().optional(),
});
export type ExecutionLogEntry = z.infer<typeof ExecutionLogEntrySchema>;

export const ExecutionSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: ExecutionStatus,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  actionResults: z.array(ActionResultSchema).default([]),
  logs: z.array(ExecutionLogEntrySchema).default([]),
  error: z.string().optional(),
});
export type Execution = z.infer<typeof ExecutionSchema>;
