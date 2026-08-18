import { z } from "zod";

/**
 * The scope at which a variable is defined / resolved.
 * - global: available across the whole DataRover instance
 * - project: available to all workflows within a project
 * - workflow: available to all nodes within a single workflow
 * - action: local to a single action/node
 * - iteration: local to a single loop iteration
 * - runtime: injected at execution time (e.g. by the engine itself)
 */
export const VariableScope = z.enum([
  "global",
  "project",
  "workflow",
  "action",
  "iteration",
  "runtime",
]);
export type VariableScope = z.infer<typeof VariableScope>;

export const VariableSchema = z.object({
  key: z.string(),
  scope: VariableScope,
  value: z.unknown(),
  secret: z.boolean().optional().default(false),
});
export type Variable = z.infer<typeof VariableSchema>;
